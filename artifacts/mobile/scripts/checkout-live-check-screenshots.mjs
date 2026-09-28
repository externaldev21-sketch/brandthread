#!/usr/bin/env node
/**
 * Item 99 — live check of the redesigned checkout (PR #219) at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo
 * buyer/seller, seeded storage, fake API) through every card, both entry
 * paths (single-item Buy Now and multi-seller cart), express checkout and
 * Place order all the way to the success screen, the designed empty/error
 * states, and the seller-side Orders list for the order that checkout just
 * produced.
 *
 *   node scripts/checkout-live-check-screenshots.mjs [--skip-build] [--out=<dir>]
 *
 * Output: docs/pr-review/checkout-live-check-99/<shot>.jpg
 *
 * What is NOT real here: the API is the harness's fake API, and Stripe's
 * hosted page is replaced by about:blank (expo-web-browser's web
 * openBrowserAsync resolves "opened" immediately) with the verify call
 * answered as paid — so the whole client-side pay() loop runs for real, but
 * no Stripe session, webhook or database is involved.
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/checkout-live-check-99');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;
const ORDER = { id: 'ord_live_check_1', number: 'BT-00042' };

const SAVED_ADDRESSES = [
  { id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true },
  { id: 'addr_studio', label: 'Studio', recipientName: 'Jordan Reyes', street: '2231 SE Division Street', city: 'Portland', state: 'OR', postalCode: '97202', country: 'US', phone: '+1 (503) 555-0142', isDefault: false },
];
const SAVED_CARDS = [
  { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028, isDefault: true },
  { id: 'pm_2', brand: 'mastercard', last4: '4444', expMonth: 2, expYear: 2027, isDefault: false },
];

function buyNowSession({ filled = true, noMethods = false } = {}) {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = noMethods ? [] : [
    { id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true },
  ];
  if (noMethods) delete group.selectedMethodId;
  const subtotalCents = group.items[0].priceCents;
  const session = {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    summary: { ...base.summary, subtotalCents, shippingTotalCents: noMethods ? 0 : 1200, totalCents: subtotalCents + (noMethods ? 0 : 1200) },
  };
  if (filled) {
    session.shippingAddress = { ...session.shippingAddress, id: 'addr_home' };
  } else {
    delete session.contact;
    delete session.shippingAddress;
  }
  return session;
}

let ORIGIN = '';
function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

/**
 * api.pay: 'paid' (default) answers the Stripe session + verify as a paid
 * order, 'declined' as a card decline, 'hold' keeps the session request open.
 */
