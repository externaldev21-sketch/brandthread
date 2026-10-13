#!/usr/bin/env node
/**
 * F4 seller money tools 2 — Customers (lifetime spend, Top 20) and the
 * follower push composer's audience picker (Followers / Past buyers), live on
 * the store-screenshots harness (fake API, signed-in demo seller).
 *
 *   node scripts/f4-customers-screenshots.mjs <buildDir> <outDir> <before|after> [width] [height]
 *
 * Defaults to 393x852. Before/after comparisons are captured at 390x844.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 393), height: Number(process.argv[6] ?? 852) };
const TAG = `${VIEWPORT.width}x${VIEWPORT.height}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ago = (days) => new Date(DEMO_NOW - days * 86_400_000).toISOString();
const C = (id, name, email, orderCount, totalSpentCents, lastDays, extra = {}) => ({
  id, kind: id.startsWith('buyer_') ? 'account' : id.startsWith('guest_') ? 'guest' : 'manual',
  name, email, handle: null, phone: null, tags: [], notes: null, orderCount, totalSpentCents,
  lastOrderAt: orderCount ? ago(lastDays) : null, firstOrderAt: orderCount ? ago(lastDays + 40) : null,
  createdAt: ago(lastDays + 40), customerRowId: null, ...extra,
});
const CUSTOMERS = [
  C('buyer_u1', 'Maya Chen', '', 6, 84_250, 1, { handle: '@mayachen', tags: ['VIP'] }),
  C('guest_a', 'Jordan Ellis', 'jordan.ellis@gmail.com', 1, 6_800, 2),
  C('buyer_u2', 'Sam Okafor', '', 3, 31_400, 4, { handle: '@samokafor' }),
  C('guest_b', 'Priya Nair', 'priya.n@outlook.com', 2, 15_900, 6),
  C('buyer_u3', 'Leo Martins', '', 9, 126_500, 8, { handle: '@leomartins', tags: ['Wholesale'] }),
  C('guest_c', 'Ava Brooks', 'ava.brooks@icloud.com', 1, 4_500, 11),
  C('buyer_u4', 'Noah Kim', '', 2, 22_000, 15, { handle: '@noahkim' }),
  C('guest_d', 'Zoe Harper', 'zoe@harperstudio.co', 4, 47_300, 21),
  C('c-manual-1', 'Riley Adams', 'riley@adams.com', 0, 0, 0, { tags: ['Pop-up'], createdAt: ago(30) }),
];
const ORDERS = [
  { id: 'o1', orderNumber: 'BT-00412', status: 'shipped', totalCents: 18_900, createdAt: ago(8), carrier: 'USPS', trackingNumber: '9400 1000 0000 0000 0000 00' },
  { id: 'o2', orderNumber: 'BT-00377', status: 'delivered', totalCents: 24_500, createdAt: ago(30) },
  { id: 'o3', orderNumber: 'BT-00301', status: 'delivered', totalCents: 12_000, createdAt: ago(55) },
  { id: 'o4', orderNumber: 'BT-00288', status: 'cancelled', totalCents: 9_000, createdAt: ago(61) },
];

function pushStatus({ pastBuyersLimited = false } = {}) {
  return {
    canSendNow: true, nextSendAt: null,
    limits: { titleMax: 50, bodyMax: 178, pastBuyerRecipientCap: 2000 },
    audience: { followers: 1840, recipients: 1612 },
    pastBuyers: {
      canSendNow: !pastBuyersLimited,
      nextSendAt: pastBuyersLimited ? new Date(DEMO_NOW + 4 * 86_400_000).toISOString() : null,
      audience: { buyers: 412, eligible: 368, recipients: 368, cap: 2000 },
    },
    history: [
      { id: '6c1f7a52-0000-4000-8000-000000000001', audience: 'past_buyers', title: 'Thank you', body: '15% off your next order.', status: 'sent', recipientCount: 352, sentCount: 352, skippedCount: 40, createdAt: ago(12), completedAt: ago(12) },
      { id: '6c1f7a52-0000-4000-8000-000000000002', audience: 'followers', title: 'Drop Friday', body: 'Doors open at 6pm.', status: 'sent', recipientCount: 1590, sentCount: 1590, skippedCount: 230, createdAt: ago(3), completedAt: ago(3) },
    ],
  };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ok ${name}`);
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
      const offScreen = r.right > vw + 1 || r.left < -1;
      if (clipped || offScreen) out.push({ text: text.slice(0, 40), clipped, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}

async function waitText(page, target, text) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 12_000 }); return; } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=seller`);
    }
  }
}

async function seller(browser, images, origin, opts = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/customers') {
      // dev reads only the stored `customers` table: shown here as if every
      // person had been typed in by hand (checkout never fills it), so the
      // rows can be compared; spend/order counts on those rows stay 0.
      if (MODE === 'before') {
        return json(route, CUSTOMERS.map((c) => ({
          ...c, email: c.email || `${c.name.split(' ')[0].toLowerCase()}@example.com`, totalSpentCents: 0, orderCount: 0,
        })));
      }
      return json(route, CUSTOMERS);
    }
    const m = p.match(/^\/api\/customers\/([^/]+)(\/orders)?$/);
    if (m) {
      const c = CUSTOMERS.find((x) => x.id === decodeURIComponent(m[1]));
      if (!c) return json(route, { error: 'Not found' }, 404);
      return json(route, m[2] ? ORDERS : { ...c, recentOrders: ORDERS });
    }
    if (p === '/api/seller/push-broadcasts' && request.method() === 'GET') return json(route, pushStatus(opts));
    if (p === '/api/seller/push-broadcasts/preview') {
      const body = JSON.parse(request.postData() || '{}');
      const pb = body.audience === 'past_buyers';
      return json(route, {
        notification: { title: body.title, body: body.body }, deeplinkType: null, deeplinkId: null,
        audienceType: pb ? 'past_buyers' : 'followers',
        audience: pb ? { buyers: 412, eligible: 368, recipients: 368, cap: 2000 } : { followers: 1840, recipients: 1612 },
        canSendNow: true, nextSendAt: null,
      });
    }
    return route.fallback();
  });
  return { context, page, activity };
}

async function customers(browser, images, origin) {
  const { context, page, activity } = await seller(browser, images, origin);
  await openScreen(page, activity, origin, 'seller', '/customers');
  await waitText(page, '/customers', 'Leo Martins');
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, `${MODE}-${TAG}-01-customers`);
  await overflowCheck(page, 'customers');
  if (MODE === 'after') {
    await page.getByRole('tab', { name: 'Top 20' }).click();
    await page.waitForTimeout(700);
    await shot(page, `${MODE}-${TAG}-02-customers-top-20`);
    await overflowCheck(page, 'top-20');
    await page.getByText('Leo Martins', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    await waitForQuietNetwork(activity, 900, 10_000);
    await shot(page, `${MODE}-${TAG}-03-customer-detail`);
    await overflowCheck(page, 'detail');
  }
  await context.close();
}

async function push(browser, images, origin) {
  const { context, page, activity } = await seller(browser, images, origin);
  await openScreen(page, activity, origin, 'seller', '/seller-push-broadcast');
  await waitText(page, '/seller-push-broadcast', 'Title');
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, `${MODE}-${TAG}-04-push-composer`);
  await overflowCheck(page, 'push-followers');
  if (MODE === 'after') {
    await page.getByRole('radio', { name: /Past buyers/ }).click();
    await page.waitForTimeout(500);
    await page.getByLabel('Push title').fill('Thank you');
    await page.getByLabel('Push message').fill('15% off your next order with code THANKS15.');
    await page.waitForTimeout(300);
    await shot(page, `${MODE}-${TAG}-05-push-past-buyers`);
    await overflowCheck(page, 'push-past-buyers');
    await page.getByText('Review', { exact: true }).last().click();
    await page.waitForTimeout(1200);
    await shot(page, `${MODE}-${TAG}-06-push-past-buyers-review`);
    await overflowCheck(page, 'push-review');
  }
  await context.close();
  if (MODE === 'after') {
    const s = await seller(browser, images, origin, { pastBuyersLimited: true });
    await openScreen(s.page, s.activity, origin, 'seller', '/seller-push-broadcast');
    await waitText(s.page, '/seller-push-broadcast', 'Title');
    await s.page.getByRole('radio', { name: /Past buyers/ }).click();
    await s.page.waitForTimeout(500);
    await shot(s.page, `${MODE}-${TAG}-07-push-past-buyers-limited`);
    await s.context.close();
  }
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await customers(browser, images, server.origin);
    await push(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
