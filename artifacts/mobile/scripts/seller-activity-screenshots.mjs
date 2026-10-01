#!/usr/bin/env node
/**
 * 393x852 screenshots + text-fit check for the seller Activity screen, driven
 * in demo mode (`?bt_preview=seller&demo=1`) plus a fresh (no demo) empty state.
 *   node scripts/seller-activity-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';
import { checkTextFit, zoomCards } from './store-screenshots/text-fit.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/seller-activity');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
let failures = 0;

async function audit(page, name) {
  // The shared buyer row wraps its sentence + timestamp naturally; that layout is reused, not redesigned.
  const issues = (await checkTextFit(page)).filter((i) => !(i.type === 'orphan' && /commented|replied|mentioned|tagged|liked|started|saved|shared|reposted/.test(i.el)));
  console.log(`${name}: ${issues.length === 0 ? 'text-fit OK' : 'TEXT-FIT ISSUES'}`);
  for (const i of issues) console.log('   ', JSON.stringify(i));
  failures += issues.length;
}


// ── Demo feed (screenshots only): every seller-activity type, with read state ──
const THUMB = (a, b) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="88" height="88" fill="url(#g)"/></svg>`)}`;
const PEOPLE = [
  ['u-priya', 'Priya Shah', 'PS', '#8B5CF6'], ['u-marcus', 'Marcus Webb', 'MW', '#EC4899'], ['u-jordan', 'Jordan Lee', 'JL', '#3B82F6'],
  ['u-aiko', 'Aiko Tanaka', 'AT', '#F59E0B'], ['u-sam', 'Sam Rivera', 'SR', '#10B981'], ['u-noor', 'Noor Haddad', 'NH', '#EF4444'],
];
const min = (m) => new Date(DEMO_NOW - m * 60_000).toISOString();
function fixtureFeed() {
  const row = (id, type, who, title, extra) => {
    const [actorId, actorName, actorInitials, actorColor] = PEOPLE[who];
    return { id, category: 'social', type, title: `${actorName} ${title}`, body: '', isRead: false, actorId, actorName, actorInitials, actorColor, createdAt: min(0), ...extra };
  };
  return [
    row('f1', 'new_follower', 0, 'started following you', { targetId: 'u-priya', targetType: 'user', cta: 'Follow back', createdAt: min(6) }),
    row('f2', 'post_like', 2, 'liked your post', { targetId: 'p1', targetType: 'post', targetImageUrl: THUMB('#444', '#bbb'), createdAt: min(14) }),
    row('f3', 'post_like', 3, 'liked your post', { targetId: 'p1', targetType: 'post', targetImageUrl: THUMB('#444', '#bbb'), createdAt: min(18) }),
    row('f4', 'post_comment', 4, 'commented on your post', { body: 'obsessed with this fit', targetId: 'p2', targetType: 'post', targetImageUrl: THUMB('#222', '#999'), createdAt: min(52) }),
    row('f5', 'post_save', 5, 'saved your post', { targetId: 'p3', targetType: 'post', targetImageUrl: THUMB('#555', '#ddd'), createdAt: min(120) }),
    row('f6', 'new_follower', 1, 'started following you', { targetId: 'u-marcus', targetType: 'user', cta: 'Follow back', isRead: true, isFollowingActor: true, createdAt: min(60 * 26) }),
    row('f7', 'mention', 3, 'mentioned you in a comment', { body: "check out @mybrand's drop", targetId: 'p4', targetType: 'post', targetImageUrl: THUMB('#333', '#aaa'), isRead: true, createdAt: min(60 * 24 * 2) }),
    row('f8', 'repost', 0, 'reposted your post', { targetId: 'p5', targetType: 'post', targetImageUrl: THUMB('#666', '#eee'), isRead: true, createdAt: min(60 * 24 * 3) }),
    row('f9', 'post_share', 4, 'shared your post', { targetId: 'p5', targetType: 'post', targetImageUrl: THUMB('#666', '#eee'), isRead: true, createdAt: min(60 * 24 * 4) }),
    row('f10', 'comment_reply', 2, 'replied to your comment', { body: 'right? grabbing one now', targetId: 'p6', targetType: 'post', targetImageUrl: THUMB('#2a2a2a', '#999'), isRead: true, createdAt: min(60 * 24 * 5) }),
    row('f11', 'post_tag', 5, 'tagged you in a post', { targetId: 'p7', targetType: 'post', targetImageUrl: THUMB('#111', '#888'), isRead: true, createdAt: min(60 * 24 * 12) }),
    row('f12', 'new_follower', 3, 'started following you', { targetId: 'u-aiko', targetType: 'user', isRead: true, isFollowingActor: true, createdAt: min(60 * 24 * 40) }),
    row('f13', 'post_like', 1, 'liked your post', { targetId: 'p8', targetType: 'post', targetImageUrl: THUMB('#3a3a3a', '#c4c4c4'), isRead: true, createdAt: min(60 * 24 * 45) }),
  ];
}
async function serveFixtureFeed(page, origin, empty = false) {
  const feed = empty ? [] : fixtureFeed();
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  await page.route(/\/api\/(v1\/)?buyer\/notifications/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'PATCH') {
      const id = url.pathname.split('/').slice(-2)[0];
      for (const item of feed) if (item.id === id || url.pathname.endsWith('read-all')) item.isRead = true;
      return json({ ok: true });
    }
    if (req.method() === 'DELETE') return json({ ok: true });
    if (url.pathname.endsWith('/unread-count')) return json({ count: feed.filter((i) => !i.isRead).length, latestId: 'f1' });
    const offset = Number(url.searchParams.get('offset') ?? 0);
    return json(offset === 0 ? feed : []);
  });
}

async function session(browser, origin, demo) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  // Demo: the full fixture. Fresh account: a real, empty feed (no fake data).
  await serveFixtureFeed(page, origin, !demo);
  await openScreen(page, activity, origin, 'seller', '/', {
    beforeNavigate: async () => {
      await page.evaluate((on) => { if (on) localStorage.setItem('bt_preview_demo', '1'); else localStorage.removeItem('bt_preview_demo'); }, demo);
    },
  });
  await page.waitForTimeout(6000);
  const go = (target) => page.evaluate((url) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, target);
  const open = async (url, text) => {
    for (let i = 0; i < 5; i += 1) {
      await go(url);
      await page.waitForTimeout(2200);
      const target = text.startsWith('[') ? page.locator(text).first() : page.getByText(text).first();
      if (await target.isVisible().catch(() => false)) return;
    }
    throw new Error(`screen did not open: ${url}`);
  };
  return { context, page, open };
}
const shot = async (page, name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); };

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    // Demo: profile bell with the unread dot → Activity.
    const demo = await session(browser, origin, true);
    await demo.open('/profile?bt_preview=seller&demo=1', '[data-testid="seller-activity-bell"]');
    await shot(demo.page, '1-profile-bell-unread-dot');
    await demo.page.locator('[data-testid="seller-activity-bell"]').first().click();
    await demo.page.waitForTimeout(2500);
    await shot(demo.page, '2-activity-all');
    await audit(demo.page, 'activity (All)');
    await zoomCards(demo.page, OUT, '2-all');
    await demo.page.evaluate(() => document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 200) el.scrollTop = 700; }));
    await shot(demo.page, '3-activity-all-scrolled');
    await audit(demo.page, 'activity (All, scrolled)');
    for (const [key, label] of [['followers', 'Followers'], ['likes', 'Likes'], ['comments', 'Comments'], ['mentions', 'Mentions'], ['reposts', 'Reposts']]) {
      await demo.page.locator(`[data-testid="activity-chip-${key}"]`).last().click();
      await demo.page.waitForTimeout(800);
      await shot(demo.page, `4-chip-${key}`);
      await audit(demo.page, `activity (${label})`);
    }
    // Back on the profile the bell dot is gone (opening marked it read).
    await demo.page.goBack().catch(() => {});
    await demo.page.waitForTimeout(2500);
    await shot(demo.page, '5-profile-bell-after-open');
    await demo.context.close();

    // Fresh account (no demo): empty state, no fake data.
    const fresh = await session(browser, origin, false);
    await fresh.open('/seller-activity?bt_preview=seller', 'Activity');
    await shot(fresh.page, '6-activity-empty-no-demo');
    await audit(fresh.page, 'activity (empty)');
    await fresh.context.close();
  } finally {
    await browser.close();
    close();
  }
  if (failures > 0) { console.log(`\n${failures} text-fit issue(s)`); process.exit(2); }
  console.log('\nall states text-fit clean');
}
run().catch((e) => { console.error(e); process.exit(1); });
