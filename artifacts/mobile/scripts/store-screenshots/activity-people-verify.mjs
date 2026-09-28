#!/usr/bin/env node
/**
 * One-off live verification for "grouped Activity row → people list" (item
 * 76) — not part of the store screenshot pipeline. Uses the same demo
 * harness (production web export, fake API) so the REAL data path runs:
 * the Activity feed comes from GET /api/buyer/notifications and the list
 * from GET /api/buyer/notifications/actors?ids=…, both answered here.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-people-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-polish-batch1'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const person = (id, name, handle) => ({
  actorId: id, actorName: name, actorHandle: handle,
  actorInitials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
});
const FEED = [
  { id: 'n-like-a', category: 'social', type: 'post_like', title: 'Priya Shah liked your post', body: '', isRead: false, isMuted: false, ...person('u-priya', 'Priya Shah', '@priyashah'), targetId: 'post-1', targetType: 'post', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg`, createdAt: iso(4 * MIN) },
  { id: 'n-like-b', category: 'social', type: 'post_like', title: 'Marcus Webb liked your post', body: '', isRead: false, isMuted: false, ...person('u-marcus', 'Marcus Webb', '@marcusw'), targetId: 'post-1', targetType: 'post', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg`, createdAt: iso(9 * MIN) },
  { id: 'n-like-c', category: 'social', type: 'post_like', title: 'Ana Ruiz liked your post', body: '', isRead: false, isMuted: false, ...person('u-ana', 'Ana Ruiz', '@anaruiz'), targetId: 'post-1', targetType: 'post', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg`, createdAt: iso(15 * MIN) },
  { id: 'n-fol-a', category: 'social', type: 'new_follower', title: 'Kenji Mori started following you', body: '', isRead: false, isMuted: false, ...person('u-kenji', 'Kenji Mori', '@kenjimori'), targetId: 'u-kenji', targetType: 'user', createdAt: iso(40 * MIN) },
  { id: 'n-fol-b', category: 'social', type: 'new_follower', title: 'Lena Fox started following you', body: '', isRead: false, isMuted: false, ...person('u-lena', 'Lena Fox', '@lenafox'), targetId: 'u-lena', targetType: 'user', createdAt: iso(55 * MIN) },
  { id: 'n-like-solo', category: 'social', type: 'post_like', title: 'Jordan Lee liked your post', body: '', isRead: true, isMuted: false, ...person('u-jordan', 'Jordan Lee', '@jordanlee'), targetId: 'post-2', targetType: 'post', targetImageUrl: `${IMAGE_HOST}/runner-stone.jpg`, createdAt: iso(26 * 60 * MIN) },
];
const FOLLOWING = new Set(['u-marcus']);

async function installFakeApi(context, state) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const OWNED = /^\/api\/(buyer\/notifications(\/.*)?|social\/follow)$/;
  const owns = (url) => url.origin === 'https://api.brandthread.test' && OWNED.test(norm(url.pathname));
  await context.route(owns, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    // Same prefix normalization as demo-data.mjs's respond().
    const p = norm(url.pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') return json(FEED);
    if (p === '/api/buyer/notifications/actors') {
      const ids = (url.searchParams.get('ids') ?? '').split(',');
      state.actorRequests.push(ids);
      if (state.mode === 'error') return json({ error: 'boom' }, 500);
      if (state.mode === 'slow') await new Promise((r) => setTimeout(r, 6000));
      if (state.mode === 'empty') return json({ actors: [] });
      const seen = new Set();
      const actors = FEED.filter((f) => ids.includes(f.id) && !seen.has(f.actorId) && seen.add(f.actorId)).map((f) => ({
        id: f.actorId, name: f.actorName, handle: f.actorHandle, initials: f.actorInitials, color: f.actorColor,
        isFollowing: FOLLOWING.has(f.actorId), createdAt: f.createdAt,
      }));
      return json({ actors });
    }
    if (p === '/api/social/follow' && req.method() === 'POST') {
      state.followCalls.push(JSON.parse(req.postData() ?? '{}'));
      return json({ ok: true, isFollowing: true, followersCount: 12 });
    }
    if (p.startsWith('/api/buyer/notifications/') && req.method() === 'PATCH') return json({ ok: true });
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: 'n-like-a' });
    return json({ ok: true });
  });
}

async function settle(page, activity, ms = 700) {
  await waitForQuietNetwork(activity, 600, 8000);
  await page.waitForTimeout(ms);
}

async function run(browser, images, origin, role) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const state = { mode: 'ok', actorRequests: [], followCalls: [] };
  await installFakeApi(context, state);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const results = {};
  if (process.env.VERIFY_DEBUG) {
    page.on('console', (msg) => { if (msg.type() === 'error') console.log('[console]', msg.text().slice(0, 300)); });
    page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));
    page.on('requestfailed', (r) => console.log('[reqfailed]', r.url().slice(0, 120), r.failure()?.errorText));
  }

  // A fresh load occasionally lands back on "/" when the app remounts its
  // navigation tree after Clerk signs in (see openScreen) — just retry.
  const openAndWait = async (target, locator) => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, target);
      try {
        await locator.first().waitFor({ timeout: 15_000 });
        return;
      } catch (error) {
        if (attempt >= 3) throw error;
      }
    }
  };

  await openAndWait('/activity-center', page.locator('[aria-label*="and 2 others liked your post"]'));
  await settle(page, activity, 1200);
  await shot('01-activity-grouped-rows');

  // Grouped like row → Likes list
  await page.locator('[aria-label*="and 2 others liked your post"]').first().click();
  await settle(page, activity);
  await shot('02-likes-list');
  results.likesIds = state.actorRequests.at(-1);
  results.likesRows = (await page.locator('[aria-label^="Open "]').allInnerTexts()).filter(Boolean);

  // Follow someone from the list → real POST /api/social/follow
  await page.locator('[aria-label="Follow Priya Shah"]').click();
  await page.waitForTimeout(800);
  await shot('03-likes-list-followed');
  results.followCalls = [...state.followCalls];
  results.priyaNowUnfollowLabel = await page.locator('[aria-label="Unfollow Priya Shah"]').count();

  // Back → grouped follower row → New followers list
  await page.goBack();
  await settle(page, activity);
  await page.locator('[aria-label*="Kenji Mori and Lena Fox"]').first().click();
  await settle(page, activity);
  await shot('04-new-followers-list');
  results.followerIds = state.actorRequests.at(-1);
  results.followBackPills = await page.locator('[aria-label^="Follow back "]').count();

  // Single-actor row still navigates to the post (unchanged behavior)
  await openAndWait('/activity-center', page.locator('[aria-label*="Jordan Lee liked your post"]'));
  await settle(page, activity, 1000);
  const before = state.actorRequests.length;
  await page.locator('[aria-label*="Jordan Lee liked your post"]').first().click();
  await settle(page, activity);
  results.singleRowUrl = new URL(page.url()).pathname;
  results.singleRowCalledActors = state.actorRequests.length !== before;

  // States: error → retry, empty, loading
  const peopleUrl = '/activity-people?type=post_like&ids=n-like-a,n-like-b,n-like-c';
  state.mode = 'error';
  await openAndWait(peopleUrl, page.getByRole('button', { name: 'Try again' }));
  await settle(page, activity);
  await shot('05-error-state');
  state.mode = 'ok';
  await page.getByRole('button', { name: 'Try again' }).click();
  await settle(page, activity);
  await shot('06-error-retry-loaded');
  results.retryRows = (await page.locator('[aria-label^="Open "]').allInnerTexts()).filter(Boolean).length;

  state.mode = 'empty';
  await openAndWait(peopleUrl, page.getByText('No one to show here'));
  await settle(page, activity);
  await shot('07-empty-state');

  state.mode = 'slow';
  await openAndWait(peopleUrl, page.locator('[aria-label="Loading people"]'));
  await page.waitForTimeout(300);
  await shot('08-loading-state');

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
