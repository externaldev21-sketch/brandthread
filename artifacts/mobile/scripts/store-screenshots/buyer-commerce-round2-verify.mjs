#!/usr/bin/env node
/**
 * Buyer commerce round 2 (docs/audit/buyer-commerce.md) at 390x844, on the
 * preview web build with the demo API (harness.mjs). Run after a
 * preview build (harness.mjs buildPreviewWeb, e.g. `pnpm run screenshots` once):
 *   node scripts/store-screenshots/buyer-commerce-round2-verify.mjs [outDir]
 * Writes one PNG per screen and prints the facts each fix depends on.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'buyer-commerce-round2'));
mkdirSync(OUT, { recursive: true });
const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const DESKTOP = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: false, userAgent: undefined };

const server = await serveBuild(DEFAULT_BUILD_DIR);
// PW_CHROMIUM: a preinstalled Chromium when the project's Playwright has none of its own.
const browser = process.env.PW_CHROMIUM
  ? await (await import('playwright')).chromium.launch({ executablePath: process.env.PW_CHROMIUM })
  : await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));

async function screen(name, target, { device = DEVICE, routes = [], prepare, log, direct = false } = {}) {
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
  for (const [match, body, status = 200] of routes) {
    await context.route((url) => url.hostname === 'api.brandthread.test' && match.test(url.pathname), (route) => {
      const req = route.request();
      const cors = { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(typeof body === 'function' ? body(req) : body) });
    });
  }
  try {
    // `direct`: load the route itself (the feed under the stack can fail on
    // its own in this harness, taking a pushed screen down with it).
    if (direct) {
      await page.goto(`${server.origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=buyer`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    } else {
      await openScreen(page, activity, server.origin, 'buyer', target);
    }
    await page.waitForTimeout(2500);
    await waitForQuietNetwork(activity, 800, 15_000);
    await waitForImages(page);
    await prepare?.(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    if (log) console.log(name, JSON.stringify(await log(page)));
    else console.log('wrote', name);
  } catch (error) {
    console.log('FAILED', name, error.message.split('\n')[0]);
    await page.screenshot({ path: path.join(OUT, `${name}-failed.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

const text = (page, re) => page.evaluate((src) => {
  const rx = new RegExp(src);
  return [...document.querySelectorAll('div,span')].filter(el => el.children.length === 0 && rx.test(el.textContent ?? '')).map(el => el.textContent.trim()).slice(0, 12);
}, re.source);

const LIVE = [/\/public\/checkout-config$/, { live: true, mode: 'test', applePay: false, googlePay: false, reason: null }];
// The cart's quote for a complete address: $12 shipping per seller + tax.
const QUOTE = [/\/checkout\/payment-intent\/quote$/, () => ({
  amountCents: 52_844,
  paymentMethodTypes: ['card'],
  groups: [
    { sellerId: 'user_brand_northline', subtotalCents: 31_800, shippingCents: 1_200, discountCents: 0, taxCents: 2_624, totalCents: 35_624 },
    { sellerId: 'user_brand_field', subtotalCents: 16_500, shippingCents: 1_200, discountCents: 0, taxCents: 1_420, totalCents: 19_120 },
  ],
})];
const ORDER_ID = '3f2b8c1e-9d4a-4b7e-8f21-0c6d5e4a3b21';
try {
  await screen('pdp-touch', '/buyer-product-detail?productId=prod_nl_hoodie_ember', {
    direct: true,
    log: async (page) => {
      const pill = await page.getByTestId('gallery-pinch-hint').boundingBox().catch(() => null);
      const photo = await page.getByTestId('product-gallery-photo').first().boundingBox().catch(() => null);
      return { pinchHint: pill, photo, countdown: await text(page, /(ends in|close in) \d/i) };
    },
  });
  await screen('pdp-desktop', '/buyer-product-detail?productId=prod_nl_hoodie_ember', {
    direct: true,
    device: DESKTOP,
    log: async (page) => ({ pinchHints: await page.getByTestId('gallery-pinch-hint').count() }),
  });
  await screen('pdp-picker', '/buyer-product-detail?productId=prod_nl_jacket_rust', {
    direct: true,
    prepare: async (page) => { await page.getByTestId('product-buy-now').click().catch(() => {}); await page.waitForTimeout(1500); },
    log: async (page) => ({ confirm: await text(page, /^Select /) }),
  });
  await screen('bag', '/cart', {
    log: async (page) => ({ brandLines: await text(page, /^(Shipping \$|Free shipping)/), total: await text(page, /^\$[\d,.]+$|Calculated at checkout|^Free$/) }),
  });
  await screen('bag-bottom', '/cart', {
    prepare: async (page) => { await page.mouse.move(195, 400); for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 600); },
    log: async (page) => ({ summary: await page.getByTestId('cart-order-summary').innerText().catch(() => null), saved: await text(page, /Saved for later/) }),
  });
  await screen('checkout', '/buyer-checkout?source=cart', {
    direct: true,
    routes: [LIVE, QUOTE],
    prepare: async (page) => { await page.mouse.move(195, 400); for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 500); },
    log: async (page) => ({ delivery: await text(page, /after it ships|Ships in/), tax: await page.getByTestId('checkout-tax-line').innerText().catch(() => null) }),
  });
  await screen('orders', '/orders');
  await screen('order-detail-tracking', `/buyer-order-detail?id=${ORDER_ID}&focus=tracking`, {
    log: async (page) => ({ scrolled: await page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].map(d => d.scrollTop))) }),
  });
  await screen('addresses', '/buyer-addresses', {
    routes: [[/\/buyer\/addresses\/?$/, [
      { id: 'a1', label: 'Home', recipientName: 'Ari Lane', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 503 555 0142', isDefault: true },
      { id: 'a2', label: 'Studio', recipientName: 'Ari Lane', street: '88 Queen St W', city: 'Toronto', state: 'ON', postalCode: 'M5H 2M9', country: 'CA', isDefault: false },
    ]]],
  });
  await screen('addresses-form', '/buyer-addresses', {
    prepare: async (page) => { await page.getByText(/Add (an |new )?address/i).first().click().catch(() => {}); await page.waitForTimeout(1200); },
  });
  await screen('payment-methods', '/buyer-payment-methods', {
    routes: [LIVE, [/\/buyer\/payment-methods\/?$/, { paymentMethods: [{ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2028, isDefault: true }] }]],
    log: async (page) => ({ addCard: await text(page, /Add card|Adding a card/) }),
  });
  await screen('disputes', '/disputes', {
    routes: [[/\/disputes\/?$/, [
      { id: 'dp_1', orderId: ORDER_ID, orderNumber: '#BT-10482', amount: 220, currency: 'eur', status: 'needs_response', reason: 'product_not_received', createdAt: '2026-09-10T00:00:00Z', dueBy: '2026-09-25T00:00:00Z', customerName: 'Ari Lane' },
      { id: 'dp_2', orderId: ORDER_ID, orderNumber: 'BT-10483', amount: 98, currency: 'usd', status: 'won', reason: 'fraudulent', createdAt: '2026-08-10T00:00:00Z', customerName: 'Sam Ito' },
    ]]],
    log: async (page) => ({ amounts: await text(page, /[€$]\s?\d/) }),
  });
  await screen('return-request-no-id', '/buyer-return-request', {
    log: async (page) => ({ copy: await text(page, /link|connection|find/i) }),
  });
} finally {
  await browser.close();
  server.close();
}