async function open(browser, images, origin, { session, api = {}, role = 'buyer', target }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const calls = [];
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    calls.push(`${request.method()} ${p}`);
    if (p === '/api/buyer/addresses' && request.method() === 'GET') return json(route, api.addresses ?? SAVED_ADDRESSES);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: api.cards ?? SAVED_CARDS });
    if (p === '/api/buyer/address-suggestions') {
      return json(route, [
        { placeId: 'pl_1', label: '1120 NW Everett St, Portland, OR 97209, USA' },
        { placeId: 'pl_2', label: '1120 NW Everett St #2, Portland, OR 97209, USA' },
      ]);
    }
    if (p.startsWith('/api/buyer/address-suggestions/')) {
      return json(route, { line1: '1120 NW Everett St', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US' });
    }
    if (p === '/api/discount-codes/validate') {
      if (api.promoDown) return json(route, { error: 'unavailable' }, 503);
      const code = url.searchParams.get('code');
      if (code === 'THREAD10') return json(route, { code: 'THREAD10', type: 'percentage', value: 10, appliedAmountCents: Math.round(Number(url.searchParams.get('subtotalCents')) / 10), description: '10% off your order' });
      return json(route, { error: 'EXPIRED', message: 'Expired' }, 400);
    }
    if (p === '/api/buyer/cart/validate') {
      if (api.soldOut) return json(route, { isValid: false, issues: [{ itemId: 'line_1', type: 'out_of_stock', message: 'Ember Heavyweight Hoodie (M) just sold out.' }] });
      return json(route, { isValid: true, issues: [] });
    }
    if (p === '/api/buyer/checkout/session' && request.method() === 'POST') {
      if (api.pay === 'hold') {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        return json(route, { error: 'timeout' }, 500);
      }
      const body = JSON.parse(request.postData() ?? '{}');
      calls.push(`  body: ${JSON.stringify({ items: body.items, contactEmail: body.contactEmail, idem: body.clientIdempotencyKey, ship: body.shippingAddress?.city })}`);
      return json(route, { sessionId: 'cs_live_check_1', url: 'about:blank' });
    }
    if (p.startsWith('/api/buyer/checkout/session/')) {
      if (api.pay === 'declined') {
        return json(route, { status: 'open', paymentStatus: 'unpaid', amountTotal: null, orderId: null, orderNumber: null, declineReason: 'card_declined' });
      }
      return json(route, { status: 'complete', paymentStatus: 'paid', amountTotal: session ? session.summary.totalCents : 0, orderId: ORDER.id, orderNumber: ORDER.number, declineReason: null });
    }
    if (p === '/api/orders' && api.sellerOrders) return json(route, api.sellerOrders);
    return route.fallback();
  });
  // Stripe's hosted page stand-in.
  context.on('page', (popup) => { void popup.close().catch(() => {}); });

  if (target) {
    await openScreen(page, activity, origin, role, target);
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.waitForTimeout(800);
    return { context, page, activity, calls };
  }

  const ready = session.step === 'confirmation' ? 'Order details' : 'Order total';
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=buynow', {
      beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session)]),
    });
    try {
      await page.getByText(ready).first().waitFor({ timeout: 12_000 });
      const expected = session.deliveryGroups.flatMap((g) => g.items).length;
      const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), CHECKOUT_KEY);
      const items = stored?.deliveryGroups?.flatMap((g) => g.items).length;
      if (items !== expected) throw new Error(`stored session has ${items} items, scenario has ${expected}`);
      break;
    } catch (error) {
      if (attempt >= 4) {
        await page.screenshot({ path: path.join(WORK_DIR, 'checkout-debug.png') });
        throw error;
      }
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(500);
  return { context, page, activity, calls };
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

async function scrollTo(page, testId, block = 'start') {
  await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
  await page.waitForTimeout(250);
}

async function tallShot(page, name) {
  const extra = await page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible');
    const main = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return main ? main.scrollHeight - main.clientHeight : 0;
  });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
  await page.waitForTimeout(500);
  await shot(page, name);
  await page.setViewportSize(VIEWPORT);
}

/** Every Inter check + nested-pressable check on the live DOM. */
async function audit(page, label) {
  const result = await page.evaluate(() => {
    const nonInter = new Set();
    for (const el of document.querySelectorAll('div[dir], span')) {
      if (!el.textContent?.trim() || el.children.length) continue;
      const family = getComputedStyle(el).fontFamily;
      if (!/inter/i.test(family)) nonInter.add(`${family} :: ${el.textContent.trim().slice(0, 40)}`);
    }
    const nested = [];
    for (const el of document.querySelectorAll('[role="button"],[role="radio"],[role="checkbox"],button')) {
      const inner = el.querySelector('[role="button"],[role="radio"],[role="checkbox"],button');
      if (inner) nested.push(`${el.getAttribute('aria-label') ?? el.textContent.slice(0, 30)} > ${inner.getAttribute('aria-label') ?? inner.textContent.slice(0, 30)}`);
    }
    const placeholderCopy = [...document.body.innerText.matchAll(/\b(TODO|TBD|Lorem|FIXME|coming soon)\b/gi)].map((m) => m[0]);
    return { nonInter: [...nonInter].slice(0, 12), nested, placeholderCopy };
  });
  console.log(`  audit[${label}]`, JSON.stringify(result));
  return result;
}

