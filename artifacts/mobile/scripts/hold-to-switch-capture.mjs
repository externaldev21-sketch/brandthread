#!/usr/bin/env node
/**
 * Hold-to-switch on the buyer tab bar's Profile button, on the web preview
 * build (390x844, dark, real motion):
 *
 *   1. early release (~300ms): the ring starts, retracts, nothing happens;
 *   2. full hold: the ring closes, the app fades through to the other
 *      account (preview: @atelier.noire, a seller) and its toast shows;
 *   3. a plain tap (on the buyer side again) still just opens Profile.
 *
 * Saves a frame sequence of each, plus results.json with what happened.
 *
 *   node scripts/hold-to-switch-capture.mjs --label after --build-dir <dir> --skip-build
 *
 * Output: docs/screenshots/tabbar-over-video/<label>/hold-to-switch/
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const DEVICE = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: false,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const label = arg('label', 'after');
  const buildDir = arg('build-dir', DEFAULT_BUILD_DIR);
  const outDir = path.join(MOBILE_ROOT, '..', '..', 'docs', 'screenshots', 'tabbar-over-video', label, 'hold-to-switch');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(buildDir);

  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const result = { label };
  try {
    const { context, page, activity } = await openContext(browser, {
      device: DEVICE, role: 'buyer', origin: server.origin, images: {},
      installClock: false, contextOptions: { reducedMotion: 'no-preference' },
    });
    await context.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await openScreen(page, activity, server.origin, 'buyer', '/');
    await page.waitForSelector('[data-testid="buyer-tab-profile"]', { timeout: 20_000 });
    await page.waitForTimeout(1500);

    const cdp = await context.newCDPSession(page);
    let dir = '';
    let n = 0;
    cdp.on('Page.screencastFrame', async (f) => {
      n += 1;
      if (dir) writeFileSync(path.join(dir, `${String(n).padStart(3, '0')}.jpg`), Buffer.from(f.data, 'base64'));
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    const record = async (name, fn) => {
      dir = path.join(outDir, name);
      mkdirSync(dir, { recursive: true });
      n = 0;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1, maxWidth: 780, maxHeight: 1688 });
      await fn();
      await cdp.send('Page.stopScreencast');
      dir = '';
    };
    const center = async (testId) => {
      const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    // Ring state, sampled every animation frame while a hold runs.
    const sampleRing = () => page.evaluate(() => new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      const tick = () => {
        const ring = document.querySelector('[data-testid="tab-bar-hold-ring"]');
        const path = ring?.querySelector('path:last-of-type');
        out.push({
          t: Math.round(performance.now() - t0),
          visible: ring ? getComputedStyle(ring).opacity !== '0' : false,
          dashoffset: path ? Number(path.getAttribute('stroke-dashoffset') ?? getComputedStyle(path).strokeDashoffset.replace('px', '')) : null,
        });
        if (performance.now() - t0 < 1400) requestAnimationFrame(tick);
        else resolve(out);
      };
      requestAnimationFrame(tick);
    }));

    // 1. Early release.
    let p = await center('buyer-tab-profile');
    await record('1-early-release', async () => {
      const samples = sampleRing();
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(320);
      await page.mouse.up();
      result.earlyRelease = { ring: await samples };
      await page.waitForTimeout(300);
    });
    result.earlyRelease.pathAfter = await page.evaluate(() => location.pathname + location.search);

    // 2. Full hold.
    p = await center('buyer-tab-profile');
    await record('2-full-hold-switch', async () => {
      const samples = sampleRing();
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
      result.fullHold = { ring: await samples };
      await page.waitForTimeout(1200);
    });
    result.fullHold.pathAfter = await page.evaluate(() => location.pathname + location.search);
    result.fullHold.toast = await page.locator('[data-testid="quick-switch-toast"]').innerText().catch(() => null);
    result.fullHold.sellerBar = await page.locator('[data-testid="seller-global-tab-bar"]').count();
    await page.screenshot({ path: path.join(outDir, 'after-switch.png') });

    // 3. Plain tap opens Profile (back on the buyer side first).
    await page.goto(`${server.origin}/?bt_preview=buyer`);
    await page.waitForSelector('[data-testid="buyer-tab-profile"]', { timeout: 20_000 });
    await page.waitForTimeout(1500);
    p = await center('buyer-tab-profile');
    await record('3-tap-opens-profile', async () => {
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(800);
    });
    result.tap = { pathAfter: await page.evaluate(() => location.pathname) };
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  const summarize = (ring) => {
    const shown = ring.filter((s) => s.visible);
    return { firstVisibleMs: shown[0]?.t ?? null, lastVisibleMs: shown.at(-1)?.t ?? null, minDashoffset: shown.length ? Math.min(...shown.map((s) => s.dashoffset ?? Infinity)) : null };
  };
  const summary = {
    label,
    earlyRelease: { ...summarize(result.earlyRelease.ring), pathAfter: result.earlyRelease.pathAfter },
    fullHold: { ...summarize(result.fullHold.ring), pathAfter: result.fullHold.pathAfter, toast: result.fullHold.toast, sellerBarShown: result.fullHold.sellerBar > 0 },
    tap: result.tap,
  };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ summary, raw: result }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
