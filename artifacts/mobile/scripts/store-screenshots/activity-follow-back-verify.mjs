#!/usr/bin/env node
/**
 * One-off live verification for the inline Follow back / Following pill on
 * single-person Activity follow rows (item 77) — not part of the store
 * screenshot pipeline. Production web export + a fake API that keeps a real
 * follow graph, so a reload proves the state comes back from the server
 * (GET /api/buyer/notifications → isFollowingActor), not just local state.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/activity-follow-back-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-follow-back-inline'));
mkdirSync(OUT, { recursive: true });

const MIN = 60_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();
const person = (id, name, handle) => ({
  actorId: id, actorName: name, actorHandle: handle,
  actorInitials: name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
});
const follow = (id, actorId, name, handle, minsAgo, isRead) => ({
  id, category: 'social', type: 'new_follower', title: `${name} started following you`, body: '',
  isRead, isMuted: false, ...person(actorId, name, handle), targetId: actorId, targetType: 'user',
  cta: 'Follow back', createdAt: iso(minsAgo * MIN),
});
const FEED = [
  follow('n-fol-priya', 'u-priya', 'Priya Shah', '@priyashah', 6 * 60, false),
  // Stored cta is still "Follow back", but the viewer already follows Marcus.
  follow('n-fol-marcus', 'u-marcus', 'Marcus Webb', '@marcusw', 3 * 60, true),
  follow('n-fol-ana', 'u-ana', 'Ana Ruiz', '@anaruiz', 26 * 60, true),
  { id: 'n-like-1', category: 'social', type: 'post_like', title: 'Jordan Lee liked your post', body: '', isRead: true, isMuted: false, ...person('u-jordan', 'Jordan Lee', '@jordanlee'), targetId: 'post-1', targetType: 'post', targetImageUrl: `${IMAGE_HOST}/hoodie-bone.jpg`, createdAt: iso(50 * MIN) },
];

async function installFakeApi(context, state) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  const OWNED = /^\/api\/(buyer\/notifications(\/.*)?|social\/follow(\/.*)?)$/;
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
    const p = norm(url.pathname);
    if (p === '/api/buyer/notifications' && req.method() === 'GET') {
      // Mirrors the server: live isFollowingActor on follow rows.
      return json(FEED.map((f) => (f.type === 'new_follower' ? { ...f, isFollowingActor: state.following.has(f.actorId) } : f)));
    }
    if (p === '/api/social/follow' && req.method() === 'POST') {
      const { userId } = JSON.parse(req.postData() ?? '{}');
      state.calls.push(`POST ${userId}`);
      await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.fail) return json({ error: 'boom' }, 500);
      state.following.add(userId);
      return json({ ok: true, isFollowing: true, followersCount: 12 });
    }
    const del = p.match(/^\/api\/social\/follow\/(.+)$/);
    if (del && req.method() === 'DELETE') {
      const userId = decodeURIComponent(del[1]);
      state.calls.push(`DELETE ${userId}`);
      await new Promise((r) => setTimeout(r, state.delayMs));
      state.following.delete(userId);
      return json({ ok: true, isFollowing: false, followersCount: 11 });
    }
    if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: 'n-fol-priya' });
    return json({ ok: true });
  });
}

async function run(browser, images, origin, role) {
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  const state = { following: new Set(['u-marcus']), calls: [], delayMs: 0, fail: false };
  await installFakeApi(context, state);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${role}-${name}.png`) });
  const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };
  const pill = (userId) => page.getByTestId(`activity-follow-${userId}`);
  const label = async (userId) => (await pill(userId).first().innerText()).trim();
  const results = {};

  const openActivity = async () => {
    for (let attempt = 1; ; attempt += 1) {
      await openScreen(page, activity, origin, role, '/activity-center');
      try { await pill('u-priya').first().waitFor({ timeout: 15_000 }); return; } catch (error) { if (attempt >= 3) throw error; }
    }
  };

  await openActivity();
  await settle(1000);
  await shot('01-initial');
  results.initial = { priya: await label('u-priya'), marcus: await label('u-marcus'), ana: await label('u-ana') };

  // Follow back, slow network: in-flight spinner, double tap sends once, no navigation.
  state.delayMs = 1500;
  const urlBefore = page.url();
  await pill('u-priya').first().click();
  await pill('u-priya').first().click();
  await page.waitForTimeout(400);
  await shot('02-follow-back-in-flight');
  await page.waitForTimeout(1600);
  await settle();
  await shot('03-followed');
  state.delayMs = 0;
  results.followBack = { calls: [...state.calls], urlUnchanged: page.url() === urlBefore, label: await label('u-priya') };

  // Following → unfollow confirm → DELETE → Follow back
  state.calls = [];
  await pill('u-marcus').first().click();
  await page.getByText('Unfollow', { exact: true }).first().waitFor({ timeout: 5000 });
  await shot('04-unfollow-confirm');
  await page.getByText('Unfollow', { exact: true }).first().click();
  await settle();
  await shot('05-unfollowed');
  results.unfollow = { calls: [...state.calls], label: await label('u-marcus') };

  // Reload: state comes back from the server, not local memory.
  await openActivity();
  await settle(1000);
  await shot('06-after-reload');
  results.afterReload = { priya: await label('u-priya'), marcus: await label('u-marcus') };

  // Failure rolls back.
  state.fail = true;
  state.calls = [];
  await pill('u-ana').first().click();
  await settle(800);
  await shot('07-follow-failed-rolled-back');
  results.failure = { calls: [...state.calls], label: await label('u-ana') };
  state.fail = false;

  // Tapping the row itself (not the pill) still opens the profile.
  await page.locator('[aria-label*="Ana Ruiz started following you"]').first().click();
  await settle();
  results.rowTapPath = new URL(page.url()).pathname;

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
