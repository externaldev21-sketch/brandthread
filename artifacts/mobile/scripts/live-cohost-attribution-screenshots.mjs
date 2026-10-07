#!/usr/bin/env node
/**
 * Live co-host + purchase attribution screenshots (390×844 @2x) on the
 * store-screenshots harness: signed-in demo seller/buyer, fake API, and a
 * fake live socket (Playwright routeWebSocket) that sends the same events
 * the server does (`purchase`, `cohosts`).
 *
 *   01 host's co-host invite screen (app/live-cohost.tsx)
 *   02 invitee's accept screen (app/live-cohost-invite.tsx, &demo=1)
 *   03 viewer split stage, host + co-host (app/buyer-live.tsx, &demo=1)
 *   04 host purchase toast on the broadcast (app/seller-live.tsx, &demo=1)
 *   05 live summary analytics (app/live-summary.tsx)
 *   06 seller order detail "From your live" badge (app/order-detail.tsx)
 *
 *   node scripts/live-cohost-attribution-screenshots.mjs [buildDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { IMAGE_HOST, respond } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2] ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/live-cohost-attribution');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const STREAM = '6f1c1f0e-8a52-4a8b-9d6f-2c7e1e3b4a5d';
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

const COHOST = { userId: 'user_rue', agoraUid: 4242, displayName: 'Rue Studio', username: 'ruestudio', avatarUrl: img('portrait-mono') };
const STREAM_ROW = {
  id: STREAM, seller_id: 'user_northline', title: 'Fall drop — first look', status: 'live', channel_name: 'bt_demo',
  agora_uid: 1001, viewer_count: 412, like_count: 1840, brand_name: 'Northline Studio', seller_name: 'Northline Studio',
  avatar_url: img('portrait-rust'), started_at: '2026-09-18T23:05:00Z',
  product_tags: [
    { productId: 'p-overshirt', productName: 'Wool Overshirt', priceCents: 14500 },
    { productId: 'p-denim', productName: 'Raw Denim Jacket', priceCents: 18900 },
  ],
};
const ANALYTICS = {
  stream: { id: STREAM, title: 'Fall drop — first look', status: 'ended', startedAt: '2026-09-18T22:02:00Z', endedAt: '2026-09-18T23:06:40Z', thumbnailUrl: null, durationSeconds: 3880 },
  audience: { peakViewers: 412, uniqueViewers: 1286, comments: 934, likes: 18420 },
  gifts: { count: 23, threadCashCents: 8650 },
  sales: { orders: 37, buyers: 33, units: 44, grossCents: 612400, refundedCents: 12800, revenueCents: 599600, conversionRate: 0.0257 },
  topProducts: [
    { productId: 'p1', name: 'Wool Overshirt', imageUrl: img('jacket-rust'), units: 18, revenueCents: 261000 },
    { productId: 'p2', name: 'Raw Denim Jacket', imageUrl: img('jacket-onyx'), units: 11, revenueCents: 207900 },
    { productId: 'p3', name: 'Merino Crew', imageUrl: img('hoodie-graphite'), units: 15, revenueCents: 143500 },
  ],
  cohosts: [{ userId: 'user_rue', displayName: 'Rue Studio', username: 'ruestudio', avatarUrl: img('portrait-mono'), joinedAt: '2026-09-18T22:20:00Z', orders: 6, revenueCents: 74400 }],
};

function json(route, origin, body) {
  return route.fulfill({
    status: 200,
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

/** API overrides for this feature; everything else falls through to the harness demo API. */
async function routeLive(context, origin, role) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/live/cohost-candidates') {
      return json(route, origin, { sellers: [
        { userId: 'user_rue', username: 'ruestudio', displayName: 'Rue Studio', avatarUrl: img('portrait-mono'), followed: true },
        { userId: 'user_loom', username: 'loomandline', displayName: 'Loom & Line', avatarUrl: img('look-mono'), followed: true },
        { userId: 'user_stone', username: 'stonewashed', displayName: 'Stonewashed Co', avatarUrl: null, followed: false },
        { userId: 'user_north', username: 'northknit', displayName: 'North Knit', avatarUrl: null, followed: false },
      ] });
    }
    if (p === `/api/live/${STREAM}/cohosts`) return json(route, origin, { cohosts: role === 'buyer' || role === 'seller-cohost' ? [COHOST] : [] });
    if (p === `/api/live/${STREAM}/analytics`) return json(route, origin, ANALYTICS);
    if (p === `/api/live/${STREAM}/comments`) {
      return json(route, origin, { comments: [
        { id: 'c3', user_id: 'u3', display_name: 'Maya', message: 'Does the overshirt run big?', created_at: '2026-09-18T23:20:00Z' },
        { id: 'c2', user_id: 'u2', display_name: 'Theo', message: 'That denim 🔥', created_at: '2026-09-18T23:19:00Z' },
        { id: 'c1', user_id: 'u1', display_name: 'Ana', message: 'Hi from Portland', created_at: '2026-09-18T23:18:00Z' },
      ] });
    }
    if (p === `/api/live/${STREAM}/join`) return json(route, origin, { channelName: 'bt_demo', agoraUid: 77, agoraAppId: '', token: '' });
    if (p === `/api/live/${STREAM}`) return json(route, origin, { stream: STREAM_ROW });
    if (/^\/api\/orders\/[^/]+$/.test(p) && request.method() === 'GET') {
      const body = respond({ method: 'GET', path: p, query: new URL(request.url()).searchParams, role: 'seller' });
      return json(route, origin, { ...body, sourceLive: { streamId: STREAM, title: 'Fall drop — first look', startedAt: '2026-09-16T23:05:00Z' } });
    }
    return route.fallback();
  });
}

