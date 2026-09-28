#!/usr/bin/env node
/**
 * One-off live verification for order-lifecycle Activity rows (item 79) —
 * not part of the store screenshot pipeline. Production web export + a fake
 * API answering the real GET /api/buyer/notifications with the rows the
 * backend publishes (see lib/orderNotifications.ts and routes/orders.ts),
 * then checks the Orders chip and where tapping each row goes.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-order-notifications-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-order-notifications'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const row = (id, type, title, body, targetType, targetId, mins, extra = {}) => ({
  id, category: extra.category ?? 'orders', type, title, body, isRead: true, isMuted: false,
  targetId, targetType, createdAt: iso(mins * MIN), ...extra,
});

// Exactly what the backend publishes for a buyer. Older rows use
// targetType "order" (routes/orders.ts); new ones use "buyer_order".
const BUYER_FEED = [
  row('b-conf', 'order_confirmed', 'Order confirmed', "Order #BT-00042 for $89.00 is confirmed. We'll let you know when it ships.", 'buyer_order', 'ord-42', 3, { targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg` }),
  row('b-ship', 'order_shipped', 'Your order has shipped! 🚚', 'Order #BT-00038 is on its way via USPS — tracking: 9400 1000 0000', 'order', 'ord-38', 45),
  row('b-ofd', 'order_out_for_delivery', 'Your package is arriving today 🚚', 'Order #BT-00035 is out for delivery today.', 'order', 'ord-35', 3 * 60),
  row('b-del', 'order_delivered', 'Your order was delivered! 📦', 'Order #BT-00031 has been delivered.', 'order', 'ord-31', 26 * 60),
  row('b-cxl', 'order_cancelled', 'Order cancelled', 'You cancelled order #BT-00029. Your refund of $54.00 is on its way.', 'buyer_order', 'ord-29', 28 * 60),
  row('b-ret', 'return_refunded', 'Return refunded', 'Your refund for order #BT-00020 has been issued.', 'return', 'ret-20', 3 * 24 * 60, { category: 'returns', cta: 'View return' }),
  row('b-like', 'post_like', 'Priya Shah liked your post', '', 'post', 'post-1', 10, { category: 'social', actorId: 'u-priya', actorName: 'Priya Shah', actorInitials: 'PS', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg` }),
];
// The seller's side of the same lifecycle.
const SELLER_FEED = [
  row('s-new', 'new_order_received', 'New order! 🛍️', 'Order #BT-00042 for $89.00 is ready to review.', 'order', 'ord-42', 3, { targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg` }),
  row('s-cxl', 'order_cancelled_by_buyer', 'Jordan Reyes cancelled order #BT-00029', 'The items were restocked. $54.00 was refunded.', 'order', 'ord-29', 28 * 60, { actorId: 'u-jordan', actorName: 'Jordan Reyes', actorInitials: 'JR', actorColor: '#3F3F46' }),
  row('s-like', 'post_like', 'Priya Shah liked your post', '', 'post', 'post-1', 10, { category: 'social', actorId: 'u-priya', actorName: 'Priya Shah', actorInitials: 'PS', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg` }),
];

async function installFakeApi(context, feed) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test' && /^\/api\/buyer\/notifications(\/.*)?$/.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = norm(new URL(req.url()).pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(feed);
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: feed[0].id });
    return json({ ok: true });
  });
}

async function run(browser, images, origin, role) {
  const feed = role === 'seller' ? SELLER_FEED : BUYER_FEED;
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await installFakeApi(context, feed);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const settle = async (ms = 500) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const ordersChip = page.getByRole('button', { name: 'Orders', exact: true }).first();
  const openOrders = async () => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, '/activity-center');
      try { await ordersChip.waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(800);
    await ordersChip.click();
    await settle();
  };
  const results = { taps: {} };

  await openOrders();
  await shot('01-orders-chip');
  const body = await page.locator('body').innerText();
  results.ordersChipShows = feed.filter((r) => body.includes(r.title.replace(/ [🚚📦🛍️]+$/u, ''))).map((r) => r.type);

  // Where each order row opens.
  for (const r of feed.filter((x) => x.category !== 'social')) {
    await openOrders();
    const label = r.title.replace(/ [🚚📦🛍️]+$/u, '');
    await page.locator(`[aria-label*="${label}"]`).first().click();
    await settle(300);
    const url = new URL(page.url());
    results.taps[r.type] = `${url.pathname}${url.search.replace(/[?&]bt_preview=[^&]*/, '')}`;
  }

  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const results = await run(browser, images, origin, role);
      console.log(`\n[${role}]`, JSON.stringify(results, null, 2));
    }
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
