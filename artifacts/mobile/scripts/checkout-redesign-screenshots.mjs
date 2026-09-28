#!/usr/bin/env node
/**
 * Live verification for the checkout redesign PR. Drives the real web build
 * (store-screenshots harness: signed-in demo buyer, seeded storage, fake API)
 * at 375×667, 390×844 and 430×932 and captures every state the PR shows.
 *
 *   node scripts/checkout-redesign-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/checkout-redesign/<width>/<shot>.jpg
 * No real server, account or payment provider is involved: Stripe calls are
 * answered by the fake API (and a slow/failed answer is used to show the
 * loading and error states).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/checkout-redesign');
const API = 'https://api.brandthread.test';
const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

const SAVED_ADDRESSES = [
  { id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true },
  { id: 'addr_studio', label: 'Studio', recipientName: 'Jordan Reyes', street: '2231 SE Division Street', city: 'Portland', state: 'OR', postalCode: '97202', country: 'US', phone: '+1 (503) 555-0142', isDefault: false },
];
const SAVED_CARDS = [
  { id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028, isDefault: true },
  { id: 'pm_2', brand: 'mastercard', last4: '4444', expMonth: 2, expYear: 2027, isDefault: false },
];

/** A single-item Buy Now session (the product page / Shop sheet path). */
function buyNowSession({ filled = true } = {}) {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = [
    { id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true },
  ];
  const subtotalCents = group.items[0].priceCents;
  const session = {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, totalCents: subtotalCents + 1200 },
  };
  if (filled) {
    session.shippingAddress = { ...session.shippingAddress, id: 'addr_home' };
  } else {
    delete session.contact;
    delete session.shippingAddress;
  }
  return session;
}

function confirmedSession() {
  const session = buyNowSession();
  const sellerId = session.deliveryGroups[0].sellerId;
  return {
    ...session,
    step: 'confirmation',
    paidGroups: { [sellerId]: { stripeSessionId: 'cs_demo', orderId: 'order_demo_1', orderNumber: 'BT-10482', amountTotalCents: session.summary.totalCents } },
  };
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

async function open(browser, { viewport, images, origin, session, api = {} }) {
  const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  // Scenario API answers, layered over the harness's fake API.
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/addresses' && request.method() === 'GET') return json(route, api.addresses ?? SAVED_ADDRESSES);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: api.cards ?? SAVED_CARDS });
    if (p === '/api/buyer/address-suggestions') {
      return json(route, [
        { placeId: 'pl_1', label: '1120 NW Everett St, Portland, OR 97209, USA' },
        { placeId: 'pl_2', label: '1120 NW Everett St #2, Portland, OR 97209, USA' },
        { placeId: 'pl_3', label: '1120 Everett Ave, Everett, WA 98201, USA' },
      ]);
    }
    if (p.startsWith('/api/buyer/address-suggestions/')) {
      return json(route, { line1: '1120 NW Everett St', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US' });
    }
    if (p === '/api/discount-codes/validate') {
      const code = url.searchParams.get('code');
      if (code === 'THREAD10') return json(route, { code: 'THREAD10', type: 'percentage', value: 10, appliedAmountCents: Math.round(Number(url.searchParams.get('subtotalCents')) / 10), description: '10% off your order' });
      return json(route, { error: 'EXPIRED', message: 'Expired' }, 400);
    }
    if (p === '/api/buyer/cart/validate') {
      if (api.soldOut) return json(route, { isValid: false, issues: [{ itemId: 'line_1', type: 'out_of_stock', message: 'Ember Heavyweight Hoodie (M) just sold out.' }] });
      return json(route, { isValid: true, issues: [] });
    }
    if (p === '/api/buyer/checkout/session' && request.method() === 'POST') {
      // Hold the request open so the loading state can be captured.
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      return json(route, { error: 'timeout' }, 500);
    }
    return route.fallback();
  });
  const ready = session.step === 'confirmation' ? 'Order details' : 'Order total';
  try {
    // The preview boot occasionally swallows the first client-side
    // navigation (same race capture.mjs tolerates); retry it.
    for (let attempt = 0; ; attempt++) {
      // Replace the harness's demo checkout with this scenario's session right
      // before navigating (init-script order isn't guaranteed, so not there).
      await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=buynow', {
        beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session)]),
      });
      try {
        await page.getByText(ready).first().waitFor({ timeout: 12_000 });
        // Occasionally the app restores the harness's demo session instead
        // of ours; verify what's on screen came from this scenario.
        const expected = session.deliveryGroups.flatMap((g) => g.items).length;
        const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), CHECKOUT_KEY);
        const items = stored?.deliveryGroups?.flatMap((g) => g.items).length;
        if (items !== expected) throw new Error(`stored session has ${items} items, scenario has ${expected}`);
        break;
      } catch (error) {
        if (attempt >= 4) throw error;
      }
    }
  } catch (error) {
    await page.screenshot({ path: path.join(WORK_DIR, 'checkout-debug.png') });
    console.error('  (debug screenshot at', path.join(WORK_DIR, 'checkout-debug.png'), ') url:', page.url());
    throw error;
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(500);
  return { context, page, activity };
}

