/**
 * Full-bleed proof for Threads at 390x844 on the `demo=1` web preview:
 * a video Thread (slot 1), a photo carousel slide (slot 4) and a single
 * photo Thread (slot 7). For each frame it also measures how many rows at
 * the very top and bottom are solid black (a letterbox band) so the result
 * is checkable, not just eyeballed.
 *   node e2e/threads-full-bleed-shots.mjs <outDir> [baseUrl] [prefix]
 */
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
let PNG;
try { ({ PNG } = require('pngjs')); } catch { ({ PNG } = require('../../../node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs')); }

const out = process.argv[2] ?? 'screenshots/threads-full-bleed';
const base = process.argv[3] ?? 'http://127.0.0.1:8081';
const prefix = process.argv[4] ?? 'after';
const W = 390;
const H = 844;

/** Rows (in CSS px) at the top/bottom edge whose pixels are all near-black. */
function blackBands(buf, scale) {
  const png = PNG.sync.read(buf);
  const rowBlack = (y) => {
    for (let x = 0; x < png.width; x += 3) {
      const i = (png.width * y + x) * 4;
      if (png.data[i] > 18 || png.data[i + 1] > 18 || png.data[i + 2] > 18) return false;
    }
    return true;
  };
  let top = 0;
  while (top < png.height && rowBlack(top)) top += 1;
  let bottom = 0;
  while (bottom < png.height && rowBlack(png.height - 1 - bottom)) bottom += 1;
  return { top: Math.round(top / scale), bottom: Math.round(bottom / scale) };
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.route(/\/api\//, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto(`${base}/?bt_preview=buyer&demo=1`, { waitUntil: 'domcontentloaded' });
await page.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important}' }).catch(() => {});
await page.waitForTimeout(7000);
await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2500 }).catch(() => {});
const guide = page.getByTestId('feed-gesture-guide');
if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(500); }

const results = {};
async function shot(name) {
  await page.waitForTimeout(2500);
  const buf = await page.screenshot({ path: `${out}/${prefix}-${name}.png` });
  results[name] = blackBands(buf, 2);
}
async function nextThread(times = 1) {
  for (let i = 0; i < times; i += 1) {
    await page.mouse.move(W / 2, H / 2);
    await page.mouse.wheel(0, H);
    await page.waitForTimeout(1200);
  }
}

await shot('video');                // slot 1: official video
await nextThread(3);
await shot('carousel-slide1');      // slot 4: 6-photo slideshow
await page.mouse.move(W / 2, 600);
await page.mouse.wheel(W, 0);
await page.waitForTimeout(1200);
await page.mouse.wheel(W, 0);
await shot('carousel-slide3');
await nextThread(3);
await shot('single-photo');         // slot 7: single photo

// Following tab: its first page never resolves in the signed-out preview,
// so this frame is the Threads loading state.
await page.getByText('Following', { exact: true }).first().click().catch(() => {});
await shot('following-loading');

// A product-tagged post (Shop pill) on a fresh, signed-out preview.
const tagged = await context.newPage();
await tagged.route(/\/api\//, () => {});
await tagged.goto(`${base}/?bt_preview=buyer`, { waitUntil: 'domcontentloaded' });
await tagged.addStyleTag({ content: '#error-overlay,#error-toast{display:none!important}' }).catch(() => {});
await tagged.waitForTimeout(5000);
const taggedBuf = await tagged.screenshot({ path: `${out}/${prefix}-product-tagged.png` });
results['product-tagged'] = blackBands(taggedBuf, 2);

writeFileSync(`${out}/${prefix}-bands.json`, JSON.stringify(results, null, 2));
console.log(prefix, JSON.stringify(results));
await browser.close();
