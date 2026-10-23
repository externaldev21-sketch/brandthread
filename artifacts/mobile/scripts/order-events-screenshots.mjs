#!/usr/bin/env node
/**
 * Order events (buyer notifications + seller tracking entry), live at
 * 390×844 on the production web build (store-screenshots harness, fake API):
 *
 *   buyer  · orders list: Ordered / Shipped / Delivered dots on real states
 *          · order detail delivered by the seller (no carrier scan)
 *   seller · "Mark as shipped": carrier picker + tracking number, a format
 *            error, then the shipped order after POST /api/orders/:id/ship
 *          · a shipped order whose carrier can't report delivery: "Mark as
 *            delivered", then the delivered timeline
 *
 *   node scripts/order-events-screenshots.mjs [--skip-build]
 *
 * Output: docs/screenshots/order-events/ (repo root)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/screenshots/order-events');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();

let ORIGIN = '';
const json = (route, body, status = 200) => route.fulfill({
  status,
  headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
  contentType: 'application/json',
  body: JSON.stringify(body),
});
const apiPath = (req) => new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

function scrollMain(page, to) {
  return page.evaluate((y) => {
    const s = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible')
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (s) s.scrollTop = y;
  }, to);
}

async function scrollTo(page, locator, offset = 140) {
  await locator.first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate((o) => {
    const s = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible')
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (s) s.scrollTop -= o;
  }, offset);
}

// ─── Buyer ────────────────────────────────────────────────────────────────────

const item = (name, variant, cents, image) => ({ productName: name, variantLabel: variant, quantity: 1, priceCents: cents, imageUrl: `${IMAGE_HOST}/${image}.jpg` });

function step(key, state, at) { return { key, label: { ordered: 'Ordered', preparing: 'Preparing', shipped: 'Shipped', out_for_delivery: 'Out for delivery', delivered: 'Delivered' }[key], state, at }; }

const BUYER_ORDERS = [
  {
    id: '0b6c4e1a-1111-4c1e-9a55-2d7f3c9e1a01', orderNumber: 'BT-00051', ownerId: 'user_seller_demo', sellerDisplayName: 'Northline Studio',
    status: 'fulfilled', totalCents: 9800, subtotalCents: 8800, shippingCents: 1000, stripePaymentIntentId: 'pi_demo_1',
    paidAt: iso(now - 20 * HOUR), createdAt: iso(now - 20 * HOUR), items: [item('Ember Heavyweight Hoodie', 'Charcoal / M', 8800, 'product-hoodie')],
  },
  {
    id: '0b6c4e1a-2222-4c1e-9a55-2d7f3c9e1a02', orderNumber: 'BT-00048', ownerId: 'user_seller_demo', sellerDisplayName: 'Northline Studio',
    status: 'shipped', trackingStatus: 'in_transit', carrier: 'UPS', trackingNumber: '1Z999AA10123456784', estimatedDelivery: '2026-09-21',
    totalCents: 6400, subtotalCents: 6400, shippingCents: 0, stripePaymentIntentId: 'pi_demo_2',
    shippedAt: iso(now - 26 * HOUR), paidAt: iso(now - 3 * DAY), createdAt: iso(now - 3 * DAY), items: [item('Field Shell Jacket', 'Onyx / L', 6400, 'jacket-onyx')],
  },
  {
    id: '0b6c4e1a-3333-4c1e-9a55-2d7f3c9e1a03', orderNumber: 'BT-00042', ownerId: 'user_seller_demo', sellerDisplayName: 'Northline Studio',
    status: 'delivered', trackingStatus: 'delivered', carrier: 'Local courier', trackingNumber: 'LC20260914',
    totalCents: 14800, subtotalCents: 14800, shippingCents: 0, stripePaymentIntentId: 'pi_demo_3',
    shippedAt: iso(now - 4 * DAY), paidAt: iso(now - 6 * DAY), createdAt: iso(now - 6 * DAY),
    shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
    items: [item('Ember Heavyweight Hoodie', 'Bone / S', 14800, 'hoodie-bone')],
    delivery: {
      deliverBy: iso(now + 9 * DAY), isPreorder: false, promisedShipDate: null, estimatedDelivery: null,
      deliveredAt: iso(now - 2 * HOUR), deliveryConfirmedBy: 'seller',
      steps: [
        step('ordered', 'done', iso(now - 6 * DAY)), step('preparing', 'done', iso(now - 5 * DAY)),
        step('shipped', 'done', iso(now - 4 * DAY)), step('out_for_delivery', 'done', null), step('delivered', 'done', iso(now - 2 * HOUR)),
      ],
      events: [], carrier: 'Local courier', trackingNumber: 'LC20260914',
      trackingUrl: 'https://www.google.com/search?q=LC20260914+tracking',
      canConfirmReceipt: false, disputePaused: false, autoRefund: null, shipments: [],
    },
  },
];

async function buyer(browser, images) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = apiPath(req);
    if (p === '/api/buyer/orders') return json(route, BUYER_ORDERS);
    const detail = BUYER_ORDERS.find((o) => p === `/api/buyer/orders/${o.id}`);
    if (detail) return json(route, detail);
    if (p.startsWith('/api/returns')) return json(route, []);
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);

  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, 'buyer', '/(buyer)/orders');
    try { await page.getByText('BT-00051', { exact: false }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(900);
  const progress = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Order progress"]')].map((el) => el.getAttribute('aria-label')));
  console.log('  [buyer list] progress dots:', JSON.stringify(progress));
  await shot(page, '01-buyer-orders-progress-dots');
  await scrollTo(page, page.getByText('BT-00042', { exact: false }), 200);
  await shot(page, '02-buyer-orders-delivered-card');

  const delivered = BUYER_ORDERS[2];
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, 'buyer', `/buyer-order-detail?id=${delivered.id}`);
    try { await page.getByText(`Order ${delivered.orderNumber}`).first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(900);
  await scrollTo(page, page.getByText('Marked delivered by the seller'), 260);
  await shot(page, '03-buyer-detail-delivered-by-seller');
  await context.close();
}

// ─── Seller ───────────────────────────────────────────────────────────────────

function sellerOrder(overrides = {}) {
  return {
    id: '7a2d9c4e-4b7a-4c1e-9a55-2d7f3c9e1b77', ownerId: 'user_northline', buyerId: BUYER_USER.id,
    customerId: null, customer: { id: 'c1', name: 'Jordan Reyes', email: 'jordan@example.com', orderCount: 2, totalSpentCents: 23600, tags: [] },
    shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
    orderNumber: 'BT-00051', status: 'pending', totalCents: 9800, subtotalCents: 8800, shippingCents: 1000,
    stripePaymentIntentId: 'pi_demo_1', paidAt: iso(now - 20 * HOUR), createdAt: iso(now - 20 * HOUR), updatedAt: iso(now - 20 * HOUR),
    trackingNumber: null, carrier: null, trackingStatus: null, shippedAt: null, deliveredAt: null,
    deliverBy: iso(now + 13 * DAY), sellerCanMarkDelivered: false,
    items: [{ id: 'item-1', productId: 'prod_hoodie', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 8800, imageUrl: `${IMAGE_HOST}/product-hoodie.jpg` }],
    ...overrides,
  };
}

async function openSellerOrder(page, activity, order) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, ORIGIN, 'seller', `/order-detail?id=${order.id}`);
    try { await page.getByText(order.orderNumber).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(900);
}

async function sellerShip(browser, images) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images });
  let order = sellerOrder();
  const posted = [];
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = apiPath(req);
    if (p === `/api/orders/${order.id}` && req.method() === 'GET') return json(route, order);
    if (p === `/api/orders/${order.id}/ship` && req.method() === 'POST') {
      const body = req.postDataJSON();
      posted.push(body);
      order = { ...order, status: 'shipped', carrier: body.carrier, trackingNumber: body.trackingNumber, trackingStatus: null, shippedAt: iso(now), updatedAt: iso(now) };
      return json(route, order);
    }
    if (p.startsWith('/api/returns') || p.startsWith('/api/disputes')) return json(route, []);
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  await openSellerOrder(page, activity, order);
  await shot(page, '04-seller-order-ordered');

  await page.getByRole('button', { name: 'Mark as shipped' }).click();
  await page.getByTestId('carrier-ups').waitFor();
  await scrollTo(page, page.getByText('Mark as shipped'), 120);
  await shot(page, '05-seller-mark-shipped-form');

  await page.getByTestId('carrier-ups').click();
  await page.getByTestId('tracking-number-input').fill('1Z12345');
  await page.getByTestId('mark-shipped-submit').click();
  await page.getByText(/doesn't look like a valid tracking number/).waitFor();
  await shot(page, '06-seller-mark-shipped-invalid-number');

  await page.getByTestId('tracking-number-input').fill('1z999aa10123456784');
  await page.getByTestId('mark-shipped-submit').click();
  await page.getByText('SHIPPED').first().waitFor({ timeout: 10_000 });
  await waitForQuietNetwork(activity);
  await page.waitForTimeout(600);
  console.log('  [seller ship] POST /ship bodies:', JSON.stringify(posted));
  await scrollMain(page, 0);
  await shot(page, '07-seller-order-shipped');
  await context.close();
}

async function sellerDelivered(browser, images) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images });
  let order = sellerOrder({
    id: '7a2d9c4e-4b7a-4c1e-9a55-2d7f3c9e1b78', orderNumber: 'BT-00042', status: 'shipped',
    carrier: 'Local courier', trackingNumber: 'LC20260914', shippedAt: iso(now - 4 * DAY), sellerCanMarkDelivered: true,
  });
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = apiPath(req);
    if (p === `/api/orders/${order.id}` && req.method() === 'GET') return json(route, order);
    if (p.startsWith('/api/returns') || p.startsWith('/api/disputes')) return json(route, []);
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  await openSellerOrder(page, activity, order);
  await scrollTo(page, page.getByRole('button', { name: 'Mark as delivered' }), 420);
  await shot(page, '08-seller-mark-delivered-fallback');

  // What the screen shows after POST /api/orders/:id/mark-delivered.
  order = { ...order, status: 'delivered', trackingStatus: 'delivered', deliveredAt: iso(now), deliveryConfirmedBy: 'seller', sellerCanMarkDelivered: false };
  await openSellerOrder(page, activity, order);
  await shot(page, '09-seller-order-delivered');
  const timelineTab = page.getByText('Timeline', { exact: true }).first();
  if (await timelineTab.count()) {
    await timelineTab.click();
    await page.waitForTimeout(700);
    await shot(page, '10-seller-timeline-delivered');
  }
  await context.close();
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    const server = await serveBuild(DEFAULT_BUILD_DIR);
    ORIGIN = server.origin;
    try {
      await buyer(browser, images);
      await sellerShip(browser, images);
      await sellerDelivered(browser, images);
    } finally {
      server.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
