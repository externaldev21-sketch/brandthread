#!/usr/bin/env node
/**
 * One-page checkout, live at 390×844 on the store-screenshots harness
 * (signed-in demo buyer, fake API, two sellers in the bag).
 *
 *   node scripts/one-page-checkout-screenshots.mjs <origin> <outDir> <before|after>
 *
 * "before" only pages through the old screen. "after" runs every scenario:
 *  - in-app, returning buyer: saved address + saved card rows, Apple Pay
 *    row on top, order summary by seller with delivery windows, then Pay →
 *    the order confirmation. The PaymentIntent request body is checked for
 *    card data (there must be none);
 *  - in-app, new buyer: the inline address form (state and country
 *    pickers) and the card field, then a new card entered and paid;
 *  - hosted fallback (hostedCheckoutFallback flag on): the same page, the
 *    Payment section says the card is entered on Stripe's page;
 *  - the header stays an opaque bar below the notch while the page scrolls.
 *
 * js.stripe.com is not reachable from this environment, so Stripe.js is
 * replaced by a small stub (below) that draws plain placeholders where
 * Stripe's Payment Element and Express Checkout Element would be, and
 * answers confirmPayment with "succeeded". Everything else is the app's
 * real code.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '../../docs/pr-review/one-page-checkout'));
const MODE = process.argv[4] ?? 'after';
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

const SAVED_ADDRESS = { id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true };
const SAVED_CARD = { id: 'pm_visa', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2029, isDefault: true };

function seed({ returning }) {
  const base = checkoutSession();
  return {
    ...base,
    acknowledgments: [],
    // A session saved before this change still says "Rate set by seller": the page must not.
    deliveryGroups: base.deliveryGroups.map((group, index) => ({
      ...group,
      availableMethods: group.availableMethods.map(method => ({
        ...method, service: 'Standard shipping', estimatedDays: index === 0 ? 2 : 0, estimatedDelivery: 'Rate set by seller',
      })),
    })),
    ...(returning
      ? { shippingAddress: { firstName: 'Jordan', lastName: 'Reyes', line1: SAVED_ADDRESS.street, line2: SAVED_ADDRESS.line2, city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: SAVED_ADDRESS.phone, id: 'addr_home' } }
      : { shippingAddress: undefined, contact: { email: BUYER_USER.email, orderUpdates: 'email', marketingConsent: false } }),
  };
}

/** Stand-in for https://js.stripe.com/<train>/stripe.js (not reachable here). */
const STRIPE_STUB = `
(() => {
  function emitter() { const h = {}; return { on(e, cb) { (h[e] ??= []).push(cb); return this; }, off(e, cb) { h[e] = (h[e] || []).filter(f => f !== cb); return this; }, emit(e, v) { (h[e] || []).forEach(cb => cb(v)); } }; }
  function field(ph) { const i = document.createElement('input'); i.placeholder = ph; i.setAttribute('data-stub', ph);
    i.style.cssText = 'box-sizing:border-box;width:100%;height:48px;background:#000;border:1px solid rgba(255,255,255,0.14);border-radius:12px;color:#fff;font:16px Inter,system-ui;padding:0 14px;outline:none'; return i; }
  function paymentElement() {
    const ev = emitter(); let root;
    const el = Object.assign(ev, {
      mount(node) { const target = typeof node === 'string' ? document.querySelector(node) : node; root = document.createElement('div');
        root.style.cssText = 'display:flex;flex-direction:column;gap:10px';
        const label = document.createElement('div'); label.textContent = 'Card number'; label.style.cssText = 'color:#8a8a8a;font:500 13px Inter,system-ui';
        const number = field('1234 1234 1234 1234'); const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:10px';
        const exp = field('MM / YY'); const cvc = field('CVC'); row.append(exp, cvc);
        const zipLabel = document.createElement('div'); zipLabel.textContent = 'ZIP'; zipLabel.style.cssText = label.style.cssText; const zip = field('ZIP');
        root.append(label, number, row, zipLabel, zip); target.appendChild(root);
        const check = () => ev.emit('change', { elementType: 'payment', complete: [number, exp, cvc, zip].every(i => i.value.length > 1), empty: false, value: { type: 'card' } });
        [number, exp, cvc, zip].forEach(i => i.addEventListener('input', check));
        setTimeout(() => ev.emit('ready', { elementType: 'payment' }), 30); },
      update() {}, destroy() { root?.remove(); }, unmount() { root?.remove(); }, focus() {}, blur() {}, clear() {}, collapse() {},
    });
    return el;
  }
  function expressElement() {
    const ev = emitter(); let root;
    return Object.assign(ev, {
      mount(node) { const target = typeof node === 'string' ? document.querySelector(node) : node; root = document.createElement('button');
        root.innerHTML = 'Buy with <b style="font-weight:600"> Pay</b>'; root.setAttribute('data-stub', 'apple-pay');
        root.style.cssText = 'width:100%;height:50px;border-radius:999px;border:0;background:#fff;color:#000;font:500 17px -apple-system,system-ui;cursor:pointer';
        target.appendChild(root);
        setTimeout(() => ev.emit('ready', { elementType: 'expressCheckout', availablePaymentMethods: { applePay: true, googlePay: false } }), 30); },
      update() {}, destroy() { root?.remove(); }, unmount() { root?.remove(); }, focus() {}, blur() {},
    });
  }
  window.Stripe = function Stripe() {
    return {
      _registerWrapper() {}, registerAppInfo() {},
      // react-stripe-js checks these exist before accepting the object.
      createToken: async () => ({}), createPaymentMethod: async () => ({}), confirmCardPayment: async () => ({}),
      elements() { return { create(type) { return type === 'expressCheckout' ? expressElement() : paymentElement(); }, getElement() { return null; }, update() {}, submit: async () => ({}), fetchUpdates: async () => ({}) }; },
      confirmPayment: async (opts) => { window.__btConfirms = (window.__btConfirms || 0) + 1; window.__btLastConfirm = JSON.stringify(opts?.confirmParams ?? {}); return { paymentIntent: { id: 'pi_demo', status: 'succeeded' } }; },
    };
  };
  window.Stripe.version = 3;
})();
`;

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

