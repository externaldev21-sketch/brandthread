#!/usr/bin/env node
/**
 * Seller Checkout settings restored for real (post-purchase offer,
 * conversion tracking, Guest checkout only, checkout language) and the
 * buyer side (post-purchase offer on the order confirmation, checkout in the
 * store's language). Drives the web preview build at 390x844:
 *
 *  Seller (?bt_preview=seller — signed-out preview): Store settings →
 *  Checkout row → every control. Asserts the preview never calls the
 *  protected checkout APIs.
 *  Buyer (signed-in demo buyer, fake API): order confirmation with the
 *  seller's offer → Add to order (asserts only variantId + key are sent) →
 *  added; then the same in Spanish, and a Spanish single-seller checkout.
 *
 * Run:  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/store-screenshots/checkout-extras-verify.mjs [--skip-build]
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { CART, IMAGE_HOST, checkoutSession } from './demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const BUILD_DIR = path.join(WORK_DIR, 'checkout-extras-build');
const OUT = path.resolve(MOBILE_ROOT, '../../screenshots/qa-fake-features');
mkdirSync(OUT, { recursive: true });
const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const DEMO_API = 'https://api.brandthread.test';
const ORDER_ID = '4f1c2a8e-6b0d-4c3e-9a51-7d2e8f90b1c4';
const NEW_ORDER_ID = '9a7b3c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d';
const VARIANT_M = 'b3c4d5e6-f7a8-4b9c-8d0e-1f2a3b4c5d6e';
const VARIANT_L = 'c4d5e6f7-a8b9-4c0d-9e1f-2a3b4c5d6e7f';

const failures = [];
function check(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures.push(label);
}

const tid = (id) => `[data-testid="${id}"]`;

async function shot(page, name) {
  await page.waitForTimeout(400);
  await waitForImages(page);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`      → ${name}`);
}

/** openScreen, retried: the app can still remount onto "/" right after Clerk loads. */
async function openAndWait(page, activity, origin, role, target, selector, options = {}) {
  await openScreen(page, activity, origin, role, target, options);
  for (let attempt = 0; attempt < 4; attempt++) {
    const found = await page.waitForSelector(selector, { timeout: 12_000 }).then(() => true).catch(() => false);
    if (found) return;
    await options.beforeNavigate?.();
    await page.evaluate(() => {
      history.pushState(history.state, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    });
    await page.waitForTimeout(800);
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
  }
  await page.screenshot({ path: path.join(WORK_DIR, `debug-${target.replace(/\W+/g, '_')}.png`) });
  console.log('[debug] stored', await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('bt:checkout')).map(([k, v]) => `${k}=${v.slice(0, 90)}`)));
  throw new Error(`${target} never showed ${selector} (at ${page.url()})`);
}

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

// ─── Seller ──────────────────────────────────────────────────────────────────