async function run() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const origin = server.origin;
  ORIGIN = origin;
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7).split(',');
  const want = (key) => !only || only.includes(key);
  try {
    // 1. Buy Now (single item): every card top → bottom, then promo.
    if (want('buynow')) {
      const { context, page } = await open(browser, images, origin, { session: buyNowSession() });
      await audit(page, 'buynow');
      await shot(page, '01-buynow-summary-contact-shipping');
      await scrollTo(page, 'checkout-delivery');
      await shot(page, '02-buynow-delivery-payment');
      await scrollTo(page, 'checkout-promo');
      await shot(page, '03-buynow-promo-breakdown');
      await scrollTo(page, 'checkout-price-breakdown', 'end');
      await shot(page, '04-buynow-breakdown-footer');
      await tallShot(page, '00-buynow-full');
      await page.getByTestId('checkout-promo-input').fill('THREAD10');
      await page.getByTestId('checkout-promo-apply').click();
      await page.getByTestId('checkout-promo-applied').waitFor({ timeout: 10_000 });
      await scrollTo(page, 'checkout-promo', 'start');
      await shot(page, '05-promo-applied-discount-line');
      await page.getByLabel('Remove promo code THREAD10').click();
      await page.getByTestId('checkout-promo-input').fill('SUMMER5');
      await page.getByTestId('checkout-promo-apply').click();
      await page.getByText(/expired|invalid|isn’t valid/i).first().waitFor({ timeout: 10_000 });
      await scrollTo(page, 'checkout-promo', 'center');
      await shot(page, '06-promo-invalid');
      await context.close();
    }

    // 2. Promo service down.
    if (want('promodown')) {
      const { context, page } = await open(browser, images, origin, { session: buyNowSession(), api: { promoDown: true } });
      await scrollTo(page, 'checkout-promo', 'center');
      await page.getByTestId('checkout-promo-input').fill('THREAD10');
      await page.getByTestId('checkout-promo-apply').click();
      await page.waitForTimeout(1500);
      await shot(page, '07-promo-service-down');
      await context.close();
    }

    // 3. Empty buyer: no contact, no saved addresses → filled.
    if (want('empty')) {
      const { context, page } = await open(browser, images, origin, { session: buyNowSession({ filled: false }), api: { addresses: [], cards: [] } });
      await audit(page, 'empty');
      await shot(page, '08-empty-no-saved-address-disabled');
      await scrollTo(page, 'checkout-payment', 'center');
      await shot(page, '09-empty-no-saved-cards');
      await page.getByTestId('checkout-email').fill('jordan@example.com');
      await page.getByTestId('checkout-phone').fill('(503) 555-0142');
      await page.getByTestId('checkout-phone').blur();
      await page.getByTestId('checkout-add-address').click();
      await page.getByText('Use this address').waitFor();
      await page.getByLabel('First name').fill('Jordan');
      await page.getByLabel('Last name').fill('Reyes');
      await page.getByLabel('Shipping address search').fill('1120 NW Ever');
      await page.getByText('1120 NW Everett St, Portland, OR 97209, USA').waitFor({ timeout: 10_000 });
      await shot(page, '10-address-sheet-autocomplete');
      await page.getByText('1120 NW Everett St, Portland, OR 97209, USA').click();
      await page.waitForTimeout(600);
      await page.getByTestId('checkout-use-address').click();
      await page.waitForTimeout(600);
      await scrollTo(page, 'checkout-shipping', 'center');
      await shot(page, '11-filled-enabled');
      await context.close();
    }

    // 4. No delivery options returned for the seller.
    if (want('nodelivery')) {
      const { context, page } = await open(browser, images, origin, { session: buyNowSession({ noMethods: true }) });
      await scrollTo(page, 'checkout-delivery', 'center');
      await shot(page, '12-delivery-no-options');
      await context.close();
    }

    // 5. Express checkout → Stripe (stand-in) → verified → success screen.
    if (want('express')) {
      const { context, page, calls } = await open(browser, images, origin, { session: buyNowSession() });
      await scrollTo(page, 'checkout-payment', 'center');
      await page.getByTestId('checkout-express-pay').click();
      await page.getByTestId('checkout-confirmation').waitFor({ timeout: 20_000 });
      await page.waitForTimeout(900);
      await audit(page, 'success');
      await shot(page, '13-express-success');
      await tallShot(page, '14-express-success-full');
      console.log('  api calls:', calls.filter((c) => /checkout|validate|  body/.test(c)).join(' | '));
      await context.close();
    }

    // 6. Place order (footer) from the multi-seller cart path → success.
    if (want('cart')) {
      const { context, page, calls } = await open(browser, images, origin, { session: checkoutSession() });
      await audit(page, 'cart');
      await shot(page, '15-cart-multi-seller-top');
      await scrollTo(page, 'checkout-delivery');
      await shot(page, '16-cart-multi-seller-delivery-payment');
      await tallShot(page, '17-cart-multi-seller-full');
      await page.getByTestId('checkout-place-order').click();
      await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
      await page.waitForTimeout(900);
      await shot(page, '18-cart-place-order-success');
      console.log('  api calls:', calls.filter((c) => /checkout\/session/.test(c)).length, 'session/verify calls');
      await context.close();
    }

    // 7. Loading + errors.
    if (want('errors')) {
      {
        const { context, page } = await open(browser, images, origin, { session: buyNowSession(), api: { pay: 'hold' } });
        await page.getByTestId('checkout-place-order').click();
        await page.waitForTimeout(700);
        await shot(page, '19-placing-loading');
        await context.close();
      }
      {
        const { context, page } = await open(browser, images, origin, { session: buyNowSession(), api: { pay: 'declined' } });
        await page.getByTestId('checkout-place-order').click();
        await page.getByTestId('checkout-error').waitFor({ timeout: 20_000 });
        await shot(page, '20-payment-declined-retry');
        await context.close();
      }
      {
        const { context, page } = await open(browser, images, origin, { session: buyNowSession(), api: { soldOut: true } });
        await page.getByTestId('checkout-place-order').click();
        await page.getByTestId('checkout-error').waitFor({ timeout: 10_000 });
        await shot(page, '21-sold-out');
        await context.close();
      }
    }

    // 8. Seller side: the order the buyer just placed, as the seller's
    //    Orders list sees it (row shape = GET /api/orders for a webhook-
    //    created checkout order: status "pending", paidAt set).
    if (want('seller')) {
      const now = new Date(Date.now()).toISOString();
      const sellerOrders = [{
        id: ORDER.id, orderNumber: ORDER.number, status: 'pending', totalCents: 16000,
        trackingNumber: null, carrier: null, cancellationReason: null,
        createdAt: now, updatedAt: now, paidAt: now,
        customerName: 'Jordan Reyes', customerEmail: 'jordan@example.com',
        dropName: null, dropType: null, itemCount: 1,
      }];
      const { context, page } = await open(browser, images, origin, { role: 'seller', target: '/(tabs)', api: { sellerOrders } });
      // The seller tab bar's Orders badge counts it as needing attention.
      await shot(page, '22a-seller-tabbar-orders-badge');
      await page.getByRole('tab', { name: /orders/i }).first().click().catch(() => page.getByLabel(/orders/i).first().click());
      await page.getByText(ORDER.number).first().waitFor({ timeout: 20_000 }).catch(async (e) => { await page.screenshot({ path: path.join(WORK_DIR, 'seller-debug.png') }); throw e; });
      await page.waitForTimeout(600);
      await shot(page, '22b-seller-orders-new-paid-order');
      await context.close();
      // Before this PR: GET /api/orders had no paidAt, so the same paid order
      // read as payment "Pending" and was counted under "Unpaid".
      const before = sellerOrders.map(({ paidAt, ...row }) => row);
      const again = await open(browser, images, origin, { role: 'seller', target: '/(tabs)', api: { sellerOrders: before } });
      await again.page.getByRole('tab', { name: /orders/i }).first().click().catch(() => again.page.getByLabel(/orders/i).first().click());
      await again.page.getByText(ORDER.number).first().waitFor({ timeout: 20_000 });
      await again.page.waitForTimeout(600);
      await shot(again.page, '22c-seller-orders-BEFORE-fix-shows-unpaid');
      await again.context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