function quoteFor(groups) {
  const quoted = groups.map((group, index) => {
    const session = checkoutSession();
    const items = session.deliveryGroups.flatMap(g => g.items);
    const subtotal = group.items.reduce((sum, item) => sum + (items.find(i => i.variantId === item.variantId)?.priceCents ?? 0) * item.quantity, 0);
    const shipping = 1200;
    const tax = Math.round((subtotal + shipping) * 0.0);
    const sellerId = session.deliveryGroups[index]?.sellerId ?? `seller_${index}`;
    return { sellerId, checkoutSessionId: `cs_${index}`, subtotalCents: subtotal, shippingCents: shipping, discountCents: 0, taxCents: tax, totalCents: subtotal + shipping + tax, processingDays: index === 0 ? 2 : null };
  });
  return { amountCents: quoted.reduce((sum, g) => sum + g.totalCents, 0), groups: quoted };
}

async function open(browser, images, { returning, hostedFlag = false }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  await context.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('bt:opc-seeded')) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem('bt:opc-seeded', '1');
  }, [CHECKOUT_KEY, JSON.stringify(seed({ returning }))]);
  const calls = { create: [], quote: 0, hosted: 0 };
  await context.route('https://js.stripe.com/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: STRIPE_STUB }));
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/config/features') {
      return json(route, { flags: { threadCash: true, threadCashCheckoutDiscount: false, hostedCheckoutFallback: hostedFlag }, updatedAt: null });
    }
    if (p === '/api/buyer/addresses' && request.method() === 'GET') return json(route, returning ? [SAVED_ADDRESS] : []);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: returning ? [SAVED_CARD] : [] });
    if (p === '/api/buyer/checkout/payment-intent/quote') {
      calls.quote++;
      return json(route, quoteFor(JSON.parse(request.postData() || '{}').groups ?? []));
    }
    if (p === '/api/buyer/checkout/payment-intent' && request.method() === 'POST') {
      const body = request.postData() || '';
      calls.create.push(body);
      const quote = quoteFor(JSON.parse(body).groups ?? []);
      return json(route, { paymentIntentId: 'pi_demo', clientSecret: 'pi_demo_secret_demo', status: 'requires_payment_method', ...quote });
    }
    if (p === '/api/buyer/checkout/payment-intent/pi_demo') {
      const quote = quoteFor(checkoutSession().deliveryGroups.map(g => ({ items: g.items })));
      return json(route, {
        status: 'succeeded', paymentStatus: 'paid', amountTotal: quote.amountCents, declineReason: null, complete: true,
        orders: quote.groups.map((g, i) => ({ orderId: `order_demo_${i}`, orderNumber: `BT-1048${i + 2}`, sellerId: g.sellerId, amountTotalCents: g.totalCents })),
      });
    }
    if (p.startsWith('/api/buyer/checkout/session') || p === '/api/buyer/cart/validate') {
      calls.hosted++;
      return json(route, { error: 'hosted checkout is not part of this run' }, 500);
    }
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, ORIGIN, 'buyer', '/buyer-checkout');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByTestId('checkout-place-order').waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, '/buyer-checkout?bt_preview=buyer');
    }
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  return { context, page, calls };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${MODE}-${name}.png`), caret: 'hide' });
  console.log(`  ✓ ${MODE}-${name}`);
}

async function scrollTo(page, y) {
  await page.getByTestId('checkout-scroll').evaluate((el, top) => { el.scrollTop = top; }, y);
  await page.waitForTimeout(500);
}

async function scrollToTestId(page, testId, offset = 70) {
  await page.getByTestId('checkout-scroll').evaluate((el, [id, off]) => {
    const target = el.querySelector(`[data-testid="${id}"]`);
    if (!target) return;
    el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - off;
  }, [testId, offset]);
  await page.waitForTimeout(500);
}

async function pageThrough(page, prefix) {
  const height = await page.getByTestId('checkout-scroll').evaluate(el => el.scrollHeight);
  let index = 1;
  for (let y = 0; y < height; y += 600) {
    await scrollTo(page, y);
    await shot(page, `${prefix}-${String(index).padStart(2, '0')}`);
    index++;
    if (index > 6) break;
  }
}

async function headerMetrics(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="checkout-header"]');
    const scroll = document.querySelector('[data-testid="checkout-scroll"]');
    if (!header || !scroll) return null;
    const h = header.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    return { headerTop: h.top, headerBottom: h.bottom, headerBg: getComputedStyle(header).backgroundColor, scrollTop: s.top, closeTop: header.querySelector('[data-testid="checkout-close"]')?.getBoundingClientRect().top };
  });
}

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};

  if (MODE === 'before') {
    const { context, page } = await open(browser, images, { returning: true });
    await pageThrough(page, 'returning');
    await context.close();
    const fresh = await open(browser, images, { returning: false });
    await pageThrough(fresh.page, 'new-buyer');
    await fresh.context.close();
    await browser.close();
    return;
  }

  // 1. Returning buyer: saved address + saved card, in-app payment.
  {
    const { context, page, calls } = await open(browser, images, { returning: true });
    results.header = await headerMetrics(page);
    results.expressVisible = await page.getByTestId('checkout-express').isVisible();
    results.payLabel = (await page.getByTestId('checkout-place-order').innerText()).trim();
    results.payEnabled = await page.getByTestId('checkout-place-order').isEnabled();
    await shot(page, '01-top-express-contact');
    await scrollToTestId(page, 'checkout-shipping');
    await shot(page, '02-saved-address-and-card-rows');
    await scrollToTestId(page, 'checkout-order-summary');
    results.deliveryWindows = await page.getByTestId('checkout-delivery-window').allInnerTexts();
    results.summaryText = (await page.getByTestId('checkout-order-summary').innerText()).replace(/\s+/g, ' ');
    await shot(page, '03-order-summary-by-seller');
    await scrollTo(page, 100000);
    await shot(page, '04-totals-and-sticky-pay');
    // Header over scrolled content: still an opaque bar below the notch.
    results.headerScrolled = await headerMetrics(page);
    await page.getByTestId('checkout-place-order').click();
    await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    results.createBodies = calls.create.map(body => JSON.parse(body));
    results.cardDataInRequests = calls.create.some(body => /4242|cvc|cvv|exp_month|cardNumber/i.test(body));
    results.confirms = await page.evaluate(() => window.__btConfirms ?? 0);
    results.hostedCalls = calls.hosted;
    await shot(page, '05-order-confirmation');
    await context.close();
  }

  // 2. New buyer: inline address form + card field, pickers.
  {
    const { context, page, calls } = await open(browser, images, { returning: false });
    await scrollToTestId(page, 'checkout-shipping');
    await shot(page, '06-new-buyer-inline-address-form');
    await page.getByTestId('checkout-full-name').fill('Jordan Reyes');
    await page.getByLabel('Shipping address search').first().fill('1120 NW Everett Street');
    await page.getByTestId('checkout-city').fill('Portland');
    await page.getByTestId('checkout-zip').fill('97209');
    await page.getByTestId('checkout-phone').fill('+1 503 555 0142');
    await page.getByTestId('checkout-state').click();
    await page.waitForTimeout(900);
    await shot(page, '07-state-picker');
    await page.getByTestId('checkout-state-OR').click();
    await page.waitForTimeout(700);
    await scrollToTestId(page, 'checkout-payment');
    await shot(page, '08-card-field-inline');
    for (const [ph, value] of [['1234 1234 1234 1234', '4242 4242 4242 4242'], ['MM / YY', '08 / 29'], ['CVC', '123'], ['ZIP', '97209']]) {
      await page.locator(`[data-stub="${ph}"]`).fill(value);
    }
    await page.waitForTimeout(1500);
    results.newBuyer = {
      shippingText: (await page.getByTestId('checkout-shipping').innerText()).replace(/\s+/g, ' ').slice(0, 300),
      payEnabled: await page.getByTestId('checkout-place-order').isEnabled(),
      hint: await page.getByTestId('checkout-next-step').count() ? await page.getByTestId('checkout-next-step').innerText() : null,
      quotes: calls.quote,
    };
    await scrollToTestId(page, 'checkout-order-summary');
    await shot(page, '09-new-buyer-summary-with-quote');
    if (results.newBuyer.payEnabled) {
      await page.getByTestId('checkout-place-order').click();
      await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
      results.newBuyer.createBody = JSON.parse(calls.create[0]);
      results.newBuyer.cardDataInRequests = calls.create.some(body => /4242|cvc|cvv|exp_month|cardNumber|"123"/i.test(body));
      results.newBuyer.lastConfirmParams = await page.evaluate(() => window.__btLastConfirm ?? null);
    }
    await context.close();
  }

  // 3. Hosted fallback (kill switch on).
  {
    const { context, page } = await open(browser, images, { returning: true, hostedFlag: true });
    await scrollToTestId(page, 'checkout-payment');
    results.hosted = { payment: (await page.getByTestId('checkout-payment').innerText()).replace(/\s+/g, ' ') };
    await shot(page, '10-hosted-fallback-payment');
    await context.close();
  }

  writeFileSync(path.join(OUT, `${MODE}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

run().catch((error) => { console.error(error); process.exit(1); });
