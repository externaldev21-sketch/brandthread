#!/usr/bin/env node
/**
 * Discount code usage limits + active dates, redemptions, and sale active
 * dates on the store-screenshots harness (fake API, signed-in demo seller).
 *
 *   node scripts/f4-discounts-sales-screenshots.mjs <buildDir> <outDir> <before|after> [width]
 *
 * width 390 (844 tall) for before/after pairs, 393 (852 tall) for the PR's
 * screenshot set. The fake API has no discount/sale data, so this script
 * answers those routes with the in-memory rows below; nothing here ships.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const WIDTH = Number(process.argv[5] ?? 390);
const VIEWPORT = WIDTH === 393 ? { width: 393, height: 852 } : { width: 390, height: 844 };
const TAG = `${MODE}-${VIEWPORT.width}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

// Demo clock (harness): 2026-09-18 4:30 PM in Los Angeles.
const CODES = [
  // Saved before time pickers existed: date only (UTC midnight), no zone.
  { id: 'dc1', code: 'WELCOME15', type: 'percentage', value: '15', minOrderCents: 0, appliesTo: 'entire_store', productIds: [], collectionIds: [], firstOrderOnly: true, minQuantity: 0, maxUses: null, maxUsesPerCustomer: null, usesCount: 3, oneUsePerCustomer: true, startsAt: null, expiresAt: '2026-10-20T00:00:00.000Z', scheduleTimeZone: null, active: true, status: 'active', createdAt: '2026-09-01T00:00:00Z' },
  { id: 'dc2', code: 'FALL20', type: 'percentage', value: '20', minOrderCents: 0, appliesTo: 'entire_store', productIds: [], collectionIds: [], firstOrderOnly: false, minQuantity: 0, maxUses: 100, maxUsesPerCustomer: 2, usesCount: 0, oneUsePerCustomer: false, startsAt: '2026-09-25T16:00:00.000Z', expiresAt: '2026-09-30T06:59:00.000Z', scheduleTimeZone: 'America/Los_Angeles', active: true, status: 'scheduled', createdAt: '2026-09-10T00:00:00Z' },
];
const USES = {
  dc1: [
    { id: 'u3', discountCodeId: 'dc1', customerKey: 'user_b3', customerName: 'Maya Chen', orderId: 'o3', appliedAmountCents: 1275, usedAt: '2026-09-18T19:12:00.000Z' },
    { id: 'u2', discountCodeId: 'dc1', customerKey: 'guest:jordan@example.test', customerName: 'jordan@example.test', orderId: 'o2', appliedAmountCents: 900, usedAt: '2026-09-15T02:40:00.000Z' },
    { id: 'u1', discountCodeId: 'dc1', customerKey: 'user_b1', customerName: 'Sam Rivera', orderId: 'o1', appliedAmountCents: 2100, usedAt: '2026-09-09T17:05:00.000Z' },
  ],
};
const SALES = [
  { id: 's1', name: 'Weekend sale', discountType: 'percent', value: 25, scope: 'store', collection: null, productIds: [], startsAt: '2026-09-18T16:00:00.000Z', endsAt: '2026-09-21T06:59:00.000Z', scheduleTimeZone: 'America/Los_Angeles', active: true, status: 'live' },
  { id: 's2', name: 'Fall sale', discountType: 'percent', value: 15, scope: 'store', collection: null, productIds: [], startsAt: '2026-10-01T00:00:00.000Z', endsAt: null, scheduleTimeZone: null, active: true, status: 'scheduled' },
];

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`), caret: 'hide' });
  console.log(`  ok ${TAG}-${name}`);
}

/** Flags text that is clipped, ellipsised or past the viewport edge. */
async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.overflowX === 'hidden';
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      // Horizontal chip rows scroll by design; only flag text outside any scroller.
      let scroller = el.parentElement;
      while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement;
      const offScreen = !scroller && (r.right > vw + 1 || r.left < -1);
      if (clipped || ellipsis || offScreen) out.push({ text: text.slice(0, 40), clipped, ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}

async function toTop(page, text) {
  await page.getByText(text, { exact: true }).last().evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
}

/**
 * lib/api.ts refuses every request while `?bt_preview=seller` is in the URL
 * (signed-out seller preview), so after the harness signs the demo seller in,
 * the screen is opened with a neutral `bt_preview` value and no cached preview
 * role: the app then talks to the fake API like a real signed-in seller.
 */
async function go(page, activity, origin, path, ready) {
  const target = `${path}?bt_preview=signed-in`;
  await openScreen(page, activity, origin, 'seller', target, {
    beforeNavigate: () => page.evaluate(() => localStorage.removeItem('user_role')),
  });
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await ready().waitFor({ timeout: 12_000 }); break; } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, `${target}?bt_preview=seller`);
    }
  }
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(1200);
}

