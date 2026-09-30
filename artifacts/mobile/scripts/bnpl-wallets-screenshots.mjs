#!/usr/bin/env node
/**
 * Klarna / Afterpay at checkout + the seller toggle, at 393x852 on the
 * store-screenshots harness (fake API, Stripe.js stub).
 *
 *   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo node scripts/bnpl-wallets-screenshots.mjs <origin> <outDir>
 *
 * js.stripe.com is not reachable here, so Stripe.js is a stub that draws a
 * Card / Klarna / Afterpay tab strip where Stripe's Payment Element would be.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, '../../docs/pr-review/one-page-checkout'));
const MODE = 'after';
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
let sellerBnpl = false;
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
        const types = (JSON.parse(window.__btElementsOpts || '{}').paymentMethodTypes) || ['card'];
        if (types.length > 1) { const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:8px'; types.forEach((t, i) => { const tab = document.createElement('div'); tab.textContent = t === 'card' ? 'Card' : t === 'klarna' ? 'Klarna' : 'Afterpay'; tab.setAttribute('data-stub-tab', t); tab.style.cssText = 'flex:1;text-align:center;padding:12px 0;border-radius:12px;border:1px solid rgba(255,255,255,' + (i === 0 ? '0.6' : '0.14') + ');color:#fff;font:500 14px Inter,system-ui'; tabs.appendChild(tab); }); root.appendChild(tabs); }
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
      elements(opts) { window.__btElementsOpts = JSON.stringify(opts ?? {}); return { create(type) { return type === 'expressCheckout' ? expressElement() : paymentElement(); }, getElement() { return null; }, update() {}, submit: async () => ({}), fetchUpdates: async () => ({}) }; },
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

let bnplOn = true;
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
  return { amountCents: quoted.reduce((sum, g) => sum + g.totalCents, 0), groups: quoted, paymentMethodTypes: bnplOn ? ['card', 'klarna', 'afterpay_clearpay'] : ['card'] };
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
    if (p === '/api/seller/payment-settings') return json(route, { bnplEnabled: sellerBnpl, bnplAvailable: true });
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
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ✓ ${name}`);
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

  // 1. Buyer, every seller opted in: saved card row + Klarna / Afterpay row.
  {
    const { context, page, calls } = await open(browser, images, { returning: true });
    await scrollToTestId(page, 'checkout-payment');
    results.bnplRow = await page.getByTestId('checkout-bnpl').count();
    await shot(page, '01-checkout-payment-with-bnpl-row');
    await page.getByTestId('checkout-bnpl').click();
    await page.waitForTimeout(900);
    await scrollToTestId(page, 'checkout-payment');
    await shot(page, '02-klarna-afterpay-selected');
    results.elementsOpts = await page.evaluate(() => window.__btElementsOpts ?? null);
    results.payEnabled = await page.getByTestId('checkout-place-order').isEnabled();
    await context.close();
  }

  // 2. Buyer, a seller has not opted in: no row, card only.
  {
    bnplOn = false;
    const { context, page } = await open(browser, images, { returning: true });
    await scrollToTestId(page, 'checkout-payment');
    results.bnplRowWhenOff = await page.getByTestId('checkout-bnpl').count();
    await shot(page, '03-checkout-payment-card-only');
    await context.close();
    bnplOn = true;
  }

  // 3. Seller payments screen: the toggle row.
  {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images });
    await context.route(`${API}/**`, async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^\/api\/v1\//, '/api/');
      if (p === '/api/seller/payment-settings') {
        if (route.request().method() === 'PATCH') sellerBnpl = JSON.parse(route.request().postData() || '{}').bnplEnabled === true;
        return json(route, { bnplEnabled: sellerBnpl, bnplAvailable: true });
      }
      return route.fallback();
    });
    page.setDefaultNavigationTimeout(240_000);
    await openScreen(page, activity, ORIGIN, 'seller', '/payments');
    await page.getByTestId('seller-bnpl-toggle').waitFor({ timeout: 60_000 });
    await waitForQuietNetwork(activity, 900, 20_000);
    await page.waitForTimeout(800);
    await shot(page, '04-seller-payments-toggle-off');
    await page.getByTestId('seller-bnpl-toggle').getByRole('switch').click();
    await page.waitForTimeout(800);
    results.sellerBnplAfterToggle = sellerBnpl;
    await shot(page, '05-seller-payments-toggle-on');
    await context.close();
  }

  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

run().catch((error) => { console.error(error); process.exit(1); });
