#!/usr/bin/env node
/**
 * Item 109: Thread Cash at checkout, live at 390×844.
 *
 * Drives the real app (store-screenshots harness: signed-in demo buyer and
 * seller, seeded storage) against a fake Thread Cash wallet that follows the
 * server's rules:
 *  - redeem takes the amount out of the balance;
 *  - cancel gives it back;
 *  - checkout refuses a token bigger than (subtotal + shipping − promo) − 50¢.
 * The checkout flag 'threadCashCheckoutDiscount' is turned on for the run.
 * It ships OFF.
 *
 * Scenarios:
 *  A. $40 balance, Heavyweight Hoodie ($98 + $12 shipping):
 *     off → on (card $70) → TENOFF promo stacks (card $60) → Place order →
 *     the request carries the token and the code → success screen with the
 *     split → the buyer's receipt.
 *  B. $150 balance: on applies $109.50 (card keeps the 50¢ minimum), TENOFF
 *     shrinks it live to $99.50 with a note, off returns all $150.
 *  C. no balance: the designed empty state (How it works).
 *  D. the seller's order screen: the payout breakdown with Thread Cash
 *     paid by Brandthread.
 *
 * What is NOT real here: the API is the harness's fake API plus the fake
 * wallet below, and Stripe's page is about:blank with verify answered as
 * paid. The real money path (routes, Postgres, Stripe coupon, webhook,
 * seller top-up, ledger) is covered by api-server's
 * threadCashCheckoutRoutes.integration.test.ts.
 *
 *   node scripts/thread-cash-checkout-screenshots.mjs <origin> [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession, respond } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/thread-cash-checkout-109'));
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;
const MIN_CARD = 50;
const ORDER = { id: 'ord_tc109', number: 'BT-10431' };
const SAVED_ADDRESSES = [
  { id: 'addr_home', label: 'Home', recipientName: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', postalCode: '97209', country: 'US', phone: '+1 (503) 555-0142', isDefault: true },
];

function hoodieSession() {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = [{ id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true }];
  const subtotalCents = group.items[0].priceCents;
  return {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    idempotencyKey: 'ck_tc109_start',
    shippingAddress: { ...base.shippingAddress, id: 'addr_home' },
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, discountTotalCents: 0, totalCents: subtotalCents + 1200 },
  };
}

let ORIGIN_HEADER = '';
function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN_HEADER, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

/** A Thread Cash wallet with the server's rules (lib/threadCash/wallet.ts, routes/buyer.ts). */
function fakeWallet(balanceCents) {
  return { balance: balanceCents, tokens: new Map(), seq: 0, log: [] };
}