async function routes(context) {
  // Keep the cached preview role out of localStorage for the whole run (see go()): the app
  // re-saves it after auth sync, which would switch lib/api.ts back to "signed-out preview".
  await context.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'user_role' && document.location.search.includes('bt_preview=signed-in')) return;
      return set.call(this, key, value);
    };
  });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (process.env.F4_DEBUG) console.log('api', request.method(), p);
    if (p === '/api/discount-codes') return json(route, CODES);
    if (p === '/api/discount-codes/collections') return json(route, []);
    const uses = /^\/api\/discount-codes\/([^/]+)\/uses$/.exec(p);
    if (uses) return json(route, USES[uses[1]] ?? []);
    if (p === '/api/sales') return json(route, SALES);
    if (p === '/api/sales/collections') return json(route, ['Outerwear', 'Essentials']);
    return route.fallback();
  });
}

async function discounts(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await routes(context);
  if (process.env.F4_DEBUG) {
    page.on('request', (r) => { if (!r.url().startsWith(origin)) console.log('req', r.method(), r.url().slice(0, 120)); });
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 200)); });
  }
  await go(page, activity, origin, '/discounts', () => page.getByLabel('New discount'));
  await shot(page, '01-discounts-list');
  await overflowCheck(page, 'discounts-list');

  await page.getByLabel('New discount').click();
  await page.waitForTimeout(1200);
  await toTop(page, 'Usage limits');
  await shot(page, '02-discount-usage-limits');
  await overflowCheck(page, 'usage');
  if (MODE === 'after') {
    await page.getByLabel('Limit total uses').click();
    await page.getByLabel('Limit uses per customer').click();
    await page.getByLabel('Uses per customer', { exact: true }).fill('2');
    await toTop(page, 'Usage limits');
    await shot(page, '03-discount-usage-limits-on');
    await overflowCheck(page, 'usage-on');
  }
  await toTop(page, 'Active dates');
  await shot(page, '04-discount-active-dates');
  await overflowCheck(page, 'dates');
  if (MODE === 'after') {
    await page.getByLabel('Set end date').click();
    await toTop(page, 'Active dates');
    await shot(page, '05-discount-active-dates-end');
    await overflowCheck(page, 'dates-end');
    await page.getByLabel(/^Time zone /).click();
    await page.waitForTimeout(1200);
    await page.getByPlaceholder('Search time zones').fill('new york');
    await shot(page, '06-time-zone-sheet');
    await page.getByLabel('Close Time zone').click();
    await page.waitForTimeout(800);
  }
  await page.getByLabel(/^Close New Discount Code/).click();
  await page.waitForTimeout(1200);
  // A code saved before time pickers (date only): dev shows the typed date; after, 12:00 AM on that date.
  await page.getByLabel('Edit WELCOME15').click();
  await page.waitForTimeout(1200);
  await toTop(page, 'Active dates');
  await shot(page, '07-discount-legacy-date-edit');
  await overflowCheck(page, 'legacy-edit');
  await page.getByLabel(/^Close Edit Discount Code/).click();
  await page.waitForTimeout(1200);
  if (MODE === 'after') {
    if (process.env.F4_DEBUG) console.log('url before redemptions', await page.evaluate(() => location.href));
    await page.getByLabel('View redemptions for WELCOME15').click();
    await page.waitForTimeout(1500);
    await shot(page, '08-redemptions');
    await overflowCheck(page, 'redemptions');
  }
  await context.close();
}

async function sales(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await routes(context);
  await go(page, activity, origin, '/sales', () => page.getByLabel('New sale'));
  await shot(page, '09-sales-list');
  await overflowCheck(page, 'sales-list');
  await page.getByLabel('New sale').click();
  await page.waitForTimeout(1200);
  await toTop(page, 'Active dates');
  await shot(page, '10-sale-active-dates');
  await overflowCheck(page, 'sale-dates');
  if (MODE === 'after') {
    await page.getByLabel('Set end date').click();
    await toTop(page, 'Active dates');
    await shot(page, '11-sale-active-dates-end');
    await overflowCheck(page, 'sale-dates-end');
  }
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await discounts(browser, images, server.origin);
    await sales(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
