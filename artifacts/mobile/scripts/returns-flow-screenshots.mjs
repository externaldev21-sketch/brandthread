#!/usr/bin/env node
/**
 * Item 108 — end-to-end live check of the buyer return request flow and the
 * seller's side of it, at 390×844, on the production web build
 * (store-screenshots harness: signed-in demo buyer Jordan / seller
 * Northline).
 *
 * The fake API is stateful and speaks the real routes' shapes
 * (routes/returns.ts, routes/buyer.ts, notifications-feed): POST
 * /api/returns/evidence → objectPath; POST /api/returns stores a pending
 * row built from the order's items; GET /api/returns/:id | /buyer | /
 * read it back (evidence as signed URLs); PATCH /:id/status approves
 * (→ refunded, like a confirmed Stripe refund) or declines. The seller's
 * Activity feed gets the exact row notifySellerReturnRequested publishes.
 *
 *   node scripts/returns-flow-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/returns-flow-108/
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST, SELLER_USER } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/returns-flow-108');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const ORDER_ID = '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42';
const ORDER_NUMBER = 'BT-00042';
const ITEM = { id: '0c0a7a39-6c1d-4c9e-b1f4-3a1d2a9e8b11', productId: 'prod_hoodie', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg` };

// ── Stateful backend ──────────────────────────────────────────────────────
const state = { returns: [], uploads: 0, calls: [] };
const buyerOrder = () => ({
  id: ORDER_ID, orderNumber: ORDER_NUMBER, ownerId: SELLER_USER.id, sellerDisplayName: 'Northline Studio',
  status: 'delivered', totalCents: 16000, subtotalCents: 14800, shippingCents: 1200,
  trackingNumber: '1Z999AA10123456784', carrier: 'UPS', trackingStatus: 'delivered', estimatedDelivery: null,
  shippedAt: iso(now - 4 * DAY), paidAt: iso(now - 6 * DAY),
  shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
  stripePaymentIntentId: 'pi_demo', cancellationReason: null, cancellationNotes: null, isCustomerVisible: false,
  createdAt: iso(now - 6 * DAY), items: [ITEM],
});
const sellerOrder = () => ({
  ...buyerOrder(), buyerId: BUYER_USER.id, customerName: 'Jordan Reyes', customerEmail: 'jordan@example.com',
  customer: { id: BUYER_USER.id, name: 'Jordan Reyes', email: 'jordan@example.com' }, updatedAt: iso(now - 2 * DAY),
});
const withNames = (row) => ({
  ...row, orderNumber: ORDER_NUMBER, totalCents: 16000, sellerName: 'Northline Studio', buyerName: 'Jordan Reyes',
  // The server signs private evidence paths; here each maps to a demo photo.
  evidenceUrls: row.evidenceUrls.map((_, i) => `${IMAGE_HOST}/${['hoodie-ember', 'hoodie-graphite', 'hoodie-bone'][i % 3]}.jpg`),
});
const sellerFeed = () => state.returns.map((r) => ({
  id: `n-${r.id}`, category: 'returns', type: 'return_request_received', title: 'Jordan Reyes requested a return',
  body: `Order #${ORDER_NUMBER}. Review the request and approve or decline it.`, isRead: false, isMuted: false,
  targetId: r.id, targetType: 'return', cta: 'Review return', createdAt: r.createdAt,
  actorId: BUYER_USER.id, actorName: 'Jordan Reyes', actorInitials: 'JR', actorColor: '#3F3F46',
}));

async function installApi(context, role) {
  const norm = (p) => p.replace(/^\/api\/v1\//, '/api/');
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    const m = req.method();
    if (p.startsWith('/api/returns')) state.calls.push(`${role} ${m} ${p}`);
    if (p === `/api/buyer/orders/${ORDER_ID}`) return json(buyerOrder());
    if (p === `/api/orders/${ORDER_ID}`) return json(sellerOrder());
    if (p === '/api/returns/evidence' && m === 'POST') { state.uploads += 1; return json({ objectPath: `/objects/returns/${BUYER_USER.id}/photo-${state.uploads}` }, 201); }
    if (p === '/api/returns' && m === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      if (state.returns.some((r) => r.status !== 'denied')) return json({ error: 'A return request already exists for this order' }, 409);
      const row = {
        id: `ret-${state.returns.length + 1}`, orderId: ORDER_ID, buyerId: BUYER_USER.id, sellerId: SELLER_USER.id,
        reason: body.reason, notes: body.notes ?? null, resolutionRequested: body.resolutionRequested ?? 'refund', status: 'pending',
        stripeRefundId: null, refundAmountCents: null, sellerResponse: null, evidenceUrls: body.evidenceUrls ?? [],
        requestedItems: [{ lineItemId: ITEM.id, productName: ITEM.productName, variantTitle: ITEM.variantLabel, quantity: 1, unitPriceCents: ITEM.priceCents }],
        createdAt: iso(now - 20 * 60_000), updatedAt: iso(now - 20 * 60_000),
      };
      state.lastCreateBody = body;
      state.returns.push(row);
      return json(row, 201);
    }
    if (p === '/api/returns/buyer') return json(state.returns.map(withNames));
    if (p === '/api/returns' && m === 'GET') return json(state.returns.map(withNames));
    const one = p.match(/^\/api\/returns\/([^/]+)$/);
    if (one) {
      const r = state.returns.find((x) => x.id === one[1]);
      return r ? json(withNames(r)) : json({ error: 'Return not found' }, 404);
    }
    const patch = p.match(/^\/api\/returns\/([^/]+)\/status$/);
    if (patch && m === 'PATCH') {
      const r = state.returns.find((x) => x.id === patch[1]);
      const body = JSON.parse(req.postData() ?? '{}');
      if (body.status === 'approved') Object.assign(r, { status: 'refunded', refundAmountCents: 16000, updatedAt: iso(now - 5 * 60_000) });
      else Object.assign(r, { status: 'denied', sellerResponse: body.sellerResponse, updatedAt: iso(now - 5 * 60_000) });
      return json(r);
    }
    if (role === 'seller' && p === '/api/buyer/notifications' && m === 'GET') return json(sellerFeed());
    if (role === 'seller' && p === '/api/buyer/notifications/unread-count') return json({ count: state.returns.length, latestId: sellerFeed()[0]?.id ?? null });
    return route.fallback();
  });
}

async function open(browser, images, origin, role, target, ready) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await installApi(context, role);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, role, target);
    try { await ready(page).waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) { await page.screenshot({ path: path.join(WORK_DIR, 'returns-debug.png') }); throw e; } }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(700);
  return { context, page, activity };
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, animations: 'disabled', caret: 'hide' });
  console.log(`  ✓ ${name}`);
}
async function tallShot(page, name) {
  const extra = await page.evaluate(() => {
    const s = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible').sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (s) s.scrollTop = 0;
    return s ? s.scrollHeight - s.clientHeight : 0;
  });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
  await page.waitForTimeout(500);
  await shot(page, name);
  await page.setViewportSize(VIEWPORT);
}
const text = (page) => page.locator('body').innerText();

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const photoDir = path.join(WORK_DIR, 'demo-images');
  const photo = path.join(photoDir, readdirSync(photoDir).find((f) => f.endsWith('.jpg')));
  const results = {};
  try {
    // ── Buyer: order → request form → validation → submit → status ─────────
    {
      const { context, page } = await open(browser, images, origin, 'buyer', `/buyer-order-detail?id=${ORDER_ID}`, (p) => p.getByText(`Order ${ORDER_NUMBER}`).first());
      await page.getByText('Request Return').first().scrollIntoViewIfNeeded();
      await shot(page, 'buyer-01-order-request-return-button');
      await page.getByText('Request Return').first().click();
      await page.getByTestId('return-submit').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      await shot(page, 'buyer-02-request-form');
      await tallShot(page, 'buyer-02-request-form-full');
      await page.getByTestId('return-submit').click();
      await page.waitForTimeout(400);
      results.validation = (await text(page)).match(/Choose a reason\.|Describe the problem[^\n]*/g);
      await page.getByRole('radio', { name: 'Damaged on arrival' }).click();
      await page.getByTestId('return-description').fill('The left sleeve seam split the first time I wore it. Photos attached.');
      const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
      await page.getByLabel('Add photos').click();
      await (await chooser).setFiles(photo);
      await page.getByLabel('Photo 1', { exact: true }).waitFor({ timeout: 10_000 });
      await page.getByTestId('return-description').blur();
      await tallShot(page, 'buyer-03-form-filled-with-photo');
      await page.getByTestId('return-submit').click();
      await page.getByTestId('return-request-submitted').waitFor({ timeout: 15_000 });
      results.createBody = state.lastCreateBody;
      await shot(page, 'buyer-04-submitted');
      await page.getByTestId('return-view-status').click();
      await page.getByTestId('return-headline').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
      results.buyerPendingHeadline = await page.getByTestId('return-headline').innerText();
      await tallShot(page, 'buyer-05-return-status-pending');
      // Back on the order: the return card + "View Return", and a second request is routed to the existing one.
      await openScreen(page, { lastApiAt: Date.now() }, origin, 'buyer', `/buyer-order-detail?id=${ORDER_ID}`);
      await page.getByTestId('order-return-card').waitFor({ timeout: 15_000 });
      await page.getByTestId('order-return-card').scrollIntoViewIfNeeded();
      await shot(page, 'buyer-06-order-with-return-card');
      await openScreen(page, { lastApiAt: Date.now() }, origin, 'buyer', `/return-request?orderId=${ORDER_ID}`);
      await page.getByText('You already requested a return').waitFor({ timeout: 15_000 });
      await shot(page, 'buyer-07-second-request-points-to-existing');
      await context.close();
    }

    // ── Seller: Activity row → return → approve (refund) ────────────────────
    {
      // Order and return rows live under Activity's "Orders" chip ("All" is the social feed).
      const { context, page } = await open(browser, images, origin, 'seller', '/activity-center', (p) => p.getByRole('button', { name: 'Orders', exact: true }).first());
      await page.getByRole('button', { name: 'Orders', exact: true }).first().click();
      await page.locator('[aria-label*="Jordan Reyes requested a return"]').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await shot(page, 'seller-01-activity-return-requested');
      await page.locator('[aria-label*="Jordan Reyes requested a return"]').first().click();
      await page.getByTestId('return-headline').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);
      results.sellerPendingHeadline = await page.getByTestId('return-headline').innerText();
      results.sellerPath = new URL(page.url()).pathname + new URL(page.url()).search;
      await tallShot(page, 'seller-02-return-review');
      // The same request from the order's Returns tab.
      await openScreen(page, { lastApiAt: Date.now() }, origin, 'seller', `/order-detail?id=${ORDER_ID}&tab=returns`);
      await page.getByTestId('seller-return-ret-1').waitFor({ timeout: 15_000 });
      await shot(page, 'seller-03-order-returns-tab');
      await page.getByTestId('seller-return-ret-1').click();
      await page.getByTestId('return-approve').waitFor({ timeout: 15_000 });
      await page.getByTestId('return-approve').click();
      await page.getByText('Refunded $160.00').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await tallShot(page, 'seller-04-approved-refunded');
      await context.close();
    }

    // ── Buyer again: sees the refund ─────────────────────────────────────────
    {
      const { context, page } = await open(browser, images, origin, 'buyer', '/return-detail?returnId=ret-1', (p) => p.getByTestId('return-headline'));
      results.buyerRefundedHeadline = await page.getByTestId('return-headline').innerText();
      await shot(page, 'buyer-08-return-refunded');
      await context.close();
    }

    // ── Decline path (fresh request) ─────────────────────────────────────────
    {
      state.returns.length = 0;
      state.returns.push({
        id: 'ret-2', orderId: ORDER_ID, buyerId: BUYER_USER.id, sellerId: SELLER_USER.id, reason: 'changed_mind', notes: 'Ordered the wrong colour.',
        resolutionRequested: 'refund', status: 'pending', stripeRefundId: null, refundAmountCents: null, sellerResponse: null, evidenceUrls: [],
        requestedItems: [{ lineItemId: ITEM.id, productName: ITEM.productName, variantTitle: ITEM.variantLabel, quantity: 1, unitPriceCents: ITEM.priceCents }],
        createdAt: iso(now - 60 * 60_000), updatedAt: iso(now - 60 * 60_000),
      });
      const seller = await open(browser, images, origin, 'seller', '/return-detail?returnId=ret-2', (p) => p.getByTestId('return-decline'));
      await seller.page.getByTestId('return-decline').click();
      await seller.page.getByTestId('return-decline-reason').fill('The hoodie was worn and the tags were removed.');
      await shot(seller.page, 'seller-05-decline-with-reason');
      await seller.page.getByTestId('return-decline-submit').click();
      await seller.page.getByText('Return declined').first().waitFor({ timeout: 15_000 });
      await seller.context.close();
      const buyer = await open(browser, images, origin, 'buyer', '/return-detail?returnId=ret-2', (p) => p.getByTestId('return-headline'));
      results.buyerDeclined = (await text(buyer.page)).match(/Return declined[\s\S]{0,120}/)?.[0];
      await shot(buyer.page, 'buyer-09-return-declined');
      await buyer.context.close();
    }

    // ── Empty / error states ─────────────────────────────────────────────────
    {
      const { context, page } = await open(browser, images, origin, 'buyer', '/return-detail?returnId=missing', (p) => p.getByText('Return not found'));
      await shot(page, 'buyer-10-return-not-found');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  results.returnsCalls = state.calls;
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
