#!/usr/bin/env node
/**
 * Item 84: a new Activity event arriving while the screen is open slides in
 * at the top — proven frame by frame, not described.
 *
 * Drives the DEV bundle (what the owner's Replit preview serves) at 390×844,
 * reaching Activity the owner's way (buyer tab bar / seller dashboard bell).
 * A stateful fake of the real /buyer/notifications endpoints plays the
 * server: mid-visit it gains a new event (and `/unread-count` moves), exactly
 * what a second client liking your post does. The app's own ~1.5s realtime
 * poll has to notice it; an in-page requestAnimationFrame sampler records the
 * arriving row's height / opacity / translateY every frame.
 *
 * Cases per role:
 *   top      — at the top of the list: the row slides + fades in, no bounce,
 *              nothing left holding a transform afterwards
 *   scrolled — down the list: nothing shifts; a "New activity" pill shows;
 *              tapping it scrolls up and the row slides in
 *   reduced  — Reduce Motion on: the row is simply inserted (no slide/fade)
 *   preview  — the no-account preview (all 401): the one simulated live
 *              event arrives on its own and slides in
 *
 * Usage: start the dev server (see activity-dev-preview-verify.mjs), then
 *   node scripts/store-screenshots/activity-live-rows-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-live-rows'));
mkdirSync(OUT, { recursive: true });
const VIEW_H = 844;

const minsAgo = (m) => new Date(DEMO_NOW - m * 60_000).toISOString();
const apiRow = (id, name, type, title, mins, extra = {}) => ({
  id, category: 'social', type, title, body: '', isRead: true, isMuted: false,
  actorId: `u-${id}`, actorName: name, actorInitials: name.slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
  targetId: `t-${id}`, targetType: 'post', createdAt: minsAgo(mins), ...extra,
});
// Enough rows that the list genuinely scrolls.
const NAMES = ['Priya Shah', 'Marcus Webb', 'Ana Ruiz', 'Lena Fox', 'Kenji Mori', 'Sade Okoro', 'Tom Reyes', 'Iris Vale', 'Omar Haddad', 'Noa Levi', 'Eli Brandt', 'Mia Chen'];
const BASE_FEED = NAMES.map((name, i) => apiRow(`a${i + 1}`, name, i % 3 === 0 ? 'post_comment' : i % 3 === 1 ? 'repost' : 'mention',
  `${name} ${i % 3 === 0 ? 'commented on your post' : i % 3 === 1 ? 'reposted your post' : 'mentioned you in a comment'}`, 5 + i * 40));

async function run(browser, images, role, mode) {
  const server = { feed: BASE_FEED.map((row) => ({ ...row })) };
  const device = { viewport: { width: 390, height: VIEW_H }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  const useApi = mode !== 'preview';
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !url.pathname.includes('/api/public/'), (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? '*',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1/, '/api');
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (useApi && p.startsWith('/api/buyer/notifications')) {
      if (p === '/api/buyer/notifications' && req.method() === 'GET') {
        const u = new URL(req.url());
        const offset = Number(u.searchParams.get('offset') ?? 0);
        const limit = Number(u.searchParams.get('limit') ?? 100);
        return json(server.feed.slice(offset, offset + limit));
      }
      if (p === '/api/buyer/notifications/unread-count') {
        return json({ count: server.feed.filter((row) => !row.isRead).length, latestId: server.feed[0]?.id ?? null });
      }
      return json({ ok: true });
    }
    return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  page.setDefaultNavigationTimeout(180_000);
  await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss(); });
  const settle = async (ms = 800) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${mode}-${role}-${name}.png`) });
  const rows = page.locator('[data-testid^="activity-row-"]');
  const clearOverlay = () => page.evaluate(() => document.getElementById('error-overlay')?.remove());
  const pageNow = () => page.evaluate(() => performance.now());
  const waitPage = async (ms) => {
    const start = await pageNow();
    for (let i = 0; i < 120 && (await pageNow()) - start < ms; i += 1) await page.waitForTimeout(250);
  };

  // Open Activity the owner's way.
  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, ORIGIN, role, role === 'buyer' ? '/' : '/(tabs)');
    await settle(1500);
    const entry = role === 'buyer' ? page.getByTestId('buyer-tab-activity').first() : page.getByTestId('seller-dashboard-activity').first();
    try { await entry.waitFor({ timeout: 20_000 }); } catch (error) { if (attempt >= 3) throw error; continue; }
    const later = page.getByText('Continue setup later');
    if (await later.count()) { await later.first().click().catch(() => {}); await settle(800); }
    await clearOverlay();
    await entry.click();
    try { await rows.first().waitFor({ timeout: 20_000 }); break; } catch (error) { if (attempt >= 3) throw error; }
  }
  await settle(2000);
  await clearOverlay();

  const liveId = mode === 'preview' ? 'preview-act-live-01' : 'live1';
  const r = { alerts, liveId };

  // Frame sampler: every animation frame, the arriving row's wrapper
  // (present only while it's entering) and the row itself.
  await page.evaluate((id) => {
    const samples = [];
    window.__liveSamples = samples;
    const tick = () => {
      const outer = document.querySelector(`[data-testid="activity-live-enter-${id}"]`);
      const row = document.querySelector(`[data-testid="activity-row-${id}"]`);
      if (outer || row) {
        const inner = outer?.firstElementChild;
        const cs = inner ? getComputedStyle(inner) : null;
        const m = cs && cs.transform !== 'none' ? new DOMMatrixReadOnly(cs.transform) : null;
        samples.push({
          t: Math.round(performance.now()),
          entering: !!outer,
          height: outer ? Math.round(outer.getBoundingClientRect().height * 10) / 10 : null,
          opacity: cs ? Number(cs.opacity) : null,
          translateY: m ? Math.round(m.m42 * 100) / 100 : null,
          rowTop: row ? Math.round(row.getBoundingClientRect().top) : null,
        });
      }
      if (!window.__liveStop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, liveId);

  const firstRowId = () => rows.first().getAttribute('data-testid');
  r.firstRowBefore = await firstRowId();
  await shot('01-before');

  if (mode === 'scrolled') {
    await page.mouse.move(195, 600);
    for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, 250); await page.waitForTimeout(150); }
    await page.waitForTimeout(600);
  }
  const anchor = mode === 'scrolled' ? await rows.nth(4).getAttribute('data-testid') : null;
  const anchorTop = async () => (anchor ? Math.round((await page.getByTestId(anchor).first().boundingBox())?.y ?? -1) : null);
  const anchorBefore = await anchorTop();

  // The server gains a new event (a second client just liked a post).
  if (useApi) {
    server.feed.unshift(apiRow('live1', 'Jordan Blake', 'post_like', 'Jordan Blake liked your post', 0, { isRead: false }));
  }
  const arrivedAt = await pageNow();

  // Wait for the app to notice (realtime poll, or the preview's own timer).
  const target = page.getByTestId(`activity-row-${liveId}`);
  const pill = page.getByTestId('activity-new-pill');
  const noticeBudget = mode === 'preview' ? 20_000 : 8_000;
  let noticed = false;
  for (let i = 0; i < 200 && (await pageNow()) - arrivedAt < noticeBudget; i += 1) {
    if (mode === 'scrolled' ? await pill.count() : await target.count()) { noticed = true; break; }
    await page.waitForTimeout(100);
  }
  r.noticedLive = noticed;
  r.noticedAfterPageMs = Math.round((await pageNow()) - arrivedAt);

  if (mode === 'scrolled') {
    await page.waitForTimeout(400);
    r.pillShown = (await pill.count()) > 0;
    r.pillLabel = await pill.first().getAttribute('aria-label').catch(() => null);
    r.rowHeldBackWhileScrolled = (await target.count()) === 0;
    const anchorAfter = await anchorTop();
    r.contentDidNotShift = anchorBefore !== null && anchorAfter !== null && Math.abs(anchorAfter - anchorBefore) <= 1;
    const pillBox = await pill.first().boundingBox();
    r.pillBox = pillBox && { y: Math.round(pillBox.y), h: Math.round(pillBox.height), w: Math.round(pillBox.width) };
    const chipsBox = await page.getByTestId('activity-chip-all').first().boundingBox();
    r.pillJustBelowHeader = !!pillBox && !!chipsBox && pillBox.y >= chipsBox.y + chipsBox.height && pillBox.y <= chipsBox.y + chipsBox.height + 48;
    await shot('02-scrolled-pill');
    await pill.first().click();
    for (let i = 0; i < 60 && !(await target.count()); i += 1) await page.waitForTimeout(100);
    r.pillTapBringsRowIn = (await target.count()) > 0;
    r.pillGoneAfterTap = (await pill.count()) === 0;
  }

  // Mid-entrance frame for the record.
  await page.waitForTimeout(60);
  await shot('03-arriving');
  await waitPage(1500);
  await page.evaluate(() => { window.__liveStop = true; });
  const samples = await page.evaluate(() => window.__liveSamples);
  const entering = samples.filter((s) => s.entering);
  r.framesSampled = samples.length;
  r.enteringFrames = entering.length;
  r.midFrames = entering.filter((s) => s.opacity > 0.02 && s.opacity < 0.98).length;
  r.firstEnteringFrame = entering[0] ?? null;
  r.midSample = entering[Math.floor(entering.length / 2)] ?? null;
  r.heightGrewSmoothly = entering.every((s, i) => i === 0 || s.height >= entering[i - 1].height - 0.5);
  r.maxHeightDuringEntrance = entering.reduce((m, s) => Math.max(m, s.height ?? 0), 0);
  r.noOvershoot = entering.every((s) => (s.translateY ?? 0) <= 0.01 && (s.opacity ?? 0) <= 1);
  r.slideRange = entering.length ? [Math.min(...entering.map((s) => s.translateY ?? 0)), Math.max(...entering.map((s) => s.translateY ?? 0))] : null;
  r.entranceMs = entering.length ? entering[entering.length - 1].t - entering[0].t : 0;
  // Settled: row in place, on top, fully visible, nothing holding a transform.
  r.rowPresent = (await target.count()) > 0;
  r.rowIsFirst = (await firstRowId()) === `activity-row-${liveId}`;
  // Transforms/opacity between the row and the list cell, for the arrived row
  // vs an ordinary one: equal means the entrance left nothing behind (the
  // swipe row's own resting translateX is on every row).
  const ancestry = (locator) => locator.evaluate((el) => {
    let node = el; let transformed = 0; let dimmed = 0;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.transform !== 'none') transformed += 1;
      if (Number(cs.opacity) < 1) dimmed += 1;
    }
    return { transformed, dimmed };
  }).catch(() => null);
  const ordinary = await rows.nth(2).getAttribute('data-testid');
  r.settledRowStyle = { arrived: await ancestry(target.first()), ordinary: await ancestry(page.getByTestId(ordinary).first()) };
  // (The arrived row keeps two unstyled wrapper levels, so a fixed-depth walk
  // reaches fewer of the list's own ancestors — hence "no more than".)
  r.settledNoLeftoverTransformOrFade = !!r.settledRowStyle.arrived && !!r.settledRowStyle.ordinary
    && r.settledRowStyle.arrived.transformed <= r.settledRowStyle.ordinary.transformed
    && r.settledRowStyle.arrived.dimmed === 0;
  r.wrapperGone = (await page.locator(`[data-testid="activity-live-enter-${liveId}"]`).count()) === 0;
  r.rowHeight = Math.round((await target.first().boundingBox().catch(() => null))?.height ?? 0);
  await shot('04-settled');
  r.alerts = alerts;
  await context.close();
  return r;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    const modes = process.env.VERIFY_MODES ? process.env.VERIFY_MODES.split(',') : ['top', 'scrolled', 'reduced', 'preview'];
    for (const mode of modes) {
      for (const role of roles) {
        const result = await run(browser, images, role, mode);
        console.log(`\n[${mode} ${role}]`, JSON.stringify(result, null, 2));
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
