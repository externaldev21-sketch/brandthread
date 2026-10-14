#!/usr/bin/env node
/**
 * PR screenshots for the unboxing moment at 393x852: two frames of the box
 * opening, the settled "Post your fit" state, the same with Reduce Motion
 * (no animation at all), and the create flow it opens with the piece tagged.
 *
 *   node scripts/unboxing-screenshots.mjs [--build <dir>] [--out <dir>] [--before]
 *
 * --before: the app's first screen on the same account, for the "before"
 * column (run against a build of origin/dev).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BEFORE = process.argv.includes('--before');
const BUILD = arg('--build', DEFAULT_BUILD_DIR);
const OUT = path.resolve(arg('--out', path.resolve(MOBILE_ROOT, `../../docs/pr-assets/unboxing/${BEFORE ? 'before' : 'ours'}`)));
const API = 'https://api.brandthread.test';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PIECES = [
  { id: uuid(11), orderId: uuid(1), productId: uuid(21), name: 'Field Shell Jacket', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 18_500, imageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, orderedAt: '2026-10-08T15:00:00.000Z', deliveredAt: '2026-10-13T15:00:00.000Z', edition: null },
  { id: uuid(12), orderId: uuid(1), productId: uuid(22), name: 'Heavyweight Hoodie', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 9800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg`, orderedAt: '2026-10-08T15:00:00.000Z', deliveredAt: '2026-10-13T15:00:00.000Z', edition: null },
];

function rx(rest) {
  const esc = rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${API.replace(/[.]/g, '\\.')}/api(/v1)?${esc}(\\?.*)?$`);
}
async function fulfill(route, origin, body, status = 200) {
  const headers = {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
}
async function shot(page, name, settle = 300) {
  mkdirSync(OUT, { recursive: true });
  if (settle) { await page.waitForTimeout(settle); await waitForImages(page); }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  saved ${name}.png`);
}
async function step(page, label, fn) {
  try { await fn(); } catch (err) {
    console.error(`  ✗ ${label}: ${String(err?.message ?? err).split('\n')[0]}`);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  }
}

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const open = async (reducedMotion) => {
    const ctx = await openContext(browser, { device, role: 'buyer', origin, images, contextOptions: { reducedMotion } });
    let served = false;
    await ctx.page.route(rx('/buyer/closet/unboxing'), async (r) => {
      const body = served ? { unboxing: null } : { unboxing: { orderId: uuid(1), pieces: PIECES } };
      if (!served && reducedMotion !== 'reduce') {
        // Freeze the page clock before the moment mounts so the frames below
        // are taken at exact points of the 1.1 s animation.
        const now = await ctx.page.evaluate(() => Date.now());
        await ctx.page.clock.pauseAt(now + 50);
      }
      served = true;
      return fulfill(r, origin, body);
    });
    await ctx.page.route(rx('/buyer/closet/unboxing/seen'), (r) => fulfill(r, origin, { marked: 1 }));
    return ctx;
  };
  try {
    if (BEFORE) {
      const { context, page, activity } = await open('reduce');
      await step(page, 'home', async () => {
        await openScreen(page, activity, origin, 'buyer', '/', { extraQuery: '&demo=1' });
        await waitForQuietNetwork(activity, 800, 10_000);
        await shot(page, '01-first-open-after-delivery', 1500);
      });
      await context.close();
      return;
    }

    const motion = await open('no-preference');
    await step(motion.page, 'animation', async () => {
      const { page, activity } = motion;
      await page.goto(`${origin}/?bt_preview=buyer&demo=1`);
      await page.getByTestId('unboxing-moment').waitFor({ timeout: 30_000 });
      await waitForImages(page);
      await page.clock.runFor(330);
      await shot(page, '01-box-opening-330ms', 0);
      await page.clock.runFor(320);
      await shot(page, '02-piece-rising-650ms', 0);
      await page.clock.runFor(700);
      await page.clock.resume();
      await shot(page, '03-post-your-fit');
      await page.getByTestId('unboxing-post-fit').click();
      await page.getByTestId('create-camera-roll').click({ timeout: 15_000 });
      await page.getByTestId('post-picker').waitFor({ timeout: 10_000 });
      const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
      await page.getByTestId('picker-browse').click({ force: true, timeout: 8000 });
      await (await chooser).setFiles(images['look-rust'] ?? Object.values(images)[0]);
      await page.waitForTimeout(1500);
      await page.locator('[data-testid^="picker-tile-"]').last().click({ force: true, timeout: 8000 });
      await page.waitForTimeout(800);
      for (let i = 0; i < 4 && !(await page.getByTestId('row-closet-tags').isVisible().catch(() => false)); i += 1) {
        const next = page.getByRole('button', { name: /^next$/i }).first();
        if (await next.isVisible().catch(() => false)) await next.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      await page.getByTestId('row-closet-tags').waitFor({ timeout: 8000 });
      await shot(page, '05-post-step-piece-tagged');
      void activity;
    });
    await motion.context.close();

    const still = await open('reduce');
    await step(still.page, 'reduce-motion', async () => {
      await still.page.goto(`${origin}/?bt_preview=buyer&demo=1`);
      await still.page.getByTestId('unboxing-moment').waitFor({ timeout: 30_000 });
      await shot(still.page, '04-reduce-motion-no-animation', 200);
    });
    await still.context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Done → ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
