#!/usr/bin/env node
/**
 * Item 83: swipe an Activity row left → trash → "Notification deleted · Undo".
 *
 * Drives the DEV bundle (what the owner's Replit preview serves) at 390×844,
 * reaching Activity the owner's way (buyer tab bar / seller dashboard bell),
 * in two modes per role:
 *   preview — every signed-in call answered 401 (no-account preview, seeded feed)
 *   api     — a signed-in account against a stateful fake of the real
 *             /buyer/notifications endpoints, so the DELETE itself, its timing,
 *             Undo (no DELETE sent) and a full page reload are all checked.
 *
 * Usage: start the dev server (see activity-dev-preview-verify.mjs), then
 *   node scripts/store-screenshots/activity-swipe-delete-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW } from './demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/activity-swipe-delete'));
mkdirSync(OUT, { recursive: true });
const VIEW_H = 844;

const minsAgo = (m) => new Date(DEMO_NOW - m * 60_000).toISOString();
const apiRow = (id, name, type, title, mins, extra = {}) => ({
  id, category: 'social', type, title, body: '', isRead: true, isMuted: false,
  actorId: `u-${id}`, actorName: name, actorInitials: name.slice(0, 2).toUpperCase(), actorColor: '#3F3F46',
  targetId: `t-${id}`, targetType: 'post', createdAt: minsAgo(mins), ...extra,
});
const API_FEED = [
  apiRow('a1', 'Priya Shah', 'post_comment', 'Priya Shah commented on your post', 3),
  apiRow('a2', 'Marcus Webb', 'post_like', 'Marcus Webb liked your post', 8),
  apiRow('a3', 'Ana Ruiz', 'repost', 'Ana Ruiz reposted your post', 15),
  apiRow('a4', 'Lena Fox', 'mention', 'Lena Fox mentioned you in a comment', 120),
];

async function run(browser, images, role, mode) {
  const server = { feed: API_FEED.map((row) => ({ ...row })), deletes: [] };
  const device = { viewport: { width: 390, height: VIEW_H }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin: ORIGIN, images });
  const pageNow = () => page.evaluate(() => performance.now());
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !url.pathname.includes('/api/public/'), async (route) => {
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
    if (mode === 'api' && p.startsWith('/api/buyer/notifications')) {
      if (p === '/api/buyer/notifications' && req.method() === 'GET') {
        const u = new URL(req.url());
        const offset = Number(u.searchParams.get('offset') ?? 0);
        const limit = Number(u.searchParams.get('limit') ?? 100);
        return json(server.feed.slice(offset, offset + limit));
      }
      if (p === '/api/buyer/notifications/unread-count') return json({ count: 0, latestId: server.feed[0]?.id ?? null });
      const one = p.match(/^\/api\/buyer\/notifications\/([^/]+)$/);
      if (one && req.method() === 'DELETE') {
        server.deletes.push({ id: one[1], at: await pageNow().catch(() => -1) });
        server.feed = server.feed.filter((row) => row.id !== one[1]);
        return json({ ok: true });
      }
      return json({ ok: true });
    }
    return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  page.setDefaultNavigationTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const alerts = [];
  page.on('dialog', (d) => { alerts.push(d.message()); void d.dismiss(); });
  const settle = async (ms = 800) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${mode}-${role}-${name}.png`) });
  const rows = page.locator('[data-testid^="activity-row-"]');
  const waitPage = async (ms) => {
    const start = await pageNow();
    for (let i = 0; i < 80 && (await pageNow()) - start < ms; i += 1) await page.waitForTimeout(250);
  };
  const clearOverlay = () => page.evaluate(() => document.getElementById('error-overlay')?.remove());

  const openActivity = async ({ reload = false } = {}) => {
    for (let attempt = 1; ; attempt += 1) {
      if (reload || attempt > 1 || !page.url().startsWith(ORIGIN)) {
        await openScreen(page, activity, ORIGIN, role, role === 'buyer' ? '/' : '/(tabs)');
        await settle(1500);
      }
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
  };
  const leaveActivity = async () => {
    await clearOverlay();
    if (role === 'buyer') await page.getByTestId('buyer-tab-index').first().click();
    else await page.goBack();
    await settle(1200);
  };

  // Where the row's content sits now (its tap area moves with the swipe).
  const rowX = async (testId) => (await page.getByTestId(testId).first().boundingBox())?.x ?? null;
  // The trash button behind THIS row (its SwipeableActions container).
  const trashOf = (testId) => page.getByTestId(testId).first()
    .locator('xpath=ancestor::div[.//*[@aria-label="Delete this notification"]][1]')
    .getByLabel('Delete this notification');
  const trashVisible = (testId = r.target) => trashOf(testId).evaluateAll((els) => els.some((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.width > 0 && r.top >= 0 && r.bottom <= 844 && !!hit && (el === hit || el.contains(hit));
  }));
  // Real touch events (a phone, and the owner's preview on one) by default;
  // `input: 'mouse'` for a desktop browser.
  const cdp = await context.newCDPSession(page);
  const drag = async (x, y, dx, dy, input = 'touch') => {
    if (input === 'mouse') {
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 12; i += 1) await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
      await page.mouse.up();
    } else {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 12; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 12, y: y + (dy * i) / 12 }] });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForTimeout(700);
  };
  const tapAt = async (x, y, input = 'touch') => {
    if (input === 'mouse') { await page.mouse.click(x, y); } else {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await page.waitForTimeout(700);
  };
  const swipeLeftFrom = async (testId, where, input) => {
    const el = page.getByTestId(testId).first();
    let box = await el.boundingBox();
    if (box && (box.y < 260 || box.y + box.height > VIEW_H - 120)) {
      await el.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(500);
      box = await el.boundingBox();
    }
    // 'text' = on the sentence (inside the row's own tap target), 'edge' =
    // the trailing thumbnail/Follow slot (plain View / image).
    const x = where === 'edge' ? 370 : box.x + box.width * 0.55;
    await drag(x, box.y + box.height / 2, -170, 4, input);
    await page.waitForTimeout(500); // let the snap spring settle
  };
  const closeRow = async (testId, input) => {
    const box = await page.getByTestId(testId).first().boundingBox();
    await drag(Math.max(box.x + 40, 60), box.y + box.height / 2, 170, 0, input);
    await page.waitForTimeout(500);
  };
  const toast = page.getByTestId('activity-undo-toast');

  const r = { alerts };
  globalThis.lastResult = r; // printed if a step throws
  await openActivity({ reload: true });
  await shot('01-at-rest');
  const target = mode === 'api' ? 'activity-row-a2' : 'activity-row-preview-act-story-like-01';
  r.target = target;
  const restX = await rowX(target);

  // 1. Swipe starting on the sentence, then on the trailing edge.
  await swipeLeftFrom(target, 'text');
  r.swipeFromTextOpens = (await rowX(target)) < restX - 60 && await trashVisible();
  await shot('02-swiped-reveals-more-and-trash');
  await closeRow(target);
  r.swipeRightCloses = Math.abs((await rowX(target)) - restX) < 2;
  await swipeLeftFrom(target, 'edge');
  r.swipeFromTrailingEdgeOpens = (await rowX(target)) < restX - 60 && await trashVisible();
  await closeRow(target);

  // 1b. Tapping an open row closes it (doesn't open the notification).
  await swipeLeftFrom(target, 'text');
  const openBox = await page.getByTestId(target).first().boundingBox();
  const urlBefore = page.url();
  await tapAt(openBox.x + openBox.width * 0.5, openBox.y + openBox.height / 2);
  await page.waitForTimeout(600);
  r.tapOnOpenRowCloses = page.url() === urlBefore && Math.abs((await rowX(target)) - restX) < 2;
  r.tapDetail = { openX: openBox.x, afterX: await rowX(target).catch(() => null), navigatedTo: page.url() === urlBefore ? null : page.url() };
  if (page.url() !== urlBefore) await openActivity();
  if (Math.abs((await rowX(target)) - restX) >= 2) await closeRow(target);

  // 1c. Desktop browser (mouse): a swipe must reveal, not open the row.
  const urlMouse = page.url();
  await swipeLeftFrom(target, 'text', 'mouse');
  r.mouseSwipeFromTextOpensWithoutNavigating = page.url() === urlMouse && (await rowX(target)) < restX - 60 && await trashVisible();
  await closeRow(target, 'mouse');
  r.mouseSwipeRightCloses = page.url() === urlMouse && Math.abs((await rowX(target)) - restX) < 2;
  await swipeLeftFrom(target, 'edge', 'mouse');
  r.mouseSwipeFromThumbnailOpens = page.url() === urlMouse && (await rowX(target)) < restX - 60;
  r.mouseThumbDetail = { x: await rowX(target).catch(() => null), url: page.url() };
  await closeRow(target, 'mouse');
  r.mouseCloseAfterThumbnailSwipe = { x: await rowX(target), closed: Math.abs((await rowX(target)) - restX) < 2 };
  r.mousePlainClickStillOpensRow = null; // checked last (it navigates away)

  // 2. A vertical drag over rows must not open one.
  const box = await page.getByTestId(target).first().boundingBox();
  await drag(box.x + box.width * 0.5, box.y + box.height / 2, -6, -220);
  r.verticalDragLeavesRowClosed = Math.abs((await rowX(target)) - restX) < 2 && !(await trashVisible());
  r.verticalDetail = { restX, x: await rowX(target).catch(() => null), trash: await trashVisible().catch(() => null), url: page.url() };
  await shot('02b-after-vertical-drag');
  if (!(await page.getByTestId(target).count())) await openActivity();

  // 3. Trash → row gone + "Notification deleted · Undo"; nothing sent yet.
  if (!(await page.getByTestId(target).count())) await openActivity();
  await swipeLeftFrom(target, 'text');
  await trashOf(target).first().click();
  await page.waitForTimeout(600);
  r.rowGoneAfterTrash = (await page.getByTestId(target).count()) === 0;
  r.toastText = (await toast.count()) ? (await toast.innerText()).replace(/\s+/g, ' ').trim() : null;
  r.undoColor = await page.getByRole('button', { name: /^Undo:/ }).first().evaluate((el) => getComputedStyle(el.querySelector('div') ?? el).color).catch(() => null);
  const toastBox = await toast.boundingBox().catch(() => null);
  r.toastOnScreen = !!toastBox && toastBox.y >= 0 && toastBox.y + toastBox.height <= VIEW_H;
  // The floating tab bar's top edge (buyer or seller bar), from its visible tabs.
  const barTop = await page.locator('[data-testid^="buyer-tab-"], [data-testid^="seller-tab-"]').evaluateAll((els) => {
    const tops = els.map((el) => el.getBoundingClientRect()).filter((b) => b.width > 0 && b.top > 500).map((b) => b.top);
    return tops.length ? Math.min(...tops) : null;
  });
  r.toastClearsTabBar = !!toastBox && barTop != null && toastBox.y + toastBox.height <= barTop;
  r.toastLayout = { toastBottom: toastBox ? Math.round(toastBox.y + toastBox.height) : null, barTop: barTop != null ? Math.round(barTop) : null };
  r.deletesSentBeforeUndoWindowEnds = server.deletes.length;
  await shot('03-deleted-with-undo');

  // 4. Undo → row back in place, and no DELETE ever sent for it.
  await page.getByRole('button', { name: /^Undo:/ }).first().click();
  await page.waitForTimeout(700);
  r.rowBackAfterUndo = (await page.getByTestId(target).count()) === 1;
  await shot('04-after-undo');
  await waitPage(6500);
  r.deletesAfterUndo = server.deletes.length;
  r.rowStillThereAfterUndoWindow = (await page.getByTestId(target).count()) === 1;

  // 5. Delete for real: sent when the window closes, gone after reopening.
  await swipeLeftFrom(target, 'text');
  const deletedAt = await pageNow();
  await trashOf(target).first().click();
  await waitPage(6000);
  r.toastGoneAfterWindow = (await toast.count()) === 0;
  if (mode === 'api') {
    r.deleteRequests = server.deletes.map((d) => ({ id: d.id, afterMs: Math.round(d.at - deletedAt) }));
  }
  await leaveActivity();
  await openActivity();
  r.goneAfterReopening = (await page.getByTestId(target).count()) === 0;
  await shot('05-reopened-still-gone');
  if (mode === 'api') {
    await openActivity({ reload: true });
    r.goneAfterFullReload = (await page.getByTestId(target).count()) === 0;
    r.serverFeedIds = server.feed.map((row) => row.id);
  }

  // 6. Leaving Activity inside the Undo window still deletes (no lost delete).
  if (mode === 'api') {
    const second = 'activity-row-a3';
    await swipeLeftFrom(second, 'text');
    await trashOf(second).first().click();
    await page.waitForTimeout(300);
    await leaveActivity();
    await page.waitForTimeout(800);
    r.leaveInsideWindowSendsDelete = server.deletes.some((d) => d.id === 'a3');
    r.toastClearedOnLeave = (await toast.count()) === 0;
  }

  // 7. A plain click/tap on a closed row still opens it (nothing swallowed).
  await openActivity();
  const anyRow = await rows.first().getAttribute('data-testid');
  const plainBox = await page.getByTestId(anyRow).first().boundingBox();
  const urlPlain = page.url();
  await page.mouse.click(plainBox.x + plainBox.width * 0.5, plainBox.y + plainBox.height / 2);
  await page.waitForTimeout(1500);
  r.mousePlainClickStillOpensRow = page.url() !== urlPlain;

  r.alerts = alerts;
  await context.close();
  return r;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    const roles = process.env.VERIFY_ROLES ? process.env.VERIFY_ROLES.split(',') : ['buyer', 'seller'];
    const modes = process.env.VERIFY_MODES ? process.env.VERIFY_MODES.split(',') : ['preview', 'api'];
    for (const mode of modes) {
      for (const role of roles) {
        const results = await run(browser, images, role, mode);
        console.log(`\n[${mode} ${role}]`, JSON.stringify(results, null, 2));
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('partial result:', JSON.stringify(globalThis.lastResult ?? null, null, 2));
  console.error(error);
  process.exit(1);
});
