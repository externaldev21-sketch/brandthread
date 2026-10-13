#!/usr/bin/env node
/**
 * PR screenshots for Numbered pieces at 393x852:
 *   seller: add-product → Sales model → "Numbered run" on, run size
 *   buyer:  Closet tab with a numbered piece, its proof card
 *
 *   node scripts/numbered-screenshots.mjs [--build <dir>] [--out <dir>] [--before]
 *
 * --before shoots only the seller's Sales model section (run it against a
 * build of origin/dev). Output defaults to docs/pr-assets/numbered/{ours,before}.
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
const OUT = path.resolve(arg('--out', path.resolve(MOBILE_ROOT, `../../docs/pr-assets/numbered/${BEFORE ? 'before' : 'ours'}`)));
const API = 'https://api.brandthread.test';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const day = (d) => `2026-${d}T15:00:00.000Z`;

const PIECES = [
  { id: uuid(11), orderId: uuid(1), productId: uuid(21), name: 'Field Shell Jacket — Drop 04', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 18_500, imageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, orderedAt: day('10-01'), deliveredAt: day('10-06'), edition: { number: 14, quantity: 1, size: 200 } },
  { id: uuid(12), orderId: uuid(1), productId: uuid(22), name: 'Heavyweight Hoodie', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 9800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg`, orderedAt: day('10-01'), deliveredAt: day('10-06'), edition: null },
  { id: uuid(13), orderId: uuid(2), productId: uuid(23), name: 'Utility Cargo', brand: 'Field Office', sellerId: 's2', size: '32', priceCents: 12_000, imageUrl: `${IMAGE_HOST}/cargo-rust.jpg`, orderedAt: day('09-20'), deliveredAt: day('09-25'), edition: null },
  { id: uuid(14), orderId: uuid(2), productId: uuid(24), name: 'Trail Runner 02', brand: 'Field Office', sellerId: 's2', size: '10', priceCents: 14_000, imageUrl: `${IMAGE_HOST}/runner-stone.jpg`, orderedAt: day('09-20'), deliveredAt: day('09-25'), edition: { number: 7, quantity: 1, size: 50 } },
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
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await waitForImages(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${name}.png`);
}
async function step(page, label, fn) {
  try { await fn(); } catch (err) {
    console.error(`  ✗ ${label}: ${String(err?.message ?? err).split('\n')[0]}`);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  }
}
async function goTo(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await openScreen(page, activity, origin, role, target, { extraQuery: '&demo=1' });
    await page.waitForTimeout(800);
    if ((await page.evaluate(() => window.location.pathname)).startsWith(target.split('?')[0])) break;
  }
  await waitForQuietNetwork(activity, 600, 8000);
  await page.waitForTimeout(600);
}

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  try {
    const seller = await openContext(browser, { device, role: 'seller', origin, images });
    await step(seller.page, 'seller-run', async () => {
      const { page, activity } = seller;
      await goTo(page, activity, origin, 'seller', '/add-product');
      const header = page.getByText('Sales model', { exact: true }).first();
      await header.scrollIntoViewIfNeeded({ timeout: 15_000 });
      await header.click();
      await page.waitForTimeout(500);
      if (!BEFORE) {
        await page.getByTestId('numbered-run-switch').click();
        await page.getByPlaceholder('200').fill('200');
        await page.getByPlaceholder('200').scrollIntoViewIfNeeded();
      } else {
        await page.getByText('Accept pre-orders').first().scrollIntoViewIfNeeded();
      }
      await page.mouse.wheel(0, 120);
      await shot(page, '01-seller-sales-model');
    });
    await seller.context.close();
    if (BEFORE) return;

    const buyer = await openContext(browser, { device, role: 'buyer', origin, images });
    await buyer.page.route(rx('/buyer/closet/pieces'), (r) => fulfill(r, origin, { pieces: PIECES }));
    await buyer.page.route(rx('/buyer/closet/outfits'), (r) => fulfill(r, origin, { outfits: [] }));
    await step(buyer.page, 'closet', async () => {
      const { page, activity } = buyer;
      await openScreen(page, activity, origin, 'buyer', '/', { extraQuery: '&demo=1' });
      await page.getByLabel('Profile tab').first().click({ timeout: 15_000 });
      await page.getByTestId('profile-tab-closet').click({ timeout: 15_000 });
      await page.getByTestId(`closet-piece-${PIECES[0].id}`).waitFor({ timeout: 10_000 });
      await page.getByTestId('profile-tab-posts').scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 260);
      await shot(page, '02-closet-numbered-piece');
      await page.getByTestId(`closet-piece-${PIECES[0].id}`).click();
      await page.getByTestId('closet-proof-card').waitFor({ timeout: 8000 });
      await shot(page, '03-proof-card');
    });
    await buyer.context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Done → ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