async function open(browser, images, { role = 'buyer', wallet, session, target, extra }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  ORIGIN_HEADER = ORIGIN;
  if (session) {
    // After the harness seed (registered first), so this scenario's
    // single-seller checkout replaces the demo's multi-seller one.
    await context.addInitScript(([key, value]) => {
      if (sessionStorage.getItem('bt:tc109-seeded')) return;
      localStorage.setItem(key, value);
      sessionStorage.setItem('bt:tc109-seeded', '1');
    }, [CHECKOUT_KEY, JSON.stringify(session)]);
  }
  const captured = { checkoutBodies: [] };
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/config/features') {
      return json(route, { flags: { aiPhotoShoot: true, outfitSwap: true, boosts: true, manufacturerHub: true, threadCash: true, threadCashCheckoutDiscount: true }, updatedAt: null });
    }
    if (extra) {
      // An extra handler returns null for "not mine"; anything else means it answered.
      if ((await extra(route, p, request)) !== null) return;
    }
    if (wallet) {
      if (p === '/api/thread-cash' && request.method() === 'GET') {
        const openRedemptions = [...wallet.tokens.entries()].filter(([, t]) => t.open && !t.reserved).map(([token, t]) => ({ token, amountCents: t.amount, createdAt: new Date().toISOString() }));
        return json(route, { balanceCents: wallet.balance, openRedemptions, config: { maxRedemptionPerOrderCents: null }, streak: {} });
      }
      if (p === '/api/thread-cash/redeem') {
        const { amountCents } = JSON.parse(request.postData() ?? '{}');
        if (!Number.isInteger(amountCents) || amountCents < 1) return json(route, { error: 'Enter a valid Thread Cash amount.' }, 400);
        if (amountCents > wallet.balance) return json(route, { error: `Insufficient Thread Cash. You have $${(wallet.balance / 100).toFixed(2)}.`, code: 'INSUFFICIENT_THREAD_CASH' }, 400);
        wallet.balance -= amountCents;
        const token = `TCASH-JORDAN-${++wallet.seq}`;
        wallet.tokens.set(token, { amount: amountCents, open: true });
        wallet.log.push(`redeem ${amountCents} -> ${token}`);
        return json(route, { ok: true, discountCents: amountCents, token });
      }
      const cancel = p.match(/^\/api\/thread-cash\/redeem\/([^/]+)\/cancel$/);
      if (cancel) {
        const token = decodeURIComponent(cancel[1]);
        const held = wallet.tokens.get(token);
        if (!held) return json(route, { error: 'This Thread Cash token is not valid for your account.' }, 404);
        let returned = 0;
        if (held.open) { held.open = false; wallet.balance += held.amount; returned = held.amount; }
        wallet.log.push(`cancel ${token} (+${returned})`);
        return json(route, { ok: true, returnedCents: held.amount, balanceCents: wallet.balance });
      }
    }
    if (p === '/api/buyer/addresses' && request.method() === 'GET') return json(route, SAVED_ADDRESSES);
    if (p === '/api/buyer/payment-methods') return json(route, { paymentMethods: [{ id: 'pm_1', brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028, isDefault: true }] });
    if (p === '/api/discount-codes/validate') {
      const code = url.searchParams.get('code');
      if (code === 'TENOFF') return json(route, { code: 'TENOFF', type: 'fixed', value: 1000, appliedAmountCents: 1000, description: '$10.00 off your order' });
      return json(route, { error: 'EXPIRED' }, 400);
    }
    if (p === '/api/buyer/cart/validate') return json(route, { isValid: true, issues: [] });
    if (p === '/api/buyer/checkout/session' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      captured.checkoutBodies.push(body);
      // The server's reservation rule (routes/buyer.ts): after the promo,
      // leave at least 50¢ on the card.
      const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), CHECKOUT_KEY);
      const promo = body.discountCode === 'TENOFF' ? 1000 : 0;
      const ceiling = stored.summary.subtotalCents + stored.summary.shippingTotalCents - promo - MIN_CARD;
      if (body.threadCashToken) {
        const held = wallet?.tokens.get(body.threadCashToken);
        if (!held || !held.open) return json(route, { error: 'This Thread Cash token is not valid for your account.' }, 400);
        if (held.amount > ceiling) return json(route, { error: 'Choose less Thread Cash so your order still has a balance to pay.', code: 'THREAD_CASH_DISCOUNT_TOO_LARGE' }, 400);
        held.reserved = true;
      }
      const tc = body.threadCashToken ? wallet.tokens.get(body.threadCashToken).amount : 0;
      captured.card = stored.summary.subtotalCents + stored.summary.shippingTotalCents - promo - tc;
      return json(route, { sessionId: 'cs_tc109', url: 'about:blank' });
    }
    if (p.startsWith('/api/buyer/checkout/session/')) {
      if (wallet) for (const t of wallet.tokens.values()) if (t.reserved) t.open = false; // consumed by the order
      return json(route, { status: 'complete', paymentStatus: 'paid', amountTotal: captured.card ?? 0, orderId: ORDER.id, orderNumber: ORDER.number, declineReason: null });
    }
    return route.fallback();
  });
  context.on('page', (popup) => { void popup.close().catch(() => {}); });
  // A dev server bundles on the first request.
  page.setDefaultNavigationTimeout(240_000);

  const route = target ?? '/buyer-checkout?source=buynow';
  await openScreen(page, activity, ORIGIN, role, route, {
    beforeNavigate: session
      ? () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session)])
      : undefined,
  });
  // On a dev server the signed-in remount can land after the first
  // navigation; navigate again until the screen is the one asked for.
  const wanted = route.split('?')[0];
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.waitForTimeout(2500);
    if (new URL(page.url()).pathname === wanted && !(await page.getByText('Tap to keep watching').count())) break;
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${route}${route.includes('?') ? '&' : '?'}bt_preview=${role}`);
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(900);
  return { context, page, activity, captured };
}

/** Waits for a test id; on a slow dev-server remount, navigates to the route again. */
async function waitForScreen(page, testId, route) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.getByTestId(testId).first().waitFor({ timeout: 15_000 });
      return;
    } catch (error) {
      if (attempt >= 3) {
        await page.screenshot({ path: path.join(OUT, `debug-${testId}.png`) });
        throw error;
      }
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, route);
    }
  }
}

async function shot(page, name, { full = false } = {}) {
  await page.waitForTimeout(400);
  if (full) {
    const extra = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="checkout-scroll"]') ?? [...document.querySelectorAll('div')]
        .filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible')
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!el) return 0;
      el.scrollTop = 0;
      return el.scrollHeight - el.clientHeight;
    });
    await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
    await page.setViewportSize(VIEWPORT);
    await page.waitForTimeout(400);
  } else {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  }
  console.log(`  ✓ ${name}`);
}

async function scrollTo(page, testId, block = 'center') {
  await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
  await page.waitForTimeout(300);
}

const text = (page, testId) => page.getByTestId(testId).first().innerText().catch(() => null);

async function toggle(page) {
  await page.getByRole('switch', { name: 'Use Thread Cash' }).click();
  await page.getByTestId('checkout-thread-cash-busy').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function applyPromo(page, code) {
  await scrollTo(page, 'checkout-promo');
  await page.getByTestId('checkout-promo-input').fill(code);
  await page.getByTestId('checkout-promo-apply').click();
  await page.getByTestId('checkout-promo-applied').waitFor({ timeout: 10_000 });
  // The Thread Cash row follows the new total (300ms debounce + cancel/redeem).
  await page.waitForTimeout(1500);
  await page.getByTestId('checkout-thread-cash-busy').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};

  // ── A. $40 balance: on, stack a promo, place the order ──────────────────
  {
    const wallet = fakeWallet(4000);
    const { context, page, captured } = await open(browser, images, { wallet, session: hoodieSession() });
    await waitForScreen(page, 'checkout-thread-cash', '/buyer-checkout?source=buynow&bt_preview=buyer');
    await page.getByText('$40.00 available').waitFor({ timeout: 15_000 });
    await scrollTo(page, 'checkout-thread-cash');
    results.aOff = await text(page, 'checkout-thread-cash-status');
    await shot(page, '01-thread-cash-off-40-available');

    await toggle(page);
    results.aOn = await text(page, 'checkout-thread-cash-status');
    results.aOnCta = await text(page, 'checkout-place-order');
    await scrollTo(page, 'checkout-price-breakdown', 'end');
    await shot(page, '02-on-breakdown-order-total-thread-cash-card');
    await shot(page, '02b-on-full-checkout', { full: true });

    await applyPromo(page, 'TENOFF');
    results.aPromoStatus = await text(page, 'checkout-thread-cash-status');
    results.aPromoCta = await text(page, 'checkout-place-order');
    await scrollTo(page, 'checkout-price-breakdown', 'end');
    await shot(page, '03-promo-stacks-discount-then-thread-cash');
    await shot(page, '03b-promo-full-checkout', { full: true });

    await page.getByTestId('checkout-place-order').click();
    await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const body = captured.checkoutBodies.at(-1) ?? {};
    results.aRequest = { threadCashToken: body.threadCashToken, discountCode: body.discountCode, idem: body.clientIdempotencyKey };
    results.aConfirmationThreadCash = await text(page, 'checkout-confirmation-thread-cash');
    await shot(page, '04-order-success-thread-cash-and-card');
    results.aWallet = { balance: wallet.balance, log: wallet.log };
    await context.close();
  }

  // ── B. $150 balance: the 50¢ card minimum, then a promo resizes it live ──
  {
    const wallet = fakeWallet(15000);
    const { context, page } = await open(browser, images, { wallet, session: hoodieSession() });
    await waitForScreen(page, 'checkout-thread-cash', '/buyer-checkout?source=buynow&bt_preview=buyer');
    await page.getByText('Use $109.50 of your $150.00').waitFor({ timeout: 15_000 });
    await scrollTo(page, 'checkout-thread-cash');
    results.bOff = await text(page, 'checkout-thread-cash-status');
    await shot(page, '05-capped-use-109.50-of-150');

    await toggle(page);
    results.bOnCta = await text(page, 'checkout-place-order');
    await scrollTo(page, 'checkout-price-breakdown', 'end');
    await shot(page, '06-on-card-keeps-50-cent-minimum');

    await applyPromo(page, 'TENOFF');
    await scrollTo(page, 'checkout-thread-cash');
    results.bNotice = await text(page, 'checkout-thread-cash-notice');
    results.bResized = await text(page, 'checkout-thread-cash-status');
    results.bResizedCta = await text(page, 'checkout-place-order');
    await shot(page, '07-promo-resizes-live-to-99.50-with-note');
    await shot(page, '07b-resized-full-checkout', { full: true });

    await toggle(page);
    results.bOff2 = await text(page, 'checkout-thread-cash-status');
    results.bOffCta = await text(page, 'checkout-place-order');
    await shot(page, '08-off-returns-full-balance');
    results.bWallet = { balance: wallet.balance, log: wallet.log };
    await context.close();
  }

  // ── C. No balance ───────────────────────────────────────────────────────
  {
    const wallet = fakeWallet(0);
    const { context, page } = await open(browser, images, { wallet, session: hoodieSession() });
    await waitForScreen(page, 'checkout-thread-cash-learn', '/buyer-checkout?source=buynow&bt_preview=buyer');
    await scrollTo(page, 'checkout-thread-cash');
    results.cStatus = await text(page, 'checkout-thread-cash-status');
    results.cSwitchDisabled = await page.getByRole('switch', { name: 'Use Thread Cash' }).isDisabled();
    await shot(page, '09-no-balance-how-it-works');
    await context.close();
  }

  // ── D. The buyer's receipt and the seller's payout ──────────────────────
  const orderFields = {
    // Scenario A: $98 + $12, TENOFF −$10, Thread Cash −$40, card $60.
    totalCents: 6000, subtotalCents: 9800, shippingCents: 1200, taxCents: 0,
    discountAmountCents: 5000, threadCashAppliedCents: 4000,
    platformFeeCents: 440, processingFeeChargedCents: 320,
  };
  {
    const { context, page } = await open(browser, images, {
      target: `/buyer-order-detail?id=${ORDER.id}`,
      extra: async (route, p) => {
        if (p === `/api/buyer/orders/${ORDER.id}`) {
          return json(route, {
            id: ORDER.id, orderNumber: ORDER.number, ownerId: 'user_northline', sellerDisplayName: 'Northline Studio',
            status: 'pending', paidAt: new Date(Date.now() - 3600e3).toISOString(), stripePaymentIntentId: 'pi_tc109',
            ...orderFields,
            shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', line2: 'Apt 5C', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
            items: [{ productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', variantLabel: 'M', quantity: 1, priceCents: 9800 }],
            createdAt: new Date(Date.now() - 3600e3).toISOString(),
          });
        }
        return null;
      },
    });
    await page.getByText('Payment Summary').first().waitFor({ timeout: 20_000 });
    await page.getByText('Payment Summary').first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    await shot(page, '10-buyer-receipt-thread-cash-and-card');
    await context.close();
  }
  {
    const { context, page } = await open(browser, images, {
      role: 'seller',
      target: '/order-detail?id=ord_1048',
      extra: async (route, p) => {
        if (p === '/api/orders/ord_1048') {
          // The harness's own detail row, with this order's money fields.
          const base = respond({ method: 'GET', path: '/orders/ord_1048', query: new URLSearchParams(), role: 'seller' }) ?? {};
          return json(route, {
            ...base, ...orderFields,
            items: [{ id: 'ord_1048-item-1', productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', variantLabel: 'M', quantity: 1, priceCents: 9800 }],
          });
        }
        return null;
      },
    });
    await page.getByText('Payment', { exact: true }).first().waitFor({ timeout: 20_000 });
    await page.getByText('Payment', { exact: true }).first().click();
    await page.getByTestId('order-thread-cash-payout').waitFor({ timeout: 15_000 });
    results.dPayout = await text(page, 'order-thread-cash-payout');
    // Clipped above the tab bar: on a dev server a pre-existing LogBox
    // warning toast sits over the bottom of this screen.
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '11-seller-payout-thread-cash-paid-by-brandthread.png'), clip: { x: 0, y: 0, width: VIEWPORT.width, height: 760 } });
    console.log('  ✓ 11-seller-payout-thread-cash-paid-by-brandthread');
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
