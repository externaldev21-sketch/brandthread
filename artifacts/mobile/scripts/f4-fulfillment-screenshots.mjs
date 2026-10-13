#!/usr/bin/env node
/**
 * Seller money tools 6 (items 50–52), live on the store-screenshots harness
 * (fake API, signed-in demo seller).
 *
 *   node scripts/f4-fulfillment-screenshots.mjs <buildDir> <outDir> <before|after> [393x852|390x844] [slipHtmlDir]
 *
 * Label rates with "Save $X vs retail", the packing slip sheet (order detail,
 * fulfillment, bulk), the returns list with one-tap Approve / Decline, and
 * return detail with refund amount, refund on scan and the prepaid label form.
 * "before" captures the same screens on dev for the before/after pairs.
 */
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const [W, H] = (process.argv[5] ?? '393x852').split('x').map(Number);
const SLIPS = process.argv[6] ? path.resolve(process.argv[6]) : null;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: W, height: H };
const SIZE = `${W}x${H}`;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SELLER_ID = 'user_northline';

const NOW = Date.parse('2026-10-12T16:30:00Z');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600e3).toISOString();

function orderDetail(id, number, name) {
  return {
    id, ownerId: SELLER_ID, buyerId: null, customerId: null, customer: null,
    customerName: name, customerEmail: `${name.split(' ')[0].toLowerCase()}@example.com`, guestEmail: `${name.split(' ')[0].toLowerCase()}@example.com`,
    shippingAddress: { name, street: '129 Ember Court', city: 'Portland', state: 'OR', zip: '97205', country: 'US' },
    orderNumber: number, status: 'processing', totalCents: 28200, subtotalCents: 28200, shippingCents: 0,
    trackingNumber: null, carrier: null, createdAt: iso(5), updatedAt: iso(4), paidAt: iso(5),
    items: [
      { id: `${id}-1`, productId: 'p1', productName: 'Heavyweight Hoodie', variantLabel: 'Charcoal / M', sku: 'NS-HW-CHR-M', quantity: 1, priceCents: 9800 },
      { id: `${id}-2`, productId: 'p2', productName: 'Field Shell Jacket', variantLabel: 'Olive / L', sku: 'NS-FS-OLV-L', quantity: 1, priceCents: 18400 },
    ],
  };
}
const ORDERS = { ord_f4: orderDetail('ord_f4', 'NS-1046', 'Amara Chen'), ord_f5: orderDetail('ord_f5', 'NS-1045', 'Diego Santos') };

const RATES = [
  { id: 'rate_ep_usps', carrier: 'USPS', service: 'Ground Advantage', priceCents: 695, currency: 'USD', estimatedDays: 3, estimatedDelivery: 'Oct 16', trackingIncluded: true, insuranceIncluded: false, provider: 'easypost', retailPriceCents: 940, savingsCents: 245 },
  { id: 'rate_ep_usps_pri', carrier: 'USPS', service: 'Priority Mail', priceCents: 912, currency: 'USD', estimatedDays: 2, estimatedDelivery: 'Oct 15', trackingIncluded: true, insuranceIncluded: false, provider: 'easypost', retailPriceCents: 1135, savingsCents: 223 },
  { id: 'rate_sh_ups', carrier: 'UPS', service: 'Ground', priceCents: 1240, currency: 'USD', estimatedDays: 4, estimatedDelivery: 'Oct 17', trackingIncluded: true, insuranceIncluded: false, provider: 'shippo', retailPriceCents: null, savingsCents: null },
];

