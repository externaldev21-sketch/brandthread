#!/usr/bin/env node
/**
 * 393x852 screenshots for the product-trust pass (BT-260..263): share control
 * in the product page header, the "Shipping $X · Free over $Y" line, the
 * seller's own return/cancellation policy, and the Shop sheet without
 * placeholder shipping/returns promises.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer,
 * fake API). GET /api/public/products/:id is served from the harness's own
 * product row, either with the seller fields the API now returns
 * (`seller`) or without them (`none`, a seller who set nothing).
 *
 *   node scripts/product-trust-screenshots.mjs [--skip-build]
 *
 * Output: ../../screenshots/revenue-p1/product-trust/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/revenue-p1/product-trust');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';

const SELLER_FIELDS = {
  sellerReturnPolicy: 'Returns accepted within 30 days of delivery. Items must be unworn with tags attached.',
  sellerCancellationPolicy: 'Cancel any time before your order ships.',
  sellerShipping: { rateCents: 595, freeAboveCents: 7500, processingDays: 2 },
};

async function context(browser, images, origin, mode) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}`), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
    const body = mode === 'seller' ? { ...base, ...SELLER_FIELDS } : base;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
      body: JSON.stringify(body),
    });
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  return { context, page, activity };
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

async function productPage(browser, images, origin, mode) {
  const { context: ctx, page, activity } = await context(browser, images, origin, mode);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
    try { await page.getByTestId('product-share-button').waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  console.log(`  [${mode}] shipping line:`, await page.getByTestId('product-shipping-line').textContent().catch(() => '(hidden)'));
  await shot(page, `pdp-${mode}-top`);
  // Price + shipping line in view.
  await page.getByTestId('product-cart-button').evaluate(() => window.scrollTo(0, 0));
  const name = page.getByText('Returns', { exact: true }).first();
  await name.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await shot(page, `pdp-${mode}-policies`);
  await ctx.close();
}

async function shopSheet(browser, images, origin, mode) {
  const { context: ctx, page, activity } = await context(browser, images, origin, mode);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/(buyer)');
    try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) {
    await guide.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);
  }
  const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
  await pill.click({ timeout: 8_000 });
  await page.waitForTimeout(700);
  await pill.click({ timeout: 8_000 });
  const sheet = page.getByTestId('shop-product-sheet');
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  // Multi-product sheets open on a list: tap the jacket row for its detail view.
  const row = sheet.getByText('Field Shell Jacket — Rust', { exact: true }).first();
  if (await row.isVisible().catch(() => false) && !(await sheet.getByRole('radio').first().isVisible().catch(() => false))) {
    await row.click();
    await page.waitForTimeout(1500);
  }
  await sheet.getByRole('radio').first().scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, `shop-sheet-${mode}`);
  await sheet.getByText('Secure checkout').first().scrollIntoViewIfNeeded().catch(() => {});
  console.log(`  [${mode}] trust cues:`, JSON.stringify(await sheet.evaluate((el) => ['Secure checkout', 'Returns accepted', 'Easy returns', 'Fast shipping', 'Ships in 2-3 days']
    .filter((t) => el.innerText.includes(t)))));
  await shot(page, `shop-sheet-${mode}-trust`);
  await ctx.close();
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const mode of ['seller', 'none']) {
      await productPage(browser, images, server.origin, mode);
      await shopSheet(browser, images, server.origin, mode);
    }
  } finally {
    await browser.close();
    await server.close?.();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
