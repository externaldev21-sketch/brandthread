#!/usr/bin/env node
/**
 * One-off live verification for the Activity filter chips (item 78) — not
 * part of the store screenshot pipeline. Production web export + a fake API
 * answering the real GET /api/buyer/notifications with one row per category,
 * then taps every chip and records which rows remain.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-chips-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-filter-chips'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const actor = (id, name) => ({
  actorId: id, actorName: name, actorHandle: `@${id}`,
  actorInitials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
});
const THUMB = `${IMAGE_HOST}/hoodie-bone.jpg`;
// One row per category; the actor name says which chip it belongs to.
const FULL_FEED = [
  { id: 'f1', category: 'social', type: 'new_follower', title: 'Fola Follower started following you', body: '', ...actor('u-fola', 'Fola Follower'), targetId: 'u-fola', targetType: 'user', cta: 'Follow back', mins: 5 },
  { id: 'l1', category: 'social', type: 'post_like', title: 'Lina Liker liked your post', body: '', ...actor('u-lina', 'Lina Liker'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 9 },
  { id: 'l2', category: 'social', type: 'story_like', title: 'Stella Story liked your story', body: '', ...actor('u-stella', 'Stella Story'), targetId: 's1', targetType: 'story', targetImageUrl: THUMB, mins: 14 },
  { id: 'c1', category: 'social', type: 'post_comment', title: 'Cory Commenter commented on your post', body: 'love this fit', ...actor('u-cory', 'Cory Commenter'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 20 },
  { id: 'c2', category: 'social', type: 'mention', title: 'Mo Mention mentioned you in a comment', body: '@you check this', ...actor('u-mo', 'Mo Mention'), targetId: 'p2', targetType: 'post', targetImageUrl: THUMB, mins: 26 },
  { id: 't1', category: 'social', type: 'thread_cash_received', title: 'Tia Cash sent you Thread Cash', body: '$5.00 · tap to view', ...actor('u-tia', 'Tia Cash'), targetId: 'tr1', targetType: 'thread_cash_transfer', mins: 33 },
  { id: 'r1', category: 'social', type: 'repost', title: 'Remy Repost reposted your post', body: '', ...actor('u-remy', 'Remy Repost'), targetId: 'p3', targetType: 'post', targetImageUrl: THUMB, mins: 40 },
  { id: 'o1', category: 'orders', type: 'order_shipped', title: 'Your order has shipped!', body: 'Order #1042 is on its way.', targetId: 'ord1', targetType: 'order', mins: 50 },
  { id: 'o2', category: 'orders', type: 'order_delivered', title: 'Your order was delivered!', body: 'Order #1038 has been delivered.', targetId: 'ord2', targetType: 'order', mins: 26 * 60 },
].map(({ mins, ...row }) => ({ isRead: true, isMuted: false, ...row, createdAt: iso(mins * MIN) }));

const MARKERS = {
  follows: 'Fola Follower', likePost: 'Lina Liker', likeStory: 'Stella Story', comment: 'Cory Commenter',
  mention: 'Mo Mention', threadCash: 'Tia Cash', repost: 'Remy Repost', shipped: 'Order #1042', delivered: 'Order #1038',
};
const CHIPS = ['all', 'follows', 'likes', 'comments', 'orders', 'thread_cash'];

async function installFakeApi(context, getFeed) {
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
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(getFeed());
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: 'f1' });
    return json({ ok: true });
  });
}

async function run(browser, images, origin, role) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  let feed = FULL_FEED;
  await installFakeApi(context, () => feed);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const settle = async (ms = 500) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const visible = async () => {
    const text = await page.locator('body').innerText();
    return Object.entries(MARKERS).filter(([, marker]) => text.includes(marker)).map(([key]) => key);
  };
  const openActivity = async (waitFor) => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, '/activity-center');
      try { await waitFor.first().waitFor({ timeout: 15_000 }); return; } catch (error) { if (attempt >= 3) throw error; }
    }
  };
  const results = {};

  await openActivity(page.getByText('Fola Follower'));
  await settle(900);
  results.chipLabels = await page.locator('[data-testid^="activity-chip-"]').allInnerTexts();
  for (const [index, chip] of CHIPS.entries()) {
    await page.getByTestId(`activity-chip-${chip}`).click();
    await settle();
    await shot(`${String(index + 1).padStart(2, '0')}-chip-${chip}`);
    results[chip] = await visible();
  }

  // A chip with nothing in it shows a specific empty state, not a blank list.
  feed = FULL_FEED.filter((row) => row.type !== 'thread_cash_received' && row.category !== 'orders');
  await openActivity(page.getByText('Fola Follower'));
  await settle(600);
  await page.getByTestId('activity-chip-thread_cash').click();
  await settle();
  await shot('07-thread-cash-empty');
  results.threadCashEmpty = await page.getByTestId('activity-empty-thread_cash').isVisible();
  await page.getByTestId('activity-chip-orders').click();
  await settle();
  await shot('08-orders-empty');
  results.ordersEmpty = await page.getByTestId('activity-empty-orders').isVisible();

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
      console.log(`\n[${role}]`, JSON.stringify(results));
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