const RETURN_PENDING = {
  id: 'ret_f4a', orderId: 'ord_f4', orderNumber: 'NS-1046', buyerId: 'user_amara', sellerId: SELLER_ID,
  buyerName: 'Amara Chen', sellerName: 'Northline Studio', status: 'pending', reason: 'wrong_size',
  notes: 'The hoodie runs small. Could I return it?', evidenceUrls: [], totalCents: 28200,
  requestedItems: [{ lineItemId: 'ord_f4-1', productName: 'Heavyweight Hoodie', variantTitle: 'Charcoal / M', quantity: 1, unitPriceCents: 9800 }],
  refundAmountCents: null, sellerResponse: null, refundOnScan: false, returnLabelUrl: null, createdAt: iso(3), updatedAt: iso(3),
};
const RETURN_PENDING_2 = { ...RETURN_PENDING, id: 'ret_f4b', orderId: 'ord_f5', orderNumber: 'NS-1045', buyerId: 'user_diego', buyerName: 'Diego Santos', reason: 'damaged', notes: 'Zip pull came off on day one.', totalCents: 18400 };
const RETURN_REFUNDED = { ...RETURN_PENDING, id: 'ret_f4c', orderNumber: 'NS-1039', buyerName: 'Priya Nair', status: 'refunded', reason: 'changed_mind', notes: '', refundAmountCents: 6400, createdAt: iso(60), updatedAt: iso(50) };

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${MODE}-${SIZE}-${name}.png`), caret: 'hide' });
  console.log(`  ok ${MODE}-${SIZE}-${name}`);
}

async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const offScreen = r.right > vw + 1 || r.left < -1;
      if (clipped || ellipsis || offScreen) out.push({ text: text.slice(0, 40), clipped, ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}

async function waitFor(page, target, locator) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await locator().first().waitFor({ timeout: 12_000 });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, target);
    }
  }
}

/**
 * The signed-out seller preview refuses every API call (lib/api.ts), so the
 * stubbed API is reached the way a signed-in seller reaches it: load once in
 * the seller preview (seeds the seller role), then drop the preview flag and
 * navigate client-side with the stub Clerk session.
 */
async function go(page, activity, origin, target) {
  await openScreen(page, activity, origin, 'seller', '/');
  await page.evaluate((url) => {
    localStorage.removeItem('user_role');
    // Keep it off for the rest of this page (the app writes it back on role changes).
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'user_role') return; return setItem.call(this, key, value); };
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, target);
}

async function sellerContext(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.addInitScript(() => {
    localStorage.setItem('@brandthread/fulfill-last-package:v1', JSON.stringify({ kind: 'custom', weight: '1.5', length: '12', width: '9', height: '3' }));
    // Print dialogs are captured as screenshots, not opened.
    window.print = () => {};
  });
  page.on('pageerror', (err) => console.log('pageerror', err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('console.error', msg.text().slice(0, 300)); });
  if (process.env.F4_DEBUG) page.on('request', (r) => { if (!r.url().includes('/_expo/') && !r.url().includes('cdn.')) console.log('req', r.method(), r.url()); });
  const returns = [RETURN_PENDING, RETURN_PENDING_2, RETURN_REFUNDED].map(r => ({ ...r }));
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (process.env.F4_DEBUG) console.log('api', request.method(), p);
    const orderMatch = p.match(/^\/api\/orders\/(ord_f[45])$/);
    if (orderMatch) return json(route, ORDERS[orderMatch[1]]);
    if (/^\/api\/shipping-labels\/ord_f[45]\/parcel-suggestion$/.test(p)) return json(route, { weightKnown: false, weightLb: 0 });
    if (/^\/api\/shipping-labels\/ord_f[45]\/rates$/.test(p)) {
      return json(route, { shipmentId: 'shp_f4', rates: MODE === 'before' ? RATES.map(({ provider, retailPriceCents, savingsCents, ...r }) => r) : RATES });
    }
    if (p === '/api/returns' && request.method() === 'GET') return json(route, returns);
    const retMatch = p.match(/^\/api\/returns\/(ret_f4[abc])(\/status)?$/);
    if (retMatch) {
      const row = returns.find(r => r.id === retMatch[1]);
      if (retMatch[2] && request.method() === 'PATCH') {
        Object.assign(row, { status: 'refunded', refundAmountCents: row.totalCents, updatedAt: new Date(NOW).toISOString() });
      }
      return json(route, row);
    }
    return route.fallback();
  });
  return { context, page, activity };
}

async function orderDetailFlow(browser, images, origin) {
  const { context, page, activity } = await sellerContext(browser, images, origin);
  await go(page, activity, origin, '/order-detail?id=ord_f4');
  await waitFor(page, '/order-detail?id=ord_f4', () => page.getByText('Heavyweight Hoodie'));
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, '01-order-detail');
  await overflowCheck(page, 'order-detail');
  if (MODE === 'after') {
    await page.getByLabel('Print packing slip').first().click();
    await page.getByTestId('packing-slip-sheet').first().waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, '02-packing-slip-sheet');
    await overflowCheck(page, 'packing-slip-sheet');
    await page.getByLabel('Gift — hide prices').first().click();
    await page.waitForTimeout(500);
    await shot(page, '03-packing-slip-sheet-gift');
  }
  await context.close();
}

async function fulfillFlow(browser, images, origin) {
  const { context, page, activity } = await sellerContext(browser, images, origin);
  await go(page, activity, origin, '/fulfill-order?orderId=ord_f4&step=3');
  await waitFor(page, '/fulfill-order?orderId=ord_f4&step=3', () => page.getByText('Ground Advantage'));
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, '04-label-rates');
  await overflowCheck(page, 'label-rates');
  if (MODE === 'after') {
    await go(page, activity, origin, '/fulfill-order?orderId=ord_f4');
    await waitFor(page, '/fulfill-order?orderId=ord_f4', () => page.getByText('Packing slip', { exact: true }));
    await page.waitForTimeout(600);
    await page.getByText('Packing slip', { exact: true }).first().click();
    await page.waitForTimeout(900);
    await shot(page, '05-fulfill-packing-slip-sheet');
  }
  await context.close();
}

async function returnsFlow(browser, images, origin) {
  const { context, page, activity } = await sellerContext(browser, images, origin);
  await go(page, activity, origin, '/shipping');
  await waitFor(page, '/shipping', () => page.getByText('Returns & Exchanges'));
  await waitForQuietNetwork(activity, 900, 15_000);
  const firstReturn = page.getByText('#NS-1046 · Amara Chen').first();
  await firstReturn.waitFor({ timeout: 10_000 }).catch(() => {});
  await page.getByText('Returns & Exchanges', { exact: true }).first().evaluate((el) => el.scrollIntoView({ block: 'start' })).catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, '06-returns-list');
  await overflowCheck(page, 'returns-list');
  if (MODE === 'after') {
    await page.getByTestId('return-row-approve-ret_f4a').first().click();
    await page.waitForTimeout(900);
    await shot(page, '07-returns-list-approved-toast');
  }
  await context.close();
}

async function returnDetailFlow(browser, images, origin) {
  const { context, page, activity } = await sellerContext(browser, images, origin);
  await go(page, activity, origin, '/return-detail?returnId=ret_f4b');
  await waitFor(page, '/return-detail?returnId=ret_f4b', () => page.getByText('Review this return'));
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await page.getByTestId('return-approve').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, '08-return-detail-decision');
  await overflowCheck(page, 'return-detail');
  if (MODE === 'after') {
    const amount = page.getByLabel('Refund amount').first();
    await amount.fill('120.00');
    await page.getByTestId('return-refund-on-scan').first().click();
    await page.waitForTimeout(500);
    await page.getByTestId('return-approve').first().scrollIntoViewIfNeeded();
    await shot(page, '09-return-detail-partial-on-scan');
    await page.getByTestId('return-send-label').first().click();
    await page.waitForTimeout(700);
    await page.getByLabel('Name').first().fill('Northline Studio');
    await page.getByLabel('Street').first().fill('9 Dock Rd');
    await page.getByLabel('City').first().fill('Austin');
    await page.getByLabel('State').first().fill('TX');
    await page.getByLabel('ZIP').first().fill('78702');
    await page.getByLabel('Weight (lb)').first().fill('1.5');
    await page.getByLabel('L (in)').first().fill('12');
    await page.getByLabel('W (in)').first().fill('9');
    await page.getByLabel('H (in)').first().fill('3');
    await page.getByText('Your return address').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, '10-return-label-form');
    await page.getByTestId('return-label-submit').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, '11-return-label-form-submit');
    await overflowCheck(page, 'return-label-form');

    await go(page, activity, origin, '/return-detail?returnId=ret_f4a&decline=1');
    await waitFor(page, '/return-detail?returnId=ret_f4a&decline=1', () => page.getByText('Reason for the buyer'));
    await page.waitForTimeout(800);
    await page.getByText('Reason for the buyer').first().scrollIntoViewIfNeeded();
    await shot(page, '12-return-detail-decline-from-list');
  }
  await context.close();
}

async function batchFlow(browser, images, origin) {
  const { context, page, activity } = await sellerContext(browser, images, origin);
  await go(page, activity, origin, '/fulfill-batch?orderIds=ord_f4,ord_f5');
  await waitFor(page, '/fulfill-batch?orderIds=ord_f4,ord_f5', () => page.getByText('Selected orders'));
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, '13-fulfill-batch');
  await overflowCheck(page, 'fulfill-batch');
  if (MODE === 'after') {
    await page.getByText('Print packing slips', { exact: true }).first().click();
    await page.waitForTimeout(900);
    await shot(page, '14-fulfill-batch-packing-slips-sheet');
  }
  await context.close();
}

async function slipImages(browser) {
  if (!SLIPS) return;
  const page = await browser.newPage({ viewport: { width: 612, height: 792 }, deviceScaleFactor: 2 });
  for (const file of readdirSync(SLIPS).filter(f => f.endsWith('.html'))) {
    await page.setContent(readFileSync(path.join(SLIPS, file), 'utf8'));
    await page.screenshot({ path: path.join(OUT, `after-pdf-${file.replace('.html', '')}.png`), fullPage: true });
    console.log(`  ok after-pdf-${file}`);
  }
  await page.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const only = process.env.F4_ONLY ? process.env.F4_ONLY.split(',') : null;
  const flows = { orderDetailFlow, fulfillFlow, returnsFlow, returnDetailFlow, batchFlow };
  try {
    for (const [name, flow] of Object.entries(flows)) {
      if (only && !only.includes(name)) continue;
      try { await flow(browser, images, server.origin); } catch (error) { console.error(`flow ${name} failed:`, error.message); }
    }
    if (MODE === 'after' && !only) await slipImages(browser);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