/** Fake live socket: answers the app's connection and sends server events. */
async function fakeSocket(page, events) {
  await page.routeWebSocket(/\/ws\/live/, (ws) => {
    setTimeout(() => { for (const e of events) ws.send(JSON.stringify(e)); }, 600);
    ws.onMessage(() => {});
  });
}

async function shot(page, activity, name) {
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function capture(browser, images, origin, { role, target, name, socket, waitText, apiRole }) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  page.setDefaultNavigationTimeout(240_000);
  await routeLive(context, origin, apiRole ?? role);
  if (socket) await fakeSocket(page, socket);
  await openScreen(page, activity, origin, role, target);
  // The first client-side navigation can land before the app settles; re-push it.
  const url = `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`;
  let seen = false;
  for (let attempt = 0; attempt < 6 && !seen; attempt++) {
    try {
      await page.getByText(waitText).first().waitFor({ timeout: 10_000 });
      // The auth gate can still redirect once after the first paint: make sure we stayed.
      await page.waitForTimeout(3000);
      seen = await page.getByText(waitText).first().isVisible();
      if (!seen) throw new Error('navigated away');
    } catch {
      await page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
    }
  }
  if (!seen) {
    console.log(`  ! ${name}: "${waitText}" not visible at ${page.url()}`);
    process.exitCode = 1;
  }
  await shot(page, activity, name);
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
    await capture(browser, images, server.origin, {
      role: 'seller', target: `/live-cohost?streamId=${STREAM}`, name: '01-host-cohost-invite', waitText: 'Loom & Line',
    });
    await capture(browser, images, server.origin, {
      role: 'seller', target: '/live-cohost-invite?demo=1', name: '02-invitee-accept', waitText: 'Atelier Nord',
    });
    await capture(browser, images, server.origin, {
      role: 'buyer', target: `/buyer-live?streamId=${STREAM}&demo=1`, name: '03-viewer-split-stage', waitText: 'Rue Studio',
      socket: [{ type: 'cohosts', cohosts: [COHOST] }, { type: 'viewerCount', count: 412 }],
    });
    await capture(browser, images, server.origin, {
      role: 'seller', target: `/seller-live?streamId=${STREAM}&demo=1&title=Fall%20drop`, name: '04-host-purchase-toast', waitText: 'bought',
      socket: [
        { type: 'viewerCount', count: 412 },
        { type: 'purchase', purchase: { id: 'o1', buyerFirstName: 'Jordan', productName: 'Wool Overshirt', units: 1, sellerId: 'user_northline', at: '2026-09-18T23:30:00Z' } },
      ],
    });
    await capture(browser, images, server.origin, {
      role: 'seller', target: `/live-summary?streamId=${STREAM}`, name: '05-live-summary', waitText: 'Live ended',
    });
    await capture(browser, images, server.origin, {
      role: 'seller', target: '/order-detail?id=so-1', name: '06-order-detail-live-badge', waitText: 'From your live',
    });
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
