#!/usr/bin/env node
/**
 * Status-bar edge check (390x844): for each tab root on both sides, captures
 *   - rest:      the screen as it opens
 *   - scroll:    mid-scroll, content passing under the status bar
 *   - pull:      a simulated pull-down (the scroll content shifted 90px down,
 *                which is what an iOS bounce does; the web preview has no
 *                rubber-band of its own)
 * and, on Discover, sweeps scroll offsets looking for a hairline left just
 * under the top inset (the thin line Dev reported).
 *
 *   node scripts/store-screenshots/status-bar-edge-verify.mjs --out <dir> [--build] [--only a,b] [--scale 2|3]
 *
 * Every state also gets a zoomed crop of the top 120pt (`*-top.png`) at the
 * chosen device pixel ratio, for checking the top edge pixel by pixel.
 */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

const SCREENS = [
  { id: 'buyer-threads', role: 'buyer', path: '/(buyer)' },
  { id: 'buyer-discover', role: 'buyer', path: '/(buyer)/discover', sweep: true },
  { id: 'buyer-inbox', role: 'buyer', path: '/(buyer)/inbox' },
  { id: 'buyer-activity', role: 'buyer', path: '/(buyer)/activity' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)' },
  { id: 'seller-products', role: 'seller', path: '/(tabs)/products' },
  { id: 'seller-orders', role: 'seller', path: '/(tabs)/orders' },
  { id: 'seller-profile', role: 'seller', path: '/(tabs)/profile' },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** The tallest scrollable element on the page (the screen's main list). */
const MAIN_SCROLLER = `(() => {
  const s = [...document.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.getBoundingClientRect().height > 300;
  }).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height);
  return s[0] || null;
})()`;

async function shoot(page, out, name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: 'disabled', caret: 'hide' });
  await page.screenshot({ path: path.join(out, `${name}-top.png`), clip: { x: 0, y: 0, width: 390, height: 120 }, animations: 'disabled', caret: 'hide' });
}

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/status-bar-edge');
  const only = arg('--only')?.split(',');
  const scale = Number(arg('--scale') ?? 2);
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const report = [];
  try {
    for (const screen of SCREENS.filter((s) => !only || only.includes(s.id))) {
      const device = { viewport: { width: 390, height: 844 }, scale, isMobile: true };
      const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
      try {
        if (screen.role === 'buyer') {
          await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
        }
        await page.goto(`${origin}${screen.path}?bt_preview=${screen.role}&demo=1`);
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
        await waitForQuietNetwork(activity, 900, 15_000);
        await waitForImages(page, 8_000);
        await page.waitForTimeout(2000);
        await shoot(page, out, `${screen.id}-rest`);

        const mask = await page.evaluate(() => {
          const m = document.querySelector('[data-testid="status-bar-mask"]');
          const f = document.querySelector('[data-testid="status-bar-scroll-edge"]');
          const r = (m || f)?.getBoundingClientRect();
          return { kind: m ? 'mask' : f ? 'fade' : 'none', height: r ? Math.round(r.height) : 0 };
        });

        // Discover: find the offset where the search pill's bottom border sits
        // 1px under the top inset, and capture exactly that state.
        if (screen.sweep) {
          const offset = await page.evaluate(`((inset) => {
            const pill = document.querySelector('[data-testid="discover-search-bar"]');
            const sc = ${MAIN_SCROLLER};
            if (!pill || !sc) return null;
            const r = pill.getBoundingClientRect();
            return Math.max(0, Math.round(sc.scrollTop + r.bottom - inset - 1));
          })(${mask.height || 54})`);
          if (offset != null) {
            await page.evaluate(`((y) => { const sc = ${MAIN_SCROLLER}; sc.scrollTop = y; })(${offset})`);
            await page.waitForTimeout(500);
            await shoot(page, out, `${screen.id}-hairline`);
          }
          report.push({ screen: screen.id, hairlineOffset: offset });
        }

        // Mid-scroll.
        await page.evaluate(`(() => { const sc = ${MAIN_SCROLLER}; if (sc) sc.scrollTop = 140; })()`);
        await page.waitForTimeout(600);
        await shoot(page, out, `${screen.id}-scroll`);

        // Simulated pull-down: back to the top, then shift the scroll content
        // down the way an iOS rubber-band does (the top chrome stays put).
        await page.evaluate(`(() => {
          const sc = ${MAIN_SCROLLER};
          const target = sc ? sc.firstElementChild : document.querySelector('#root > div');
          if (sc) sc.scrollTop = 0;
          if (target) target.style.transform = 'translateY(90px)';
        })()`);
        await page.waitForTimeout(400);
        await shoot(page, out, `${screen.id}-pull`);

        report.push({ screen: screen.id, top: mask });
        console.log(`ok ${screen.id} ${JSON.stringify(mask)}`);
      } catch (e) {
        console.log(`FAILED ${screen.id} ${String(e.message).split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
