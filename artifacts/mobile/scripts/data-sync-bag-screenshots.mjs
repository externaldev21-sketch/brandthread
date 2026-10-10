#!/usr/bin/env node
/**
 * Bag + product page live sync, at 390×844 on the store-screenshots harness.
 *
 * The fake GET /api/buyer/cart answers like the real server now does: each
 * line carries `live` catalog fields (for the "before" prefix it answers like
 * origin/dev's server: the stored snapshots only) — one sold out, one with a single unit
 * left, one whose price the seller changed. The bag should show its existing
 * warnings for those (and nothing else should move). Then the product page
 * is opened, the seller "edits" the price behind it, and the app is
 * backgrounded/foregrounded: the page should show the new price.
 *
 *   node scripts/data-sync-bag-screenshots.mjs <origin> <outDir> <prefix> <demo|fresh>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { CART, PUBLIC_PRODUCTS, respond } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/data-sync-bag'));
const PREFIX = process.argv[4] ?? 'after';
const MODE = process.argv[5] === 'fresh' ? 'fresh' : 'demo';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const API = 'https://api.brandthread.test';

const live = (over) => ({ compareAtPriceCents: null, reason: null, priceChanged: false, available: true, ...over });
const [soldOut, lowStock, repriced] = CART.items;
const SERVER_CART = {
  items: [
    { ...soldOut, live: live({ priceCents: soldOut.priceCents, stock: 0, available: false, reason: 'out_of_stock' }), unavailable: true, isAvailable: false, unavailableReason: 'Out of stock' },
    // Seller lowered the price by $20 since this line was added.
    { ...lowStock, live: live({ priceCents: lowStock.priceCents, stock: 1 }) },
    { ...repriced, live: live({ priceCents: repriced.priceCents - 2000, compareAtPriceCents: repriced.compareAtPriceCents ?? null, stock: 9, priceChanged: true }) },
  ],
  savedItems: CART.savedItems.map((s) => ({ ...s, live: live({ priceCents: s.priceCents, stock: 4 }) })),
};

const PRODUCT_ID = lowStock.productId;
const baseProduct = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT_ID);
let sellerEdited = false;

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const fresh = MODE === 'fresh';
  const { context, page, activity } = await openContext(browser, {
    device, role: 'buyer', origin: ORIGIN, images,
    seedOptions: fresh ? { fresh: true } : {}, apiOptions: fresh ? { fresh: true } : {},
  });
  const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' };
  const json = (route, body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/cart' && request.method() === 'GET') {
      activity.lastApiAt = Date.now();
      // "before" = origin/dev's server: the stored snapshots only, no live fields.
      return json(route, PREFIX === 'before' ? CART : SERVER_CART);
    }
    if (p === '/api/buyer/cart/sync') return json(route, { ok: true, count: 0 });
    if (p === '/api/buyer/cart/validate') return json(route, { isValid: true, issues: [] });
    if (/payment-status/.test(p)) return json(route, { ready: true });
    if (p === `/api/public/products/${PRODUCT_ID}` && sellerEdited) {
      // The seller raised every variant's price by $10 behind the open page.
      const row = structuredClone(respond({ method: 'GET', path: `/api/public/products/${PRODUCT_ID}`, query: new URLSearchParams(), role: 'buyer', options: fresh ? { fresh: true } : {} }) ?? null);
      if (row && Array.isArray(row.variants)) {
        row.variants = row.variants.map((v) => ({ ...v, priceCents: (v.priceCents ?? 0) + 1000 }));
        if (typeof row.priceCents === 'number') row.priceCents += 1000;
      }
      return json(route, row ?? baseProduct);
    }
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  const extraQuery = fresh ? '' : '&demo=1';
  await openScreen(page, activity, ORIGIN, 'buyer', '/(buyer)/cart', { extraQuery });
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByText(/^Cart \(\d+\)$/).first().waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((q) => { history.pushState(history.state, '', `/cart?bt_preview=buyer${q}`); dispatchEvent(new PopStateEvent('popstate')); }, extraQuery);
    }
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-${MODE}-${name}.png`) });
    console.log(`  ✓ ${PREFIX}-${MODE}-${name}`);
  };
  await shot('01-bag-top');
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, 640);
  await page.waitForTimeout(700);
  await shot('02-bag-scrolled');

  const bagText = await page.evaluate(() => document.body.innerText);
  const result = {
    outOfStockWarning: /Out of stock/.test(bagText),
    lastOneLeft: /Last one left/.test(bagText),
    repricedShown: bagText.includes(`$${((repriced.priceCents - 2000) / 100).toFixed(2)}`),
  };

  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, 'buyer', `/buyer-product-detail?productId=${PRODUCT_ID}`, { extraQuery });
    try {
      await page.waitForFunction(() => location.pathname.includes('product-detail'), undefined, { timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt === 2) throw error; // a cold first load occasionally settles on "/" instead
    }
  }
  await page.waitForTimeout(3000);
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1000);
  await shot('03-product-page');

  // Seller edits the price; the buyer leaves the app and comes back.
  sellerEdited = true;
  await page.evaluate(() => {
    const set = (state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    set('hidden');
    setTimeout(() => set('visible'), 200);
  });
  await page.waitForTimeout(800);
  await waitForQuietNetwork(activity, 900, 10_000);
  await page.waitForTimeout(800);
  await shot('04-product-page-after-seller-edit');
  const productText = await page.evaluate(() => document.body.innerText);
  result.productPriceBefore = `$${(baseProduct.priceCents / 100).toFixed(2)}`;
  result.productShowsEditedPrice = productText.includes(`$${((baseProduct.priceCents + 1000) / 100).toFixed(2)}`);

  await context.close();
  await browser.close();
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
