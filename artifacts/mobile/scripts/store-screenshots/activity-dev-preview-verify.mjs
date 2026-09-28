#!/usr/bin/env node
/**
 * Closest local replica of the owner's live Replit preview
 * (…replit.dev/?bt_preview=buyer|seller) for the Activity unread dots +
 * "Mark all read" (item 81).
 *
 * Unlike the other *-verify scripts (a production export fed by a fake
 * API), this drives the DEV bundle (`expo start --web`, __DEV__ true) —
 * what Replit serves — with every /buyer/notifications call answered 401,
 * the way the real API answers a no-account preview. So the Activity
 * screen falls back to the seeded preview feed exactly as it does live,
 * and it is reached the way the owner reaches it: the buyer tab bar's
 * Activity slot, or the seller dashboard's bell.
 *
 * Usage: start the dev server first, e.g.
 *   EXPO_PUBLIC_API_BASE_URL=https://api.brandthread.test \
 *   EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_<base64 of "clerk.brandthread.test$"> \
 *   npx expo start --web --port 8099
 * then: node scripts/store-screenshots/activity-dev-preview-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-unread-dots'));
mkdirSync(OUT, { recursive: true });

// VERIFY_API=1: instead of the no-account preview, serve a signed-in account's
// real-shaped feed (3 unread, 2 read) and keep read state server-side, so the
// same flow is checked against the real endpoints.
const API_MODE = process.env.VERIFY_API === '1';
// The harness pins the page clock to DEMO_NOW; date the rows against it.
const minsAgo = (m) => new Date(DEMO_NOW - m * 60_000).toISOString();
const apiRow = (id, name, type, title, isRead, mins) => ({
  id, category: 'social', type, title, body: '', isRead, isMuted: false,
  actorId: `u-${id}`, actorName: name, actorInitials: name.slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
  targetId: `t-${id}`, targetType: type === 'new_follower' ? 'user' : 'post', createdAt: minsAgo(mins),
});
const api = {
  feed: [
    apiRow('a1', 'Priya Shah', 'post_comment', 'Priya Shah commented on your post', false, 3),
    apiRow('a2', 'Marcus Webb', 'post_like', 'Marcus Webb liked your post', false, 8),
    apiRow('a3', 'Ana Ruiz', 'repost', 'Ana Ruiz reposted your post', false, 15),
    apiRow('a4', 'Kenji Mori', 'post_like', 'Kenji Mori liked your story', true, 60),
    apiRow('a5', 'Lena Fox', 'mention', 'Lena Fox mentioned you in a comment', true, 120),
  ],
};

const INITIAL_FEED = api.feed;

async function run(browser, images, role) {
  api.feed = INITIAL_FEED.map((row) => ({ ...row }));
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  const calls = [];
  // No account in the preview: the real API rejects the notifications feed.
  await context.route((url) => url.origin === 'https://api.brandthread.test' && url.pathname.includes('/buyer/notifications'), (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1/, '/api');
    calls.push(`${req.method()} ${p}`);
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (API_MODE) {
      // A signed-in account against the real endpoints (stateful fake).
      if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(api.feed);
      if (p === '/api/buyer/notifications/unread-count') return json({ count: api.feed.filter((f) => !f.isRead).length, latestId: api.feed[0].id });
      if (p === '/api/buyer/notifications/read-all') { api.feed = api.feed.map((f) => ({ ...f, isRead: true })); return json({ ok: true }); }
      const one = p.match(/^\/api\/buyer\/notifications\/([^/]+)\/read$/);
      if (one) { api.feed = api.feed.map((f) => (f.id === one[1] ? { ...f, isRead: true } : f)); return json({ ok: true }); }
      return json({ ok: true });
    }
    return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  // The dev bundle is ~30MB and compiled on demand; give it time.
  page.setDefaultNavigationTimeout(180_000);
  // A normal browser (the harness defaults to reduced motion, under which the
  // tab badge's pop-in never runs on web — a separate, pre-existing issue).
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (process.env.VERIFY_DEBUG) page.on('console', (m) => { if (m.text().includes('DBG81')) console.log(m.text()); });
  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss(); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${API_MODE ? 'api' : 'preview'}-${role}-${name}.png`) });
  const settle = async (ms = 800) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  const dots = () => page.locator('[data-testid^="activity-unread-dot-"]').count();
  // Every tab bar instance mounted (only one should be visible), so a stale
  // hidden copy can't mask the visible badge.
  // The number actually rendered in the Activity tab's badge ('' = none).
  const badge = async () => (role === 'buyer'
    ? (await page.getByTestId('buyer-tab-activity').evaluateAll((els) => els
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => el.innerText.trim()))).join(' | ')
    : null);
  const results = {};

  // Home first, then Activity the way the owner gets there.
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, ORIGIN, role, role === 'buyer' ? '/' : '/(tabs)');
    await settle(1500);
    const entry = role === 'buyer' ? page.getByTestId('buyer-tab-activity').first() : page.getByTestId('seller-dashboard-activity').first();
    try { await entry.waitFor({ timeout: 20_000 }); } catch (error) { if (attempt >= 3) throw error; continue; }
    // The seller dashboard can open with the "Let's set up your store" sheet.
    const later = page.getByText('Continue setup later');
    if (await later.count()) { await later.first().click().catch(() => {}); await settle(800); }
    results.badgeBeforeOpening = await badge();
    await shot('00-entry-badge-before');
    if (role === 'seller') results.bellBeforeOpening = await page.getByTestId('seller-dashboard-activity').first().getAttribute('aria-label').catch(() => null);
    await entry.click();
    try { await page.locator('[data-testid^="activity-unread-dot-"]').first().waitFor({ timeout: 20_000 }); break; } catch (error) { if (attempt >= 3) { await shot('00-debug'); throw error; } }
  }
  await settle(3000); // let the tab's slide-in transition finish (slow dev bundle)
  results.dotsOnOpen = await dots();
  await shot('01-unread-dots');

  // Rows on screen are marked read after ~0.6s of viewing (existing
  // behaviour): the badge follows, the dots stay for this visit.
  await page.waitForTimeout(2500);
  results.badgeAfterViewing = await badge();
  results.dotsAfterViewing = await dots();

  // Mark all read.
  if (process.env.VERIFY_DEBUG) console.log('DBG81 clicking mark-all at', await page.evaluate(() => Math.round(performance.now())));
  await page.getByRole('button', { name: 'Mark all activity as read' }).first().click();
  await settle(2500);
  await shot('02-after-mark-all');
  results.dotsAfterMarkAll = await dots();
  results.badgeAfterMarkAll = await badge();
  if (process.env.VERIFY_DEBUG && role === 'buyer') {
    results.debugTabs = await page.getByTestId('buyer-tab-activity').evaluateAll((els) => els.map((e) => ({
      w: e.getBoundingClientRect().width, label: e.getAttribute('aria-label'), text: e.innerText,
    })));
    results.debugAllBadgeTexts = await page.evaluate(() => [...document.querySelectorAll('[aria-label^="Activity tab"]')].map((e) => e.getAttribute('aria-label')));
  }
  results.markAllButtonStillShown = await page.getByRole('button', { name: 'Mark all activity as read' }).count();
  results.alerts = alerts;
  results.apiCalls = [...new Set(calls)];
  if (process.env.VERIFY_DEBUG) results.callLog = calls;

  if (role === 'seller') {
    await page.goBack();
    await settle(1200);
    results.bellAfterMarkAll = await page.getByTestId('seller-dashboard-activity').first().getAttribute('aria-label').catch(() => null);
    await shot('03-dashboard-bell-after');
  } else {
    // Leave and come back: nothing unread any more, so no dots.
    await page.getByTestId('buyer-tab-index').first().click().catch(() => {});
    await settle(1200);
    results.badgeOnHomeAfterMarkAll = await badge();
    await shot('03-home-badge-after');
    await page.getByTestId('buyer-tab-activity').first().click();
    await settle(1200);
    results.dotsOnReturn = await dots();
    results.badgeOnReturn = await badge();
    await shot('04-return-visit');
  }

  await context.close();
  return results;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    for (const role of roles) {
      const results = await run(browser, images, role);
      console.log(`\n[${role}]`, JSON.stringify(results, null, 2));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