async function seller(browser, origin, images) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
  const apiCalls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin === DEMO_API && request.method() !== 'OPTIONS') apiCalls.push(`${request.method()} ${url.pathname}`);
  });
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));

  await openAndWait(page, activity, origin, 'seller', '/store-settings', tid('store-settings-checkout'));
  await page.locator(tid('store-settings-checkout')).scrollIntoViewIfNeeded();
  await shot(page, 'checkout-settings-entry.png');
  const before = apiCalls.length;
  await page.locator(tid('store-settings-checkout')).click();
  await page.waitForSelector(tid('checkout-post-purchase'), { timeout: 20_000 });
  await waitForQuietNetwork(activity);
  await shot(page, 'checkout-settings-overview.png');

  // Checkout mode: three real options.
  await page.locator(tid('checkout-mode')).click();
  await page.getByText('Guest checkout only', { exact: true }).last().waitFor();
  await shot(page, 'checkout-settings-mode.png');
  await page.getByText('Guest checkout only', { exact: true }).last().click();
  await page.waitForTimeout(500);
  check(await page.getByText('Buyers check out without signing in', { exact: false }).count() > 0, 'Guest checkout only selected with its description');
  await page.locator(tid('checkout-mode')).click();
  await page.getByText('Accounts optional', { exact: true }).last().click();
  await page.waitForTimeout(400);

  // Post-purchase offer: turning it on starts with choosing the product.
  await page.locator(tid('checkout-post-purchase-toggle')).click();
  await page.getByText('Heavyweight Hoodie — Bone', { exact: true }).last().waitFor({ timeout: 10_000 });
  check(await page.getByText('Field Shell Jacket — Onyx', { exact: true }).count() === 0, 'draft products are not offered');
  check(await page.getByText('Utility Cargo Pant — Rust', { exact: true }).count() === 0, 'out-of-stock products are not offered');
  await shot(page, 'checkout-settings-offer-product.png');
  await page.getByText('Heavyweight Hoodie — Bone', { exact: true }).last().click();
  await page.waitForTimeout(500);
  await page.locator(tid('checkout-post-purchase-discount')).click();
  await page.getByText('20% off', { exact: true }).last().waitFor();
  await shot(page, 'checkout-settings-offer-discount.png');
  await page.getByText('20% off', { exact: true }).last().click();
  await page.waitForTimeout(500);
  await page.locator(tid('checkout-post-purchase')).scrollIntoViewIfNeeded();
  check(await page.getByText('Buyers pay $78.40', { exact: true }).count() > 0, 'offer shows the discounted price ($98.00 − 20%)');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(tid('checkout-post-purchase')).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'checkout-settings-post-purchase.png');

  // Conversion tracking: invalid ID refused, valid one connects (masked).
  await page.locator(tid('tracking-ga4')).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.locator(tid('tracking-ga4')).getByRole('button').first().click();
  await page.locator(tid('tracking-ga4-id')).fill('UA-12345-1');
  await page.locator(tid('tracking-ga4-save')).click();
  await page.getByText('A Measurement ID looks like G-XXXXXXX').waitFor();
  check(true, 'GA4 rejects a Universal Analytics ID');
  await shot(page, 'checkout-settings-tracking-error.png');
  await page.locator(tid('tracking-ga4')).getByRole('button').first().click();
  await page.locator(tid('tracking-meta')).getByRole('button').first().click();
  await page.locator(tid('tracking-meta-id')).fill('123456789012345');
  await page.locator(tid('tracking-meta-secret')).fill(`EAAG${'x7Q2'.repeat(12)}`);
  await page.locator(tid('tracking-meta-save')).click();
  await page.getByText('Connected · 123456789012345').waitFor();
  check(true, 'Meta Pixel connected');
  await page.locator(tid('tracking-meta')).getByRole('button').first().click();
  await page.waitForTimeout(300);
  check(await page.locator(tid('tracking-meta-secret')).getAttribute('placeholder') === '••••x7Q2 (saved)', 'saved secret is only shown masked');
  await page.locator(tid('checkout-conversion-tracking')).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'checkout-settings-tracking.png');

  const protectedCalls = apiCalls.slice(before).filter((call) => /\/seller\/(settings|post-purchase-offer|conversion-tracking)|\/api(\/v1)?\/products\b/.test(call));
  check(protectedCalls.length === 0, `signed-out seller preview made no protected checkout API calls (${protectedCalls.join(', ') || 'none'})`);
  await context.close();
}

// ─── Buyer ───────────────────────────────────────────────────────────────────

function singleSellerSession(step) {
  const base = checkoutSession();
  const items = CART.items.filter((item) => item.sellerId === CART.items[0].sellerId);
  const group = { ...base.deliveryGroups.find((g) => g.sellerId === items[0].sellerId), items };
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  return {
    ...base,
    step,
    deliveryGroups: [group],
    acknowledgments: [],
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, totalCents: subtotalCents + 1200 },
    ...(step === 'confirmation'
      ? { paidGroups: { [group.sellerId]: { stripeSessionId: 'cs_demo_paid', orderId: ORDER_ID, orderNumber: 'BT-00418', amountTotalCents: subtotalCents + 1200 + 2846 } } }
      : {}),
  };
}

