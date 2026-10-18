#!/usr/bin/env node
/**
 * Buying flow at 390x844 for the launch-checkout PR: product page (top, size
 * picked + added, size guide, details, bottom), bag, checkout (live and "not
 * live yet") and the order confirmation. Production web export + the
 * store-screenshots fake API, plus the few endpoints this flow adds.
 *
 * Usage:
 *   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo node -e "import('./scripts/store-screenshots/harness.mjs').then(m=>m.buildPreviewWeb())"
 *   node scripts/store-screenshots/launch-checkout-capture.mjs <outDir> [prefix]
 *
 * js.stripe.com is unreachable here, so the live checkout renders its
 * Stripe-hosted fallback row instead of the card field.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER, PUBLIC_PRODUCTS, checkoutSession } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/screenshots/claude-launch-checkout'));
const PREFIX = process.argv[3] ?? 'after';
mkdirSync(OUT, { recursive: true });
const PRODUCT = PUBLIC_PRODUCTS[0];
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const SIZE_CHART = {
  unit: 'in',
  columns: ['Chest', 'Length', 'Sleeve'],
  rows: [
    { size: 'S', values: ['42', '27', '33'] },
    { size: 'M', values: ['45', '28', '34'] },
    { size: 'L', values: ['48', '29', '35'] },
    { size: 'XL', values: ['51', '30', '36'] },
  ],
};

async function extraApi(context, { live }) {
  const cors = (origin) => ({
    'access-control-allow-origin': origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  const answer = (pattern, body) => context.route(pattern, (route) => {
    const headers = cors(route.request().headers().origin);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await answer(/api\.brandthread\.test\/api\/(v1\/)?public\/checkout-config/, { live, mode: 'test', applePay: live, googlePay: live, reason: live ? null : 'missing_secret_key' });
  // The real GET /api/public/products/:id spreads the product row, so it
  // carries ownerId (the demo fixture only has sellerId).
  await answer(/seller-payment-status/, { ready: true });
  await answer(/api\.brandthread\.test\/api\/(v1\/)?shipping-rates\/calculate/, { shippingCents: 1200, rateName: 'Standard shipping', isFree: false, processingDays: 2 });
  await answer(new RegExp(`api\\.brandthread\\.test/api/(v1/)?public/products/${PRODUCT.id}$`), { ...PRODUCT, ownerId: PRODUCT.sellerId, sizeChart: SIZE_CHART });
}

async function session(browser, images, origin, { live, seed }) {
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await extraApi(context, { live });
  if (seed) await context.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, seed);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });
  const settle = async (ms = 900) => { await waitForQuietNetwork(activity, 600, 10_000); await waitForImages(page); await page.waitForTimeout(ms); };
  const scrollBy = async (dy) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, dy); await page.waitForTimeout(700); };
  const go = async (target, ready) => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', target);
      try { await page.getByText(ready).first().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(1500);
  };
  return { context, page, shot, settle, scrollBy, go };
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    // ── Product page + bag (checkout live) ──
    {
      const { context, page, shot, settle, scrollBy, go } = await session(browser, images, origin, { live: true });
      await go(`/buyer-product-detail?productId=${PRODUCT.id}`, '$98');
      await shot('01-pdp-top');
      await scrollBy(420); await shot('02-pdp-options');
      await page.getByTestId('product-size-guide-link').click().catch(() => console.log('no size guide link'));
      await settle(900); await shot('03-pdp-size-guide');
      await page.keyboard.press('Escape'); await page.mouse.click(195, 120); await settle(600);
      await page.getByText('M', { exact: true }).first().click().catch(() => console.log('no size M'));
      await page.getByTestId('product-add-to-cart').click().catch(() => console.log('no add'));
      await settle(1500); await shot('04-pdp-added');
      await scrollBy(700); await shot('05-pdp-seller');
      await scrollBy(4000); await shot('06-pdp-bottom');
      await go('/cart', /summary|Subtotal/i);
      await shot('07-bag');
      await scrollBy(1500); await shot('08-bag-summary');
      await go('/buyer-checkout', /Pay \$/);
      await shot('09-checkout');
      await scrollBy(800); await shot('10-checkout-payment');
      await scrollBy(3000); await shot('11-checkout-review');
      await context.close();
    }
    // ── Keys missing: "Checkout isn't live yet" ──
    {
      const { context, shot, go } = await session(browser, images, origin, { live: false });
      await go('/buyer-checkout', /isn.t live yet|Pay \$/);
      await shot('12-checkout-not-live');
      await context.close();
    }
    // ── Order confirmation ──
    {
      const base = checkoutSession();
      const paidGroups = Object.fromEntries(base.deliveryGroups.map((g, i) => [g.sellerId, { sessionId: `cs_${i}`, orderId: `ord_${i}`, orderNumber: `BT-10${42 + i}`, amountTotalCents: 0 }]));
      const confirmed = { ...base, step: 'confirmation', paidGroups };
      const { context, shot, go, scrollBy } = await session(browser, images, origin, { live: true, seed: [`bt:checkout:${BUYER_USER.id}:v1`, JSON.stringify(confirmed)] });
      await go('/buyer-checkout', /Thank you|Payment received|Order confirm/);
      await shot('13-confirmation');
      await scrollBy(900); await shot('14-confirmation-items');
      await context.close();
    }
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
