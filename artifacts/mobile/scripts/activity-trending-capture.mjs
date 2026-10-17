#!/usr/bin/env node
/**
 * Before/after captures (390x844) for Activity's inline "Trending brands"
 * section and the audit polish items #52-#54. Production web export + the
 * store-screenshot fake API, with notifications, trending brands and the
 * follow call answered by the small fixtures below (test harness only —
 * nothing here ships in the app).
 *
 *   Build first with buildPreviewWeb() from ./store-screenshots/harness.mjs, then:
 *   node scripts/activity-trending-capture.mjs <webBuildDir> <outDir> <prefix>
 *
 * Seller: header only — the signed-out seller preview blocks service calls.
 *
 * Writes <prefix>-*.png plus <prefix>-results.json (back button present,
 * header geometry, filter labels, section order, follow calls).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
  { id: 'r1', category: 'social', type: 'repost', title: 'Noor Haddad reposted your post', body: '', ...actor('u-noor', 'Noor Haddad'), targetId: 'p3', targetType: 'post', targetImageUrl: THUMB, mins: 40 },
  { id: 'f2', category: 'social', type: 'new_follower', title: 'Kai Mendes started following you', body: '', ...actor('u-kai', 'Kai Mendes'), targetId: 'u-kai', targetType: 'user', mins: 3 * 24 * 60 },
].map(({ mins, ...row }) => ({ isRead: true, isMuted: false, ...row, createdAt: iso(mins * MIN) }));

const brand = (id, name, followerCount, verified, image) => ({
  id, sellerId: id, name, brandType: null, logoUrl: null,
  coverImageUrl: image ? `${IMAGE_HOST}/${image}.jpg` : null, followerCount, verified,
});
const TRENDING = [
  brand('seller_northline', 'Northline Studio', 12400, true, 'portrait-rust'),
  brand('seller_vale', 'Vale Atelier', 3810, true, 'look-mono'),
  brand('seller_ember', 'Ember & Oak', 1290, false, 'hoodie-ember'),
  brand('seller_moss', 'Moss Supply', 864, false, 'hoodie-moss'),
  brand('seller_graphite', 'Graphite Goods', 402, true, 'jacket-onyx'),
  brand('seller_rust', 'Rust Runner', 95, false, 'runner-rust'),
];

async function installFixtures(context, state) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const owns = (url) => url.origin === 'https://api.brandthread.test'
    && /^\/api\/(buyer\/notifications(\/.*)?|public\/trending\/brands|social\/follow(\/.*)?)$/.test(norm(url.pathname));
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
    if (p === '/api/buyer/notifications' && req.method() === 'GET') { state.notificationGets += 1; return json(state.notifications); }
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: state.notifications[0]?.id ?? null });
    if (p === '/api/public/trending/brands') {
      state.trendingQueries.push(url.search);
      return json({ windowDays: 7, brands: state.trending });
    }
    if (p.startsWith('/api/social/follow')) {
      state.followCalls.push(`${req.method()} ${p} ${req.postData() ?? ''}`.trim());
      return json({ ok: true, isFollowing: req.method() === 'POST', followersCount: 1 });
    }
    return json({ ok: true });
  });
}

/** Header geometry: back button, title box, and where the list starts (first hairline/chip row bottom). */
async function headerFacts(page) {
  return page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) }; };
    const title = document.querySelector('[data-testid="screen-header-title"]');
    const header = document.querySelector('[data-testid="screen-header"]');
    const chips = document.querySelector('[data-testid="activity-chip-all"]');
    const back = document.querySelector('[data-testid="screen-header-back"]');
    const visible = (el) => !!el && el.getBoundingClientRect().width > 0;
    return {
      backButton: visible(back),
      title: box(title),
      header: box(header),
      chipAll: box(chips),
      chipLabels: [...document.querySelectorAll('[data-testid^="activity-chip-"]')].map((el) => el.textContent?.trim()),
    };
  });
}

/** Vertical order of the last activity row vs the Trending brands header. */
async function orderFacts(page) {
  return page.evaluate(() => {
    const textTop = (needle) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n; while ((n = walker.nextNode())) {
        if (n.textContent?.trim() === needle || n.textContent?.includes(needle)) {
          const r = n.parentElement.getBoundingClientRect(); if (r.height > 0) return Math.round(r.top + window.scrollY);
        }
      }
      return null;
    };
    const section = document.querySelector('[data-testid="activity-trending-brands"]');
    return {
      trendingTop: section ? Math.round(section.getBoundingClientRect().top) : null,
      trendingRows: document.querySelectorAll('[data-testid^="activity-trending-row-"]').length,
      noActivityLine: textTop('No activity yet'),
      findPeopleVisible: document.body.innerText.includes('Find people to follow'),
    };
  });
}

async function run(browser, images, origin, role, target, label) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const state = { notifications: [], trending: TRENDING, followCalls: [], trendingQueries: [], notificationGets: 0 };
  await installFixtures(context, state);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${prefix}-${label}-${name}.png`) });
  const settle = async (ms = 700) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const open = async () => {
    for (let attempt = 1; ; attempt += 1) {
      // 'tab' = the buyer's Activity slot in the floating tab bar, tapped like a
      // user would; anything else is a route pushed onto the stack.
      await openScreen(page, activity, origin, role, target === 'tab' ? '/' : target);
      try {
        if (target === 'tab') await page.getByTestId('buyer-tab-activity').click({ timeout: 15_000 });
        await page.locator('[data-testid="activity-chip-all"]').first().waitFor({ timeout: 15_000 });
        return;
      } catch (e) { if (attempt >= 3) throw e; }
    }
  };
  const result = {};

  // 1. No activity.
  await open();
  await settle(1200);
  await shot('01-empty');
  result.empty = { header: await headerFacts(page), order: await orderFacts(page) };

  // The signed-out seller preview blocks service calls (isSellerDevPreview),
  // so the seller run only checks the header of the pushed screen.
  if (role === 'seller') { await context.close(); return result; }

  // 2. Several activity items: trending sits below the last one.
  state.notifications = NOTIFICATIONS;
  await open();
  await page.getByText('Maya Ortiz').first().waitFor({ timeout: 15_000 });
  await settle(1200);
  await shot('02-activity-top');
  result.withActivity = { order: await orderFacts(page) };
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 2000);
  await settle(700);
  await shot('03-activity-scrolled');
  result.withActivityScrolled = { order: await orderFacts(page) };

  // 3. Tap Follow on the first trending row.
  const followBtn = page.locator('[data-testid^="activity-trending-row-"] [data-testid="follow-button"]').first();
  if (await followBtn.count()) {
    await followBtn.click();
    await settle(700);
    await shot('04-after-follow');
    result.afterFollow = {
      label: await followBtn.innerText(),
      followCalls: state.followCalls,
    };
  }
  result.trendingQueries = state.trendingQueries;

  await context.close();
  return result;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(path.resolve(buildDir));
  const results = {};
  try {
    results.buyerTab = await run(browser, images, origin, 'buyer', 'tab', 'buyer-tab');
    results.sellerPushed = await run(browser, images, origin, 'seller', '/activity-center', 'seller-pushed');
  } finally {
    await close();
    await browser.close();
  }
  writeFileSync(path.join(OUT, `${prefix}-results.json`), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
