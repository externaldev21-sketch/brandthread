#!/usr/bin/env node
/**
 * Bundles, both sides, live at 390×844 on the store-screenshots harness
 * (signed-in demo accounts, fake API). The bundle endpoints answer with the
 * exact JSON shapes the api-server returns (lib/bundlesPublic.ts).
 *
 * Buyer: product page "Bundle & save", storefront Bundles row, bundle detail
 * (size choice → Add bundle), cart with the "Bundle savings" line.
 * Seller: Products title menu → Bundles, bundles list with sales, order
 * detail payment breakdown with the bundle line.
 *
 *   node scripts/bundles-screenshots.mjs [buildDir]
 *   (builds the web app once into buildDir when it has no index.html)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { IMAGE_HOST, SELLER_USER } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'bundles-web-build'));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/bundles');
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const API = 'https://api.brandthread.test';
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

const SELLER_ID = SELLER_USER.id;
const BUNDLE_ID = '6f1c2a8e-4b7d-4c31-9a55-0d2e7b9c1a10';
const BUNDLE_2_ID = '8a3d5c71-2e9f-4b18-8c60-3f4a9d2b7e21';

const variant = (id, size, priceCents, stock = 12) => ({ id, size, color: null, priceCents, stock });
const BUNDLE = {
  id: BUNDLE_ID,
  sellerId: SELLER_ID,
  sellerName: 'Northline Studio',
  name: 'Ember Season Fit',
  description: 'The heavyweight hoodie and the utility cargo, cut to wear together.',
  images: [],
  bundlePriceCents: 19_600,
  itemsTotalCents: 22_600,
  compareAtCents: 22_600,
  savingsCents: 3_000,
  needsSelection: true,
  items: [
    {
      id: 'bi-hoodie', productId: 'prod_nl_hoodie_ember', variantId: null, quantity: 1,
      productName: 'Heavyweight Hoodie — Ember', image: img('hoodie-ember'), images: [img('hoodie-ember')],
      priceCents: 9_800, size: null, color: null,
      variants: [variant('v-hoodie-s', 'S', 9_800), variant('v-hoodie-m', 'M', 9_800), variant('v-hoodie-l', 'L', 9_800), variant('v-hoodie-xl', 'XL', 9_800, 3)],
    },
    {
      id: 'bi-cargo', productId: 'prod_nl_cargo_rust', variantId: 'v-cargo-32', quantity: 1,
      productName: 'Utility Cargo Pant — Rust', image: img('cargo-rust'), images: [img('cargo-rust')],
      priceCents: 12_800, size: '32', color: null, variants: [variant('v-cargo-32', '32', 12_800)],
    },
  ],
};
const BUNDLE_2 = {
  ...BUNDLE,
  id: BUNDLE_2_ID,
  name: 'Layering Kit',
  description: null,
  bundlePriceCents: 27_900,
  itemsTotalCents: 31_800,
  compareAtCents: 31_800,
  savingsCents: 3_900,
  items: [
    { ...BUNDLE.items[0], id: 'bi2-hoodie', productId: 'prod_nl_hoodie_bone', productName: 'Heavyweight Hoodie — Bone', image: img('hoodie-bone'), images: [img('hoodie-bone')] },
    {
      id: 'bi2-jacket', productId: 'prod_nl_jacket_rust', variantId: null, quantity: 1,
      productName: 'Field Shell Jacket — Rust', image: img('jacket-rust'), images: [img('jacket-rust')],
      priceCents: 22_000, size: null, color: null, variants: [variant('v-jacket-m', 'M', 22_000), variant('v-jacket-l', 'L', 22_000)],
    },
  ],
};

const SELLER_BUNDLES = [
  { id: BUNDLE_ID, ownerId: SELLER_ID, name: BUNDLE.name, description: BUNDLE.description, bundlePriceCents: 19_600, compareAtCents: 22_600, status: 'active', images: [], itemCount: 2,
    sales: { setsSold: 12, orderCount: 11, revenueCents: 235_200, discountCents: 36_000 } },
  { id: BUNDLE_2_ID, ownerId: SELLER_ID, name: BUNDLE_2.name, description: null, bundlePriceCents: 27_900, compareAtCents: 31_800, status: 'active', images: [], itemCount: 2,
    sales: { setsSold: 4, orderCount: 4, revenueCents: 111_600, discountCents: 15_600 } },
  { id: 'c2b7d1e4-9a3f-4e6b-8d21-5f0a7c3e9b42', ownerId: SELLER_ID, name: 'Rust Capsule', description: null, bundlePriceCents: 30_000, compareAtCents: 0, status: 'draft', images: [], itemCount: 3,
    sales: { setsSold: 0, orderCount: 0, revenueCents: 0, discountCents: 0 } },
];

const ORDER_ID = '1d9e4b2a-7c3f-4a81-b5e6-2f8c0d7a9e13';
const ORDER = {
  id: ORDER_ID, ownerId: SELLER_ID, buyerId: 'user_jordan', orderNumber: 'BT-00142', status: 'pending',
  totalCents: 18_388, subtotalCents: 22_600, shippingCents: 1_200, taxCents: 1_588, grossChargedCents: 18_388,
  discountAmountCents: 7_000, bundleDiscountCents: 3_000,
  bundleLines: [{ bundleId: BUNDLE_ID, name: BUNDLE.name, sets: 1, itemsCents: 22_600, bundlePriceCents: 19_600, discountCents: 3_000 }],
  paidAt: '2026-10-06T15:20:00.000Z', createdAt: '2026-10-06T15:20:00.000Z', updatedAt: '2026-10-06T15:20:00.000Z',
  shippingAddress: { name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
  items: [
    { id: 'oi-1', orderId: ORDER_ID, variantId: 'v-hoodie-m', productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', variantLabel: 'M', quantity: 1, priceCents: 9_800, bundleId: BUNDLE_ID },
    { id: 'oi-2', orderId: ORDER_ID, variantId: 'v-cargo-32', productId: 'prod_nl_cargo_rust', productName: 'Utility Cargo Pant — Rust', variantLabel: '32', quantity: 1, priceCents: 12_800, bundleId: BUNDLE_ID },
  ],
  customer: { id: 'c1', name: 'Jordan Reyes', email: 'jordan@example.com', orderCount: 3, totalSpentCents: 52_000, tags: [] },
  shopifyFulfillment: null,
};

async function routeBundles(context, origin) {
  let remoteCart = null; // what POST /api/buyer/cart/sync last stored
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (p.startsWith('/api/bundles/public/by-product/')) return json([BUNDLE]);
    if (p === `/api/bundles/public/bundle/${BUNDLE_ID}`) return json(BUNDLE);
    if (p === `/api/bundles/public/bundle/${BUNDLE_2_ID}`) return json(BUNDLE_2);
    if (p.startsWith('/api/bundles/public/')) return json([BUNDLE, BUNDLE_2]);
    if (p === '/api/bundles') return json(SELLER_BUNDLES);
    if (p === `/api/orders/${ORDER_ID}`) return json(ORDER);
    if (p === '/api/buyer/cart/sync') { remoteCart = JSON.parse(request.postData() ?? '{}'); return json({ ok: true }); }
    if (p === '/api/buyer/cart' && remoteCart) return json(remoteCart);
    if (p === '/api/buyer/cart/validate') return json({ isValid: true, issues: [], bundleDiscountCents: 3_000, bundles: [] });
    return route.fallback();
  });
}

async function settle(page, activity, ms = 900) {
  await waitForQuietNetwork(activity, ms, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(600);
}

async function navigate(page, role, target) {
  await page.evaluate(({ url }) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, { url: `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}` });
}

const shot = async (page, name) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
};

async function run() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const server = await serveBuild(BUILD);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const results = {};
  try {
    // ── Buyer ──────────────────────────────────────────────────────────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      await routeBundles(context, origin);
      page.setDefaultNavigationTimeout(240_000);

      await openScreen(page, activity, origin, 'buyer', '/buyer-product-detail?productId=prod_nl_hoodie_ember');
      const section = page.locator('[data-testid="product-bundle-section"]');
      await section.waitFor({ timeout: 30_000 });
      await settle(page, activity);
      await section.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settle(page, activity, 400);
      await shot(page, '01-buyer-product-bundle-section');

      await navigate(page, 'buyer', `/seller-profile?id=${SELLER_ID}`);
      await page.waitForTimeout(2500);
      const productsTab = page.getByRole('tab', { name: /products/i }).first();
      if (await productsTab.count()) await productsTab.click();
      else await page.getByLabel(/^Products/).first().click();
      const row = page.locator('[data-testid="store-bundles-row"]');
      await row.waitFor({ timeout: 30_000 });
      await settle(page, activity);
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settle(page, activity, 400);
      await shot(page, '02-buyer-storefront-bundles-row');

      await navigate(page, 'buyer', `/bundle-detail?bundleId=${BUNDLE_ID}`);
      await page.locator('[data-testid="bundle-add"]').waitFor({ timeout: 30_000 });
      await settle(page, activity);
      await shot(page, '03-buyer-bundle-detail');
      await page.locator('[data-testid="bundle-variant-v-hoodie-m"]').click();
      await page.locator('[data-testid="bundle-add"]').click();
      await page.getByText(/In your bag/).first().waitFor({ timeout: 15_000 });
      await shot(page, '04-buyer-bundle-added');

      await navigate(page, 'buyer', '/(buyer)/cart');
      await page.getByText(/^Cart \(\d+\)$/).first().waitFor({ timeout: 30_000 });
      await settle(page, activity);
      const summary = page.locator('[data-testid="cart-order-summary"]');
      await summary.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await settle(page, activity, 400);
      results.cartHasBundleSavings = await page.getByText('Bundle savings').count();
      await shot(page, '05-buyer-cart-bundle-savings');
      await context.close();
    }

    // ── Seller ─────────────────────────────────────────────────────────────
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
      await routeBundles(context, origin);
      page.setDefaultNavigationTimeout(240_000);

      await openScreen(page, activity, origin, 'seller', '/(tabs)/products');
      const title = page.getByLabel('Products, choose a view').first();
      await title.waitFor({ timeout: 30_000 });
      await settle(page, activity);
      await title.click();
      await page.getByText('Bundles', { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      await shot(page, '06-seller-products-menu-bundles-entry');
      await page.getByText('Bundles', { exact: true }).first().click();
      await page.locator(`[data-testid="bundle-sales-${BUNDLE_ID}"]`).waitFor({ timeout: 30_000 });
      await settle(page, activity);
      await shot(page, '07-seller-bundles-list-with-sales');

      await navigate(page, 'seller', `/order-detail?id=${ORDER_ID}`);
      await page.getByText(/BT-00142/).first().waitFor({ timeout: 30_000 }).catch(() => {});
      await settle(page, activity);
      const bundleTag = page.getByText(/^Bundle: Ember Season Fit$/).first();
      if (await bundleTag.count()) {
        await bundleTag.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await page.waitForTimeout(400);
      }
      await shot(page, '08-seller-order-items-bundle');
      const paymentTab = page.getByText(/^Payment$/).first();
      if (await paymentTab.count()) {
        await paymentTab.click();
        await page.waitForTimeout(800);
        await shot(page, '09-seller-order-payment-bundle-line');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
