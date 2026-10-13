#!/usr/bin/env node
/**
 * Polish 122–129 — before/after screenshots at 393×852 for the PR.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo
 * buyer or seller, fake API). The shared demo data has no buyer orders or
 * returns, so this script answers those routes itself with the exact shapes
 * artifacts/api-server returns (GET /api/buyer/orders[/:id],
 * /api/returns/buyer, /api/returns/:id, /api/seller/cancel-window).
 *
 *   node scripts/post-purchase-polish-screenshots.mjs --build-dir=<dir> --tag=before|after [--build]
 *
 * Output: docs/pr-assets/post-purchase-polish/<tag>-<shot>.png (repo root)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const TAG = arg('tag', 'after');
const BUILD_DIR = arg('build-dir', path.join(WORK_DIR, `web-build-${TAG}`));
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/post-purchase-polish');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

const ADDRESS = { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' };

// Placed 20 minutes ago from a seller with a 1-hour cancel window.
const PROCESSING = {
  id: '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7', orderNumber: 'BT-10042', ownerId: 'user_northline', sellerDisplayName: 'Northline Studio',
  status: 'processing', subtotalCents: 12800, shippingCents: 0, taxCents: 0, totalCents: 12800, createdAt: iso(20 * MIN), paidAt: iso(20 * MIN),
  shippingAddress: ADDRESS, stripePaymentIntentId: 'pi_demo_1', discountAmountCents: 0, threadCashAppliedCents: 0, cancellationReason: null,
  items: [{ id: 'li_1', productId: null, productName: 'Ember Fleece Hoodie', variantLabel: 'M / Ember', quantity: 1, priceCents: 12800, imageUrl: img('hoodie-ember') }],
  buyerCancelDeadline: new Date(Date.parse(iso(20 * MIN)) + 60 * MIN).toISOString(), sellerCancelWindowHours: 1,
};
const DELIVERED = {
  id: '7a2b3c4d-5e6f-4a71-8b82-a3c4d5e6f708', orderNumber: 'BT-10031', ownerId: 'user_northline', sellerDisplayName: 'Northline Studio',
  status: 'delivered', subtotalCents: 9600, shippingCents: 800, taxCents: 0, totalCents: 10400, createdAt: iso(9 * DAY), paidAt: iso(9 * DAY), shippedAt: iso(7 * DAY),
  shippingAddress: ADDRESS, stripePaymentIntentId: 'pi_demo_2', discountAmountCents: 0, threadCashAppliedCents: 0, cancellationReason: null,
  trackingNumber: '9400111899223344556677', carrier: 'USPS', trackingStatus: 'delivered',
  items: [{ id: 'li_2', productId: null, productName: 'Graphite Runner', variantLabel: 'US 9', quantity: 1, priceCents: 9600, imageUrl: img('runner-rust') }],
};
const SHIPPED = {
  id: '8b3c4d5e-6f70-4b82-9c93-b4d5e6f70819', orderNumber: 'BT-10027', ownerId: 'user_atelier', sellerDisplayName: 'Atelier Noir',
  status: 'shipped', subtotalCents: 21000, shippingCents: 0, taxCents: 0, totalCents: 21000, createdAt: iso(4 * DAY), paidAt: iso(4 * DAY), shippedAt: iso(2 * DAY),
  shippingAddress: ADDRESS, stripePaymentIntentId: 'pi_demo_3', discountAmountCents: 0, threadCashAppliedCents: 0, cancellationReason: null,
  trackingNumber: '1Z999AA10123456784', carrier: 'UPS', trackingStatus: 'in_transit',
  items: [{ id: 'li_3', productId: null, productName: 'Onyx Chore Jacket', variantLabel: 'L', quantity: 1, priceCents: 21000, imageUrl: img('jacket-onyx') }],
};
const ORDERS = [PROCESSING, SHIPPED, DELIVERED];

const RETURN_ROW = {
  id: 'ret_demo_1', orderId: DELIVERED.id, buyerId: BUYER_USER.id, sellerId: 'user_northline', reason: 'wrong_size', notes: '',
  resolutionRequested: 'refund', status: 'refunded', stripeRefundId: 're_demo', refundAmountCents: 9600, sellerResponse: null,
  evidenceUrls: [], requestedItems: [{ lineItemId: 'li_2', productName: 'Graphite Runner', variantTitle: 'US 9', quantity: 1, unitPriceCents: 9600 }],
  returnLabelUrl: 'https://shippo-delivery.s3.amazonaws.com/demo-return-label.pdf', returnCarrier: 'USPS', returnTrackingNumber: '9202090153540022334455',
  returnTrackingStatus: null, refundOnScan: false, createdAt: iso(3 * DAY), updatedAt: iso(2 * 60 * MIN),
  orderNumber: DELIVERED.orderNumber, totalCents: DELIVERED.totalCents, sellerName: 'Northline Studio', buyerName: 'Jordan Reyes',
};

// The return-request screen reads the order from the buyer order cache in
// the web preview (services/orderService.ts getBuyerOrder), so seed it.
const CACHED_DELIVERED = {
  id: DELIVERED.id, orderNumber: DELIVERED.orderNumber, sellerId: 'user_northline', sellerName: 'Northline Studio', sellerHandle: '@northline',
  status: 'delivered', paymentStatus: 'paid', fulfillmentStatus: 'fulfilled',
  lineItems: [{ productId: null, productName: 'Graphite Runner', variant: 'US 9', quantity: 1, unitPriceCents: 9600, imageUri: img('runner-rust') }],
  shippingAddress: { name: 'Jordan Reyes', line1: ADDRESS.street, city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
  payment: { subtotalCents: 9600, shippingTotalCents: 800, taxTotalCents: 0, totalCents: 10400 },
  isPreOrder: false, hasReturnRequest: false, createdAt: DELIVERED.createdAt,
};

let ORIGIN = '';
function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function open(browser, images, role, target, { returns = [], ready } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  // Keyed by the order service's user id, which is 'anon' until init() runs.
  await context.addInitScript(([keys, value]) => { for (const key of keys) localStorage.setItem(key, value); },
    [[`buyer_orders:${BUYER_USER.id}:v2`, 'buyer_orders:anon:v2'], JSON.stringify([CACHED_DELIVERED])]);
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/orders') return json(route, ORDERS);
    const order = ORDERS.find((o) => p === `/api/buyer/orders/${o.id}`);
    if (order) return json(route, order);
    if (p === '/api/returns/buyer') return json(route, returns);
    if (p === `/api/returns/${RETURN_ROW.id}`) return json(route, RETURN_ROW);
    if (p === '/api/seller/cancel-window') return json(route, { hours: 24, options: [1, 12, 24, 72] });
    return route.fallback();
  });
  if (process.env.DBG) {
    page.on('response', (r) => { if (r.url().startsWith(API)) console.log('   resp', r.status(), r.request().method(), r.url().replace(API, '')); });
    page.on('console', (m) => { if (m.type() === 'error') console.log('   console', m.text().slice(0, 200)); });
  }
  // The client-side hop after sign-in can race the app's first remount;
  // reopen until the target screen shows (as the address-autocomplete script does).
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, role, target);
    if (!ready) break;
    try {
      await page.getByText(ready).first().waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt >= 3) {
        await page.screenshot({ path: path.join(WORK_DIR, `debug-${TAG}.png`) });
        throw error;
      }
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(800);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${TAG}-${name}`);
}

async function scrollTo(page, text) {
  try {
    await page.getByText(text).first().evaluate((el) => el.scrollIntoView({ block: 'center' }), undefined, { timeout: 10_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(WORK_DIR, `debug-${TAG}.png`) });
    throw error;
  }
  await page.waitForTimeout(400);
}

async function run() {
  if (process.argv.includes('--build')) buildPreviewWeb(BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD_DIR);
  ORIGIN = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const after = TAG !== 'before';
  const only = arg('only', '').split(',').filter(Boolean);
  const want = (key) => only.length === 0 || only.includes(key);
  try {
    // 128: My Orders — search above the filter chips.
    if (want('orders')) {
      const { context, page } = await open(browser, images, 'buyer', '/(buyer)/orders', { ready: 'BT-10042' });
      await shot(page, '128-orders');
      if (after) {
        await page.getByLabel('Search all orders').fill('jacket');
        await page.waitForTimeout(500);
        await shot(page, '128-orders-search');
        await page.getByLabel('Search all orders').fill('zzz');
        await page.waitForTimeout(500);
        await shot(page, '128-orders-search-empty');
      }
      await context.close();
    }

    // 129 + 124: order detail — cancel button with the deadline, and the cancel sheet.
    if (want('cancel')) {
      const { context, page } = await open(browser, images, 'buyer', `/buyer-order-detail?id=${PROCESSING.id}`, { ready: 'Report a Problem' });
      await scrollTo(page, 'Report a Problem');
      await shot(page, '129-order-cancel');
      await page.getByText('Cancel Order').first().click();
      await page.getByText('Cancel this order?').waitFor();
      await page.waitForTimeout(600);
      await shot(page, '124-cancel-sheet');
      await context.close();
    }

    // 122: return request — description optional.
    if (want('return-form')) {
      const { context, page } = await open(browser, images, 'buyer', `/return-request?orderId=${DELIVERED.id}`, { ready: 'Request a return' });
      // In the web preview the order comes from the seeded cache, which can
      // race the order service's account init; the screen's own Try again
      // re-reads it once that has settled.
      for (let i = 0; i < 4 && !(await page.getByText('Why are you returning it?').count()); i++) {
        await page.getByText('Try again').first().click().catch(() => {});
        await page.waitForTimeout(1500);
      }
      await page.getByText('Why are you returning it?').first().waitFor({ timeout: 10_000 });
      await page.getByRole('radio', { name: 'Wrong size' }).click().catch(() => page.getByRole('radio').first().click());
      await scrollTo(page, 'Tell the seller what happened');
      await shot(page, '122-return-form');
      await page.getByTestId('return-submit').click();
      await page.waitForTimeout(800);
      await shot(page, '122-return-after-send-tap');
      await context.close();
    }

    // 123 + 124: return status — refunded with a label.
    if (want('return-detail')) {
      const { context, page } = await open(browser, images, 'buyer', `/return-detail?returnId=${RETURN_ROW.id}`, { ready: 'Refunded' });
      await shot(page, '124-return-refunded');
      if (after) {
        await scrollTo(page, 'Return label');
        await shot(page, '123-return-label');
      }
      await context.close();
    }

    // 124: order detail return card (refunded).
    if (want('return-card')) {
      const { context, page } = await open(browser, images, 'buyer', `/buyer-order-detail?id=${DELIVERED.id}`, { returns: [RETURN_ROW], ready: 'Report a Problem' });
      await scrollTo(page, 'RETURN');
      await shot(page, '124-order-return-card');
      await context.close();
    }

    // 129: seller Store policies — Buyers can cancel picker.
    if (want('policies')) {
      const { context, page } = await open(browser, images, 'seller', '/store-policies', { ready: 'Return Policy' });
      await shot(page, '129-store-policies');
      if (after) {
        await scrollTo(page, 'Buyers can cancel');
        await shot(page, '129-store-policies-cancel-window');
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
