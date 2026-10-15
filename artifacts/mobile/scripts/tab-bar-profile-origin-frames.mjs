#!/usr/bin/env node
/**
 * Frame capture for the buyer tab bar's Profile -> tab pill origin fix: from
 * Profile, press Activity and capture the bar every frame we can, plus a
 * per-animation-frame sample of the pill's own translateX, so the frames
 * show where the bubble starts (the Profile circle after the fix, the far
 * left before it).
 *
 *   node scripts/tab-bar-profile-origin-frames.mjs --label after
 *   node scripts/tab-bar-profile-origin-frames.mjs --label before --build-dir <dir> --skip-build
 *
 * Output: docs/polish/screenshots/tab-bar-profile-origin/390x844/<label>/
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_TIME_ZONE, IMAGE_HOST, localStorageSeed, respond } from './store-screenshots/demo-data.mjs';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';

const VIEWPORT = { width: 390, height: 844 };
const DEMO_API = 'https://api.brandthread.test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

/** Real (non-reduced) motion context — see PR notes for why
 *  context.clock.install() is skipped and the intro-splash flag is
 *  pre-consumed (both needed to get past this sandbox's own startup
 *  animation, unrelated to the tab bar itself). */
async function openMotionContext(browser, origin) {
  const context = await browser.newContext({
    viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'no-preference',
  });
  await context.addInitScript(clerkStubScript(BUYER_USER));
  await context.addInitScript((seed) => {
    if (sessionStorage.getItem('bt:screenshot-seeded')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    localStorage.setItem('bt:intro-splash:launched:v1', 'true');
    sessionStorage.setItem('bt:screenshot-seeded', '1');
  }, localStorageSeed('buyer', {}));
  const activity = { lastApiAt: Date.now() };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    if (url.origin === IMAGE_HOST) return route.fulfill({ status: 404, body: '' });
    if (url.origin === DEMO_API) {
      const cors = {
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      activity.lastApiAt = Date.now();
      const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
      if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.bringToFront();
  return { context, page, activity };
}


async function main() {
  const label = arg('label', 'after');
  const buildDir = path.resolve(arg('build-dir', DEFAULT_BUILD_DIR));
  const outDir = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'tab-bar-profile-origin', '390x844', label);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(buildDir);
  const { origin, close } = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const barClip = { x: 0, y: 844 - 130, width: 390, height: 130 };
  let index = 0;
  const shot = async (page, name) => {
    const file = path.join(outDir, `${String(++index).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, animations: 'allow', caret: 'hide', clip: barClip });
    console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
  };

  try {
    const motion = await openMotionContext(browser, origin);
    motion.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
    // Arrive on Profile from Home via a real tab press (Discover first —
    // see tab-bar-pill-glide-screenshots.mjs on why not to boot on Home).
    await openScreenReliably(motion.page, motion.activity, origin, 'buyer', '/discover');
    await motion.page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 20_000 });
    await waitForImages(motion.page);
    await motion.page.getByTestId('buyer-tab-index').click();
    await motion.page.waitForTimeout(900);
    await motion.page.getByTestId('buyer-tab-profile').click();
    await motion.page.waitForTimeout(1200);
    await shot(motion.page, 'rest-on-profile');

    // Sample the pill (the bar's only element with both translateX and
    // scaleY in its inline transform) every animation frame.
    await motion.page.evaluate(() => {
      const bar = document.querySelector('[data-testid="buyer-bottom-tab-bar"]');
      const pill = [...bar.querySelectorAll('div')].find((el) => /translateX\(.*scaleY/.test(el.style.transform));
      const samples = [];
      window.__pillSamples = samples;
      const t0 = performance.now();
      const tick = () => {
        const r = pill.getBoundingClientRect();
        samples.push({ t: Math.round(performance.now() - t0), centerX: Math.round(r.left + r.width / 2), width: Math.round(r.width), opacity: Number(getComputedStyle(pill).opacity).toFixed(2) });
        if (performance.now() - t0 < 900) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const el = motion.page.getByTestId('buyer-tab-activity');
    const box = await el.boundingBox();
    await motion.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await motion.page.mouse.down();
    const start = Date.now();
    while (Date.now() - start < 450) await shot(motion.page, `profile-to-activity-t${String(Date.now() - start).padStart(3, '0')}ms`);
    await motion.page.mouse.up();
    await motion.page.waitForTimeout(900);
    await shot(motion.page, 'rest-on-activity');
    const samples = await motion.page.evaluate(() => window.__pillSamples);
    const profileBox = await motion.page.getByTestId('buyer-tab-profile').boundingBox();
    const report = {
      label,
      profileCircleCenterX: Math.round(profileBox.x + profileBox.width / 2),
      activitySlotCenterX: Math.round(box.x + box.width / 2),
      samples,
    };
    writeFileSync(path.join(outDir, 'pill-samples.json'), JSON.stringify(report, null, 2));
    console.log(`profile circle center x=${report.profileCircleCenterX}, activity center x=${report.activitySlotCenterX}`);
    console.log('first samples:', JSON.stringify(samples.slice(0, 8)));
    await motion.context.close();
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
