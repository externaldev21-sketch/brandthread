#!/usr/bin/env node
/**
 * F7 item 106 — Activity grouped Orders / Social / Money. Screenshots of the
 * Activity chip row (393x852 @2x) with All selected and with the money chip
 * selected, against a fake GET /api/buyer/notifications seeded with social
 * rows, an order update, a payout, a Thread Cash credit and a refund.
 *
 * Usage (after buildPreviewWeb(<dir>)):
 *   node scripts/f7-activity-screenshots.mjs --build-dir <dir> --prefix after --money-chip money
 *   node scripts/f7-activity-screenshots.mjs --build-dir <dir> --prefix before --money-chip thread_cash
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const { values: args } = parseArgs({
  options: {
    'build-dir': { type: 'string', default: DEFAULT_BUILD_DIR },
    prefix: { type: 'string', default: 'after' },
    'money-chip': { type: 'string', default: 'money' },
    out: { type: 'string', default: path.resolve(MOBILE_ROOT, '../../docs/pr-assets/f7/activity') },
  },
});
mkdirSync(args.out, { recursive: true });

const MIN = 60_000;
const iso = (mins) => new Date(DEMO_NOW - mins * MIN).toISOString();
const actor = (id, name) => ({
  actorId: id, actorName: name, actorHandle: `@${id}`,
  actorInitials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
});
const THUMB = `${IMAGE_HOST}/hoodie-bone.jpg`;
const FEED = [
  { id: 'f1', category: 'social', type: 'new_follower', title: 'Fola Reyes started following you', body: '', ...actor('u-fola', 'Fola Reyes'), targetId: 'u-fola', targetType: 'user', cta: 'Follow back', mins: 4 },
  { id: 'm1', category: 'payout', type: 'payout_sent', title: 'Payout sent', body: '$128.40 is on its way to your bank.', targetId: 'po_1', targetType: 'payout', mins: 12 },
  { id: 'l1', category: 'social', type: 'post_like', title: 'Lina Park liked your post', body: '', ...actor('u-lina', 'Lina Park'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 18 },
  { id: 't1', category: 'social', type: 'thread_cash_received', title: 'Tia Moss sent you Thread Cash', body: '$5.00 · tap to view', ...actor('u-tia', 'Tia Moss'), targetId: 'tr1', targetType: 'thread_cash_transfer', mins: 33 },
  { id: 'c1', category: 'social', type: 'post_comment', title: 'Cory Lane commented on your post', body: 'love this fit', ...actor('u-cory', 'Cory Lane'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 47 },
  { id: 'r1', category: 'returns', type: 'return_refunded', title: 'Refund issued', body: '$42.00 is back on your card for order #1038.', targetId: 'ret1', targetType: 'return', mins: 70 },
  { id: 'o1', category: 'orders', type: 'order_shipped', title: 'Your order has shipped', body: 'Order #1042 is on its way.', targetId: 'ord1', targetType: 'order', mins: 26 * 60 },
].map(({ mins, ...row }) => ({ isRead: true, isMuted: false, ...row, createdAt: iso(mins) }));

let feedRows = FEED;

async function installFakeFeed(context) {
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
    const url = new URL(req.url());
    const p = norm(url.pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') {
      return json(Number(url.searchParams.get('offset') ?? 0) > 0 ? [] : feedRows);
    }
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: 'f1' });
    return json({ ok: true });
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(path.resolve(args['build-dir']));
  const role = 'buyer';
  try {
    const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
    const { context, page, activity } = await openContext(browser, { device, role, origin, images });
    await installFakeFeed(context);
    const settle = async (ms = 700) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, '/activity-center');
      try { await page.getByText('Fola Reyes').first().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(1200);
    const labels = await page.locator('[data-testid^="activity-chip-"]').allInnerTexts();
    await page.screenshot({ path: path.join(args.out, `${args.prefix}-chip-all.png`) });
    const text = async () => page.locator('body').innerText();
    const rows = (body) => ['Fola Reyes', 'Payout sent', 'Lina Park', 'Tia Moss', 'Cory Lane', 'Refund issued', 'Order #1042']
      .filter((marker) => body.includes(marker));
    const all = rows(await text());
    await page.getByTestId(`activity-chip-${args['money-chip']}`).click();
    await settle();
    await page.screenshot({ path: path.join(args.out, `${args.prefix}-chip-${args['money-chip'].replace('_', '-')}.png`) });
    const money = rows(await text());
    await page.getByTestId('activity-chip-orders').click();
    await settle();
    const orders = rows(await text());
    console.log(JSON.stringify({ prefix: args.prefix, labels, all, [args['money-chip']]: money, orders }));

    // Nothing money-related loaded: the chip's own empty state, not a blank list.
    feedRows = FEED.filter((row) => row.category === 'social' && row.type !== 'thread_cash_received');
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, '/activity-center');
      try { await page.getByText('Fola Reyes').first().waitFor({ timeout: 15_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
    }
    await settle(900);
    await page.getByTestId(`activity-chip-${args['money-chip']}`).click();
    await settle();
    await page.screenshot({ path: path.join(args.out, `${args.prefix}-chip-${args['money-chip'].replace('_', '-')}-empty.png`) });
    console.log('empty state visible:', await page.getByTestId(`activity-empty-${args['money-chip']}`).isVisible());
    await context.close();
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
