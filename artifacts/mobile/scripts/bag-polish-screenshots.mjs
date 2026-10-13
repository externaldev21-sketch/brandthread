#!/usr/bin/env node
/**
 * Polish 111–112: bag with two brands at 393×852 (@2x), before/after.
 *
 * Drives the real web build through the store-screenshots harness (signed-in
 * demo buyer, fake API). The demo bag holds two brands: Northline Studio
 * (2 lines; the jacket's stock is set to 5 here, above the row's own
 * low-stock badge threshold of 3) and Field Office (1 line). Per-seller
 * shipping is overridden per shot so the two brands differ:
 * Northline $5.95, Field Office free.
 *
 *   node scripts/bag-polish-screenshots.mjs --label after  [--skip-build] [--build-dir DIR]
 *   node scripts/bag-polish-screenshots.mjs --label before --build-dir DIR   (build of origin/dev)
 *
 * Output: docs/pr-assets/bag-polish/<label>-*.png (repo root).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { CART, SELLER_USER } from './store-screenshots/demo-data.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const LABEL = arg('--label', 'after');
const BUILD_DIR = path.resolve(arg('--build-dir', DEFAULT_BUILD_DIR));
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/bag-polish');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const RATES = { [SELLER_USER.id]: 595, user_field: 0 };
const JACKET = 'line_2'; // Field Shell Jacket — Rust
const JACKET_STOCK = 5;
const BAG = { ...CART, items: CART.items.map((i) => (i.id === JACKET ? { ...i, maxQuantity: JACKET_STOCK } : i)) };

async function shot(page, name) {
  await page.waitForTimeout(500);
  const file = path.join(OUT, `${LABEL}-${name}.png`);
  await page.screenshot({ path: file, caret: 'hide' });
  console.log(`  ✓ ${path.relative(process.cwd(), file)}`);
}

/** Scrolls the bag's ScrollView so `testId` sits near the top of the viewport. */
async function scrollTo(page, testId, offset = 120) {
  await page.evaluate(({ id, off }) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return;
    let node = el.parentElement;
    while (node && !(node.scrollHeight > node.clientHeight + 4 && getComputedStyle(node).overflowY !== 'visible')) node = node.parentElement;
    if (!node) return el.scrollIntoView();
    node.scrollTop += el.getBoundingClientRect().top - off;
  }, { id: testId, off: offset });
  await page.waitForTimeout(400);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(BUILD_DIR, 'index.html'))) buildPreviewWeb(BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
    const rateCalls = [];
    // Registered after openContext, so it wins over the harness's catch-all.
    await context.route((url) => url.pathname.endsWith('/shipping-rates/calculate'), (route) => {
      const url = new URL(route.request().url());
      const sellerId = url.searchParams.get('sellerId');
      rateCalls.push(`${sellerId}:${url.searchParams.get('subtotalCents')}`);
      const cents = RATES[sellerId];
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context' } });
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' },
        contentType: 'application/json',
        body: JSON.stringify({ shippingCents: cents ?? 0, isFree: !cents, rateName: cents ? 'Standard shipping' : 'Free Shipping', processingDays: null }),
      });
    });
    await context.route((url) => url.pathname.endsWith('/buyer/cart'), (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' },
        contentType: 'application/json',
        body: JSON.stringify(BAG),
      });
    });
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)/cart');
      try { await page.getByTestId(`cart-qty-${JACKET}`).waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.waitForTimeout(800);

    await shot(page, '01-bag-top');
    await scrollTo(page, `cart-group-checkout-${SELLER_USER.id}`, 330);
    await shot(page, '02-brand1-footer');
    await scrollTo(page, 'cart-order-summary', 380);
    await shot(page, '03-brand2-footer-and-summary');

    // Stepper: jacket 1 → 5 (its stock), then + once more at the limit.
    await scrollTo(page, `cart-row-${JACKET}`, 160);
    const inc = page.getByTestId(`cart-qty-${JACKET}-increment`);
    for (let i = 0; i < JACKET_STOCK - 1; i++) { await inc.click(); await page.waitForTimeout(800); }
    if (await inc.isEnabled()) { await inc.click(); await page.waitForTimeout(600); }
    await shot(page, '04-stepper-at-stock-limit');
    const body = await page.evaluate(() => document.body.innerText);
    console.log('  rate calls:', rateCalls.join(', ') || '(none)');
    console.log('  shipping lines:', (body.match(/(Shipping \$[\d.]+|Free shipping)/g) ?? []).join(' | '));
    console.log('  summary shipping:', /Shipping & fees\n(\$[\d.,]+)/.exec(body)?.[1]);
    console.log('  limit note:', /Only \d+ left/.exec(body)?.[0]);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