async function shot(page, dir, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${path.basename(dir)}/${name}`);
}

async function scrollTo(page, testId, block = 'start') {
  await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
  await page.waitForTimeout(250);
}

/** Grows the viewport to the scroll content's full height for one long capture. */
async function tallShot(page, dir, name, viewport) {
  const extra = await page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible');
    const main = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    return main ? main.scrollHeight - main.clientHeight : 0;
  });
  await page.setViewportSize({ width: viewport.width, height: viewport.height + extra });
  await page.waitForTimeout(500);
  await shot(page, dir, name);
  await page.setViewportSize(viewport);
}

async function run() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const origin = server.origin;
  ORIGIN = origin;
  const onlyArg = process.argv.find((arg) => arg.startsWith('--width='));
  const widths = onlyArg ? onlyArg.slice(8).split(',').map(Number) : null;
  try {
    for (const viewport of VIEWPORTS.filter((v) => !widths || widths.includes(v.width))) {
      const dir = path.join(OUT, String(viewport.width));
      mkdirSync(dir, { recursive: true });
      const main = viewport.width === 390;

      // 1. Ready single-item Buy Now checkout, saved address + saved cards.
      {
        const { context, page } = await open(browser, { viewport, images, origin, session: buyNowSession() });
        await shot(page, dir, '01-checkout-top');
        await scrollTo(page, 'checkout-delivery');
        await shot(page, dir, '02-checkout-delivery-payment');
        await scrollTo(page, 'checkout-price-breakdown', 'end');
        await shot(page, dir, '03-checkout-breakdown-footer');
        await tallShot(page, dir, '00-checkout-full', viewport);

        // Promo success, then error.
        await scrollTo(page, 'checkout-promo', 'center');
        await page.getByTestId('checkout-promo-input').fill('THREAD10');
        await page.getByTestId('checkout-promo-apply').click();
        await page.getByTestId('checkout-promo-applied').waitFor({ timeout: 10_000 });
        await scrollTo(page, 'checkout-promo', 'start');
        await shot(page, dir, '06-promo-success');
        await page.getByLabel('Remove promo code THREAD10').click();
        await page.getByTestId('checkout-promo-input').fill('SUMMER5');
        await page.getByTestId('checkout-promo-apply').click();
        await page.getByText(/expired|invalid/i).first().waitFor({ timeout: 10_000 });
        await scrollTo(page, 'checkout-promo', 'center');
        await shot(page, dir, '07-promo-error');

        // Loading state: Place order while the Stripe session request is pending.
        await page.getByTestId('checkout-place-order').click();
        await page.waitForTimeout(700);
        await shot(page, dir, '10-placing-loading');
        await context.close();
      }

      // 2. Empty → filled: disabled button with "what's missing", then enabled.
      {
        const { context, page } = await open(browser, { viewport, images, origin, session: buyNowSession({ filled: false }), api: { addresses: [] } });
        await shot(page, dir, '04-disabled-empty');
        await page.getByTestId('checkout-email').fill('jordan@exam');
        await page.getByTestId('checkout-phone').click();
        await shot(page, dir, '05a-email-validation-error');
        await page.getByTestId('checkout-email').fill('jordan@example.com');
        await page.getByTestId('checkout-phone').fill('(503) 555-0142');
        await page.getByTestId('checkout-phone').blur();
        await scrollTo(page, 'checkout-shipping', 'center');
        await shot(page, dir, '05b-disabled-needs-address');
        await page.getByTestId('checkout-add-address').click();
        await page.getByText('Use this address').waitFor();
        await page.getByLabel('First name').fill('Jordan');
        await page.getByLabel('Last name').fill('Reyes');
        await page.getByLabel('Shipping address search').fill('1120 NW Ever');
        await page.getByText('1120 NW Everett St, Portland, OR 97209, USA').waitFor({ timeout: 10_000 });
        await shot(page, dir, '08-address-autocomplete');
        await page.getByText('1120 NW Everett St, Portland, OR 97209, USA').click();
        await page.waitForTimeout(600);
        await page.getByTestId('checkout-use-address').click();
        await page.waitForTimeout(600);
        await scrollTo(page, 'checkout-shipping', 'center');
        await shot(page, dir, '05c-enabled-after-fill');
        await context.close();
      }

      // 3. Multi-item cart checkout (3 items, 3 sellers) — collapsed summary.
      if (main) {
        const { context, page } = await open(browser, { viewport, images, origin, session: checkoutSession() });
        await shot(page, dir, '09-cart-multi-item');
        await tallShot(page, dir, '09b-cart-multi-item-full', viewport);
        await context.close();
      }

      // 4. Error state: an item sold out between Buy Now and Place order.
      {
        const { context, page } = await open(browser, { viewport, images, origin, session: buyNowSession(), api: { soldOut: true } });
        await page.getByTestId('checkout-place-order').click();
        await page.getByTestId('checkout-error').waitFor({ timeout: 10_000 });
        await shot(page, dir, '11-error-sold-out');
        await context.close();
      }

      // 5. Success screen.
      {
        const { context, page } = await open(browser, { viewport, images, origin, session: confirmedSession() });
        await shot(page, dir, '12-success');
        await tallShot(page, dir, '12b-success-full', viewport);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