async function buyer(browser, origin, images, { language, step, name }) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  const session = singleSellerSession(step);
  const sellerId = session.deliveryGroups[0].sellerId;
  // Written on every document load (after the harness's own demo seed), so a
  // reload during start-up can't bring the multi-seller demo checkout back.
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), ['bt:checkout:user_jordan:v1', JSON.stringify(session)]);
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  if (process.env.DEBUG_SHOTS) page.on('request', (r) => { if (r.url().startsWith(DEMO_API)) console.log('[api]', r.method(), new URL(r.url()).pathname); });

  const accepted = [];
  await context.route((url) => url.origin === DEMO_API && /\/(checkout-profile|buyer\/post-purchase|buyer\/checkout\/payment-intent)/.test(url.pathname), async (route) => {
    const request = route.request();
    const headers = cors(origin);
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(request.url()).pathname.replace(/^\/api(\/v1)?/, '');
    const json = (body) => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/checkout-profile') return json({ profiles: { [sellerId]: { language, checkoutMode: 'accounts_optional' } } });
    if (p === `/buyer/post-purchase/${ORDER_ID}`) {
      return json({
        available: true, orderId: ORDER_ID, sellerId, sellerName: session.deliveryGroups[0].sellerName,
        product: { id: 'prod_nl_hoodie_bone', name: 'Heavyweight Hoodie — Bone', image: `${IMAGE_HOST}/demo/hoodie-bone.jpg` },
        discountPercent: 20,
        variants: [
          { variantId: VARIANT_M, label: 'M', priceCents: 9800, offerPriceCents: 7840, inStock: true },
          { variantId: VARIANT_L, label: 'L', priceCents: 9800, offerPriceCents: 7840, inStock: true },
        ],
        card: { brand: 'visa', last4: '4242' },
        expiresAt: new Date(Date.now() + 3_000_000).toISOString(),
      });
    }
    if (p === `/buyer/post-purchase/${ORDER_ID}/accept`) {
      accepted.push(request.postDataJSON());
      return json({ paymentIntentId: 'pi_offer_demo', status: 'succeeded', clientSecret: null, paymentMethodId: 'pm_demo', amountCents: 8467, subtotalCents: 9800, discountCents: 1960, taxCents: 627 });
    }
    if (p === '/buyer/checkout/payment-intent/pi_offer_demo') {
      return json({ status: 'succeeded', paymentStatus: 'paid', amountTotal: 8467, declineReason: null, complete: true, orders: [{ orderId: NEW_ORDER_ID, orderNumber: 'BT-00419', sellerId, amountTotalCents: 8467 }] });
    }
    return route.fulfill({ status: 404, headers, contentType: 'application/json', body: '{}' });
  });

  // Seeded once the app has settled on "/" (its cart sync rewrites the
  // demo checkout before then), right before opening the checkout.
  await openAndWait(page, activity, origin, 'buyer', '/buyer-checkout', step === 'confirmation' ? tid('post-purchase-offer') : 'text=Resumen del pedido', {
    beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), ['bt:checkout:user_jordan:v1', JSON.stringify(session)]),
  });
  if (step === 'confirmation') {
    await waitForQuietNetwork(activity);
    await shot(page, `${name}.png`);
    if (language === 'en') {
      await page.locator(tid(`post-purchase-variant-${VARIANT_L}`)).click();
      await page.locator(tid('post-purchase-add')).click();
      await page.waitForSelector(tid('post-purchase-added'), { timeout: 20_000 });
      check(accepted.length === 1, 'Add to order called the accept API once');
      check(JSON.stringify(Object.keys(accepted[0] ?? {}).sort()) === JSON.stringify(['clientIdempotencyKey', 'variantId']) && accepted[0].variantId === VARIANT_L,
        'accept sends only the chosen variant and an idempotency key (no client price)');
      check(await page.getByText('Order BT-00419').count() > 0, 'the follow-up order number is shown');
      await shot(page, 'post-purchase-added.png');
    } else {
      check(await page.getByText('Añádelo a tu pedido').count() > 0, 'offer renders in the store language (es)');
      check(await page.getByText('Pedido confirmado').count() > 0, 'confirmation renders in the store language (es)');
    }
  } else {
    await waitForQuietNetwork(activity);
    await page.waitForTimeout(600);
    check(await page.getByText('Resumen del pedido').count() > 0, 'checkout renders in the store language (es)');
    await shot(page, `${name}.png`);
  }
  await context.close();
}

async function run() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
    await seller(browser, server.origin, images);
    await buyer(browser, server.origin, images, { language: 'en', step: 'confirmation', name: 'post-purchase-offer' });
    await buyer(browser, server.origin, images, { language: 'es', step: 'confirmation', name: 'post-purchase-offer-es' });
    await buyer(browser, server.origin, images, { language: 'es', step: 'review', name: 'checkout-settings-language-buyer-es' });
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll checks passed');
}

run().catch((error) => { console.error(error); process.exit(1); });
