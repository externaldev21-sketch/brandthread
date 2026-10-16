#!/usr/bin/env node
/**
 * Before/after captures (390x844) for the X-style reframe pilot screens:
 * Activity, Messages and Discover, each populated and empty. Production web
 * export + the store-screenshot fake API, with the buyer conversations and
 * notifications answered by the small fixtures below (test harness only —
 * nothing here ships in the app).
 *
 *   Build first with buildPreviewWeb() from ./store-screenshots/harness.mjs, then:
 *   node scripts/x-reframe-capture.mjs <webBuildDir> <outDir> <prefix>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const [buildDir, outDirArg, prefix = 'shot'] = process.argv.slice(2);
const OUT = path.resolve(outDirArg);
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const initialsOf = (name) => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const actor = (id, name) => ({ actorId: id, actorName: name, actorHandle: `@${id}`, actorInitials: initialsOf(name), actorColor: '#3F3F46' });
const THUMB = `${IMAGE_HOST}/hoodie-bone.jpg`;

const NOTIFICATIONS = [
  { id: 'f1', category: 'social', type: 'new_follower', title: 'Maya Ortiz started following you', body: '', ...actor('u-maya', 'Maya Ortiz'), targetId: 'u-maya', targetType: 'user', mins: 4 },
  { id: 'l1', category: 'social', type: 'post_like', title: 'Leo Park liked your post', body: '', ...actor('u-leo', 'Leo Park'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 9 },
  { id: 'c1', category: 'social', type: 'post_comment', title: 'Ava Brooks commented on your post', body: 'need this in black', ...actor('u-ava', 'Ava Brooks'), targetId: 'p1', targetType: 'post', targetImageUrl: THUMB, mins: 20 },
  { id: 't1', category: 'social', type: 'thread_cash_received', title: 'Sam Cole sent you Thread Cash', body: '$5.00 · tap to view', ...actor('u-sam', 'Sam Cole'), targetId: 'tr1', targetType: 'thread_cash_transfer', mins: 33 },
  { id: 'r1', category: 'social', type: 'repost', title: 'Noor Haddad reposted your post', body: '', ...actor('u-noor', 'Noor Haddad'), targetId: 'p3', targetType: 'post', targetImageUrl: THUMB, mins: 40 },
  { id: 'o1', category: 'orders', type: 'order_shipped', title: 'Your order has shipped!', body: 'Order #1042 is on its way.', targetId: 'ord1', targetType: 'order', mins: 26 * 60 },
  { id: 'f2', category: 'social', type: 'new_follower', title: 'Kai Mendes started following you', body: '', ...actor('u-kai', 'Kai Mendes'), targetId: 'u-kai', targetType: 'user', mins: 3 * 24 * 60 },
].map(({ mins, ...row }) => ({ isRead: mins > 30, isMuted: false, ...row, createdAt: iso(mins * MIN) }));

const PEOPLE = [
  ['Maya Ortiz', 'Is the Ember hoodie true to size?', 4, 1, null],
  ['Northline Studio', 'Your order #NS-1048 ships tomorrow.', 38, 0, '#NS-1048'],
  ['Leo Park', 'haha that fit is unreal', 190, 0, null],
  ['Ava Brooks', 'Sent the link', 1500, 0, null],
  ['Noor Haddad', 'See you at the drop', 2900, 0, null],
];
const conversation = ([name, message, mins, unread, order], i, isRequest = false) => ({
  id: `${isRequest ? 'rq' : 'cv'}_${i + 1}`,
  type: name === 'Northline Studio' ? 'buyer_to_seller_order' : 'buyer_to_buyer',
  participants: [
    { userId: `u_${i + 1}`, name, handle: `@${name.toLowerCase().replace(/\s+/g, '')}`, initials: initialsOf(name), color: '#3F3F46', accountType: name === 'Northline Studio' ? 'seller' : 'buyer' },
    { userId: 'me', name: 'Jordan Reyes', handle: '@jordanreyes', initials: 'JR', color: '#2B2B30', accountType: 'buyer' },
  ],
  lastMessage: message,
  lastMessageTs: DEMO_NOW - mins * MIN,
  unreadCount: unread,
  isFriendshipActive: true,
  isArchived: false,
  isRequest,
  ...(order ? { contextOrderNumber: order } : {}),
  updatedAt: iso(mins * MIN),
});
const CONVERSATIONS = [
  ...PEOPLE.map((p, i) => conversation(p, i)),
  conversation(['Remy Vale', 'hey! where did you get that jacket?', 60, 1, null], 0, true),
];

async function installFixtures(context, state) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test'
    && /^\/api\/(buyer\/notifications(\/.*)?|conversations)$/.test(norm(url.pathname));
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
    if (p === '/api/conversations') return json(state.empty ? [] : CONVERSATIONS);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(state.empty ? [] : NOTIFICATIONS);
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: 'f1' });
    return json({ ok: true });
  });
}

/**
 * The buyer web preview (`?bt_preview=buyer`) deliberately never calls the
 * real conversations API (app/(buyer)/inbox.tsx's loadData), so a production
 * export would always render the empty inbox. For these captures only, the
 * served bundle is patched so the inbox's load step skips that preview
 * branch and reads the fixture conversations above through the normal API
 * path. The app source is untouched.
 */
async function letInboxReadFixtures(context, origin) {
  await context.route((url) => url.origin === origin && url.pathname.endsWith('.js'), async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace(
      /if\(!(\w+)\|\|\(0,\w+\.isBuyerDevPreview\)\(\)\)return\(0,(\w+)\.isPreviewInboxEnabled\)\(\)/,
      'if(!$1)return(0,$2.isPreviewInboxEnabled)()',
    );
    return route.fulfill({ response, body });
  });
}

async function capture(browser, images, origin, { empty }) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await installFixtures(context, { empty });
  await letInboxReadFixtures(context, origin);
  const suffix = empty ? '-empty' : '';
  const settle = async (ms = 1200) => { await waitForQuietNetwork(activity, 600, 10_000); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${prefix}-${name}${suffix}.png`) });

  // A client-side navigation can race the app's own post-sign-in remount and
  // land on Home; retry until the target screen is really on screen.
  const open = async (target, title) => {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', target);
      await settle(1800);
      if (new URL(page.url()).pathname === target
        && await page.getByText(title, { exact: true }).first().isVisible().catch(() => false)) return;
    }
  };

  await open('/activity-center', 'Activity');
  await shot('activity');

  await open('/inbox', 'Messages');
  await shot('messages');
  if (!empty) {
    await page.getByTestId('inbox-tab-requests').click().catch(() => {});
    await settle(800);
    await shot('messages-requests');
  }

  await open('/discover', 'Discover');
  await settle(1200);
  await shot('discover');
  if (!empty) {
    for (const key of ['brands', 'drops']) {
      await page.getByTestId(`discover-filter-${key}`).click().catch(() => {});
      await settle(1200);
      await shot(`discover-${key}`);
    }
  }
  await context.close();
}

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
try {
  await capture(browser, images, origin, { empty: false });
  await capture(browser, images, origin, { empty: true });
} finally {
  await close();
  await browser.close();
}
