#!/usr/bin/env node
/**
 * Hands-on verification for the Instagram micro-interactions pack, on the
 * demo web build (scripts/store-screenshots/harness.mjs) at 390x844 with
 * touch input and motion NOT reduced. Real multi-touch goes through CDP
 * (Input.dispatchTouchEvent) so pinches and drags hit react-native-web /
 * gesture-handler the way fingers do.
 *
 *   node scripts/micro-interactions-verify.mjs --out dir [--build-dir path] [--only home,friends,...]
 *
 * Writes PNG frames per step plus results.json (each step's checks).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEV_BUILD_DIR, DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = path.resolve(val('--out', path.join(MOBILE_ROOT, 'scratch', 'micro-interactions')));
const BUILD = path.resolve(val('--build-dir', DEFAULT_BUILD_DIR));
const ONLY = val('--only', null)?.split(',');
// DMs use the dev-mode export: the preview conversations are __DEV__ seeds.
const DEV_BUILD = path.resolve(val('--dev-build-dir', DEV_BUILD_DIR));
const DEVICE = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
const IMAGE_HOST = 'https://cdn.brandthread.test';
const img = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;

mkdirSync(OUT, { recursive: true });
const results = {};

/** Multi-touch over CDP: each frame is a list of {x, y} fingers (ids by index). */
async function touchPath(cdp, frames, { stepMs = 16 } = {}) {
  const pts = (f) => f.map((p, i) => ({ x: p.x, y: p.y, id: i, radiusX: 4, radiusY: 4, force: 1 }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(frames[0]) });
  for (const f of frames.slice(1)) {
    await new Promise((r) => setTimeout(r, stepMs));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(f) });
  }
}
const touchEnd = (cdp) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
const lerp = (a, b, t) => a + (b - a) * t;
const tap = (cdp, x, y) => touchPath(cdp, [[{ x, y }]]).then(() => touchEnd(cdp));

async function open(browser, images, origin, role, target, { contextOptions = {}, routes, direct = false } = {}) {
  const { context, page, activity } = await openContext(browser, {
    device: DEVICE, role, origin, images, contextOptions: { reducedMotion: 'no-preference', ...contextOptions },
  });
  if (routes) await routes(context);
  if (direct) await page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  else await openScreen(page, activity, origin, role, target);
  const cdp = await context.newCDPSession(page);
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const settle = async (ms = 600) => { await waitForQuietNetwork(activity, 500, 10_000); await page.waitForTimeout(ms); };
  return { context, page, activity, cdp, shot, settle };
}

const STEPS = {
  async explore(browser, images, origin) {
    for (const [role, target] of [['buyer', '/'], ['buyer', '/friends']]) {
      const s = await open(browser, images, origin, role, target);
      await s.settle(2500);
      await s.shot(`explore-${role}${target.replace(/\W+/g, '-')}`);
      results[`explore${target}`] = await s.page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map((n) => n.dataset.testid))].slice(0, 200));
      await s.context.close();
    }
  },
};

/** Testid'd element's center + box. */
async function box(page, testId) {
  const b = await page.getByTestId(testId).first().boundingBox();
  if (!b) throw new Error(`no box for ${testId}`);
  return { ...b, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
/** A burst of screenshots `ms` apart (the "GIF frames"). */
async function frames(s, name, count, ms) {
  for (let i = 0; i < count; i += 1) { await s.shot(`${name}-f${i}`); await s.page.waitForTimeout(ms); }
}
const exists = (page, testId) => page.getByTestId(testId).count().then((n) => n > 0);

// Home feed fixture: a 3-photo post first (edge taps / pinch), then the demo
// posts. `fresh` adds a brand-new post on top (the "New posts" check).
async function stubInteractions(context) {
  await context.route(/api\.brandthread\.test\/api\/(v1\/)?(posts\/[^/]+\/(interact|like|save)|buyer\/saved)/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ action: 'added' }),
    });
  });
}

function feedRoutes(state) {
  return async (context) => {
    await stubInteractions(context);
    await context.route(/api\.brandthread\.test\/api\/(v1\/)?(posts\/feed|public\/posts|posts\/for-you|feed\/for-you)/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const base = Array.from({ length: 5 }, (_, i) => ({
        id: `0000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, userId: 'user_seller_northline',
        seller: { brandName: 'Northline Studio', displayName: 'Northline Studio' },
        caption: i === 0 ? 'Three looks, one jacket.' : `Look ${i + 1}`,
        mediaType: 'photo',
        mediaUrls: i === 0 ? [img('story-rust'), img('story-mono'), img('hoodie-moss')] : [img(['runner-rust', 'hoodie-moss', 'story-mono', 'cargo-rust'][i - 1])],
        mediaUrl: img('story-rust'), likesCount: 100 + i, commentsCount: 3, repostsCount: 1,
        createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
      }));
      const rows = state.fresh ? [{ ...base[1], id: '00000009-0000-4000-8000-000000000009', caption: 'Just posted' }, ...base] : base;
      state.feedRequests = (state.feedRequests ?? 0) + 1;
      const offset = Number(new URL(req.url()).searchParams.get('offset') ?? 0);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(offset > 0 ? [] : rows),
      });
    });
  };
}

Object.assign(STEPS, {
  // (1) double-tap like + (6) edge taps / hold + (2) pinch + (4) pill + (5) re-tap Home
  async home(browser, images, origin) {
    const state = {};
    const s = await open(browser, images, origin, 'buyer', '/', { routes: feedRoutes(state) });
    await s.settle(2500);
    await s.shot('home-00-start');
    const r = { feedRequestsAtStart: state.feedRequests ?? 0, engagementCalls: [] };
    s.page.on('response', (res) => { if (/interact|saved|like/.test(res.url()) && res.request().method() !== 'OPTIONS') r.engagementCalls.push(`${res.request().method()} ${new URL(res.url()).pathname} ${res.status()}`); });
    s.page.on('requestfailed', (req) => { if (/interact|like/.test(req.url())) r.engagementCalls.push(`FAILED ${req.method()} ${req.url()} ${req.failure()?.errorText}`); });
    const surface = await s.page.locator('[data-testid^="video-touch-surface-"]').first().boundingBox();
    r.surface = surface;
    const midX = 195, midY = 420;
    // Edge tap right -> next photo (dot 1 active).
    const dotColor = (i) => s.page.getByTestId(`carousel-dot-${i}`).first().evaluate((n) => getComputedStyle(n.firstElementChild ?? n).backgroundColor).catch(() => null);
    r.dotsBefore = [await dotColor(0), await dotColor(1)];
    await tap(s.cdp, 370, midY);
    await s.page.waitForTimeout(800);
    r.dotsAfterRightEdge = [await dotColor(0), await dotColor(1)];
    await s.shot('home-01-edge-tap-right');
    await tap(s.cdp, 20, midY);
    await s.page.waitForTimeout(800);
    r.dotsAfterLeftEdge = [await dotColor(0), await dotColor(1)];
    await s.shot('home-02-edge-tap-left');
    // Double-tap like: heart burst frames.
    await tap(s.cdp, midX, midY); await s.page.waitForTimeout(90); await tap(s.cdp, midX, midY);
    for (let i = 0; i < 5; i += 1) {
      await s.shot(`home-03-double-tap-heart-f${i}`);
      await s.page.locator('[data-testid^="like-btn-"]').first().screenshot({ path: path.join(OUT, `home-03b-rail-heart-pop-f${i}.png`) }).catch(() => {});
      await s.page.waitForTimeout(70);
    }
    r.likeLabelAfterDoubleTap = await s.page.locator('[data-testid^="like-btn-"]').first().getAttribute('aria-label').catch(() => null);
    r.dotsAfterDoubleTap = [await dotColor(0), await dotColor(1)];
    // Pinch in place: two fingers spread from the photo's middle.
    const fr = [];
    for (let i = 0; i <= 12; i += 1) {
      const d = lerp(40, 150, i / 12);
      fr.push([{ x: midX - d, y: midY - d * 0.3 }, { x: midX + d, y: midY + d * 0.3 }]);
    }
    await touchPath(s.cdp, fr, { stepMs: 24 });
    await s.page.waitForTimeout(120);
    r.zoomLiftWhilePinching = await exists(s.page, 'photo-zoom-lift');
    await s.shot('home-04-pinch-zoom-mid');
    await touchEnd(s.cdp);
    await frames(s, 'home-05-pinch-release', 4, 120);
    await s.page.waitForTimeout(600);
    r.zoomLiftAfterRelease = await exists(s.page, 'photo-zoom-lift');
    // Scroll to the 2nd post, then new content appears -> pill.
    await s.page.mouse.wheel(0, 844);
    await s.page.waitForTimeout(1200);
    state.fresh = true;
    await s.page.clock.fastForward(61_000);
    await s.page.waitForTimeout(1500);
    r.pillShown = await exists(s.page, 'feed-new-posts-pill');
    await s.shot('home-06-new-posts-pill');
    const before = state.feedRequests;
    if (r.pillShown) {
      await s.page.getByTestId('feed-new-posts-pill').click();
      await s.page.waitForTimeout(1500);
      r.pillGoneAfterTap = !(await exists(s.page, 'feed-new-posts-pill'));
      r.refreshRequestedByPill = (state.feedRequests ?? 0) > before;
      r.scrollTopAfterPill = await s.page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 400).map((d) => d.scrollTop)));
      await s.shot('home-07-after-pill-tap');
    }
    // Re-tap Home: scroll down a page, tap the active Home tab.
    await s.page.mouse.wheel(0, 844);
    await s.page.waitForTimeout(1200);
    const beforeRetap = state.feedRequests;
    const homeTab = s.page.getByRole('tab', { name: /home/i }).or(s.page.getByLabel(/^home$/i)).first();
    await homeTab.click().catch((e) => { r.homeTabError = String(e); });
    await s.page.waitForTimeout(1500);
    r.refreshRequestedByRetap = (state.feedRequests ?? 0) > beforeRetap;
    r.scrollTopAfterRetap = await s.page.evaluate(() => Math.max(...[...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 400).map((d) => d.scrollTop)));
    await s.shot('home-08-after-home-retap');
    results.home = r;
    await s.context.close();
  },
});

// The demo friend-activity rows omit `hashtags`, which the real API always
// sends (api-server social.ts) — the Friends card reads `.length` on it.
function friendsRoutes() {
  return async (context) => {
    await stubInteractions(context);
    await context.route(/api\.brandthread\.test\/api\/(v1\/)?social\/friends\/activity/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const rows = ['look-mono', 'hoodie-moss', 'runner-rust'].map((image, i) => ({
        id: `1000000${i + 1}-0000-4000-8000-00000000000${i + 1}`, authorId: `user_friend_${i + 1}`,
        authorName: ['Ava Chen', 'Sam Ortiz', 'Priya Nair'][i], authorHandle: ['@avachen', '@samortiz', '@priyanair'][i],
        authorInitials: ['AC', 'SO', 'PN'][i], authorColor: '#2A2A2E', type: 'photo', mediaUrl: img(image),
        caption: ['Mono fit check.', 'Moss hoodie, finally.', 'Trail Runner 02 on the commute.'][i], hashtags: [],
        likesCount: 40 - i, commentsCount: 3, repostsCount: 1, likedByMe: false, repostedByMe: false,
        createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
      }));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(rows),
      });
    });
  };
}

async function openWithRetry(browser, images, origin, role, target, ready, opts) {
  for (let attempt = 0; ; attempt += 1) {
    let s;
    try {
      s = await open(browser, images, origin, role, target, opts);
      // The first client-side push can land before the router is ready:
      // push again in the same page before giving up on this load.
      for (let push = 0; ; push += 1) {
        try { await ready(s.page).first().waitFor({ timeout: 8_000 }); return s; } catch (e) {
          if (push >= 3) throw e;
          await s.page.evaluate((url) => {
            history.pushState(history.state, '', url);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
          }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
        }
      }
    } catch (e) {
      if (s) {
        await s.page.screenshot({ path: path.join(OUT, `load-fail-${target.replace(/\W+/g, '-')}-${attempt}.png`) }).catch(() => {});
        await s.context.close();
      }
      if (attempt >= 2) throw e;
    }
  }
}

Object.assign(STEPS, {
  // Friends card: (1) double-tap like + heart pop, (2) in-place pinch, (13) save bounce + toast
  async friends(browser, images, origin) {
    const s = await openWithRetry(browser, images, origin, 'buyer', '/friends',
      (p) => p.locator('[data-testid^="friends-post-media-"]'), { routes: friendsRoutes() });
    await s.settle(1200);
    const r = {};
    const m = await box(s.page, 'friends-post-media-10000001-0000-4000-8000-000000000001');
    await s.shot('friends-00-start');
    // Single tap must wait for the double-tap window; double tap likes.
    await tap(s.cdp, m.cx, m.cy); await s.page.waitForTimeout(90); await tap(s.cdp, m.cx, m.cy);
    await frames(s, 'friends-01-double-tap-heart', 5, 100);
    r.urlAfterDoubleTap = s.page.url();
    r.likeCountAfterDoubleTap = await s.page.getByTestId('friends-like-icon-10000001-0000-4000-8000-000000000001').locator('xpath=..').innerText().catch(() => null);
    // Pinch in place over the photo.
    const fr = [];
    for (let i = 0; i <= 12; i += 1) {
      const d = lerp(30, 120, i / 12);
      fr.push([{ x: m.cx - d, y: m.cy - d * 0.4 }, { x: m.cx + d, y: m.cy + d * 0.4 }]);
    }
    await touchPath(s.cdp, fr, { stepMs: 24 });
    await s.page.waitForTimeout(150);
    r.zoomLiftWhilePinching = await exists(s.page, 'photo-zoom-lift');
    await s.shot('friends-02-pinch-zoom-mid');
    await touchEnd(s.cdp);
    await s.page.waitForTimeout(900);
    r.zoomLiftAfterRelease = await exists(s.page, 'photo-zoom-lift');
    r.urlAfterPinch = s.page.url();
    // Save: bookmark bounce + saved bar.
    const save = s.page.getByLabel('Save post').first();
    await save.scrollIntoViewIfNeeded().catch(() => {});
    const sb = await save.boundingBox();
    if (sb) await tap(s.cdp, sb.x + sb.width / 2, sb.y + sb.height / 2);
    await frames(s, 'friends-03-save', 4, 120);
    r.savedToastText = await s.page.getByText('Added to Favorites').first().isVisible().catch(() => false);
    // Single tap still opens comments (after the window).
    await tap(s.cdp, m.cx, m.cy);
    await s.page.waitForTimeout(1500);
    r.urlAfterSingleTap = s.page.url();
    results.friends = r;
    await s.context.close();
  },

  // (12) comment sheet physics on Home
  async comments(browser, images, origin) {
    const state = {};
    const s = await openWithRetry(browser, images, origin, 'buyer', '/',
      (p) => p.locator('[data-testid^="comment-btn-"]'), { routes: feedRoutes(state) });
    await s.settle(1500);
    const r = {};
    await s.page.locator('[data-testid^="comment-btn-"]').first().click();
    await s.page.getByTestId('comments-sheet').first().waitFor({ timeout: 15_000 });
    await s.page.waitForTimeout(900);
    r.openDetent = await s.page.locator('[data-testid^="thread-comments-detent-"]').first().getAttribute('data-testid').catch(() => null);
    await s.shot('comments-00-half');
    const sheet = await box(s.page, 'comments-sheet');
    const gx = 195, gy = sheet.y - 8; // the grabber row sits just above the thread
    r.sheetTopHalf = sheet.y;
    // Drag the handle up past the top -> full.
    const up = []; for (let i = 0; i <= 15; i += 1) up.push([{ x: gx, y: lerp(gy, 60, i / 15) }]);
    await touchPath(s.cdp, up, { stepMs: 20 });
    await s.shot('comments-01-dragging-up');
    await touchEnd(s.cdp);
    await s.page.waitForTimeout(900);
    r.detentAfterPullUp = await s.page.locator('[data-testid^="thread-comments-detent-"]').first().getAttribute('data-testid').catch(() => null);
    r.sheetTopFull = (await box(s.page, 'comments-sheet')).y;
    await s.shot('comments-02-full');
    // Flick down from full -> back to half.
    const top = (await box(s.page, 'comments-sheet')).y - 8;
    const flick1 = []; for (let i = 0; i <= 8; i += 1) flick1.push([{ x: gx, y: top + 170 * (i / 8) ** 1.5 }]);
    await touchPath(s.cdp, flick1, { stepMs: 16 });
    await s.shot('comments-02b-dragging-down');
    await touchEnd(s.cdp);
    await s.page.waitForTimeout(900);
    r.detentAfterFlickDown = await s.page.locator('[data-testid^="thread-comments-detent-"]').first().getAttribute('data-testid').catch(() => null);
    await s.shot('comments-03-back-to-half');
    // Flick down from half -> dismissed.
    const top2 = (await box(s.page, 'comments-sheet')).y - 8;
    const flick2 = []; for (let i = 0; i <= 8; i += 1) flick2.push([{ x: gx, y: top2 + 260 * (i / 8) ** 1.5 }]);
    await touchPath(s.cdp, flick2, { stepMs: 16 });
    await touchEnd(s.cdp);
    await s.page.waitForTimeout(1200);
    r.sheetGoneAfterFlick = !(await exists(s.page, 'comments-sheet'));
    await s.shot('comments-04-dismissed');
    results.comments = r;
    await s.context.close();
  },

  // (11) Follow -> Following morph (Discover > People)
  async follow(browser, images, origin) {
    const s = await openWithRetry(browser, images, origin, 'buyer', '/discover',
      (p) => p.getByText('People', { exact: true }));
    await s.settle(800);
    for (let i = 0; i < 4; i += 1) {
      await s.page.getByText('People', { exact: true }).first().click({ force: true });
      try { await s.page.locator('[data-testid="follow-button"]').first().waitFor({ timeout: 8_000 }); break; } catch (e) {
        if (i === 3) { await s.shot('follow-load-fail'); throw e; }
      }
    }
    await s.settle(600);
    const btn = s.page.locator('[data-testid="follow-button"]').first();
    const r = { labelBefore: await btn.getAttribute('aria-label'), widthBefore: (await btn.boundingBox())?.width };
    await s.shot('follow-00-before');
    await btn.click();
    const widths = [];
    for (let i = 0; i < 6; i += 1) {
      widths.push(Math.round(((await btn.boundingBox())?.width ?? 0) * 10) / 10);
      await s.shot(`follow-01-morph-f${i}`);
      await s.page.waitForTimeout(45);
    }
    await s.page.waitForTimeout(400);
    r.widthsDuringMorph = widths;
    r.labelAfter = await btn.getAttribute('aria-label');
    r.widthAfter = (await btn.boundingBox())?.width;
    r.spinnerShown = await s.page.locator('[data-testid="follow-button"] [role="progressbar"]').count();
    await s.shot('follow-02-after');
    results.follow = r;
    await s.context.close();
  },

  // (3) swipe-down dismiss on the product photo viewer + (14) bag tick
  async product(browser, images, origin) {
    const s = await openWithRetry(browser, images, origin, 'buyer', '/buyer-product-detail?productId=prod_nl_hoodie_ember',
      (p) => p.getByTestId('product-add-to-cart'));
    await s.settle(1200);
    const r = {};
    // Bag: add to cart, film the badge.
    r.badgeBefore = await s.page.getByTestId('product-cart-badge').innerText().catch(() => null);
    await s.page.getByTestId('product-add-to-cart').click();
    // The size sheet: pick M, which adds it.
    await s.page.getByText('M', { exact: true }).first().click({ timeout: 8_000 }).catch(() => {});
    await s.page.waitForTimeout(400);
    await s.page.getByText('Add to bag', { exact: true }).last().click({ timeout: 8_000 }).catch(() => {});
    for (let i = 0; i < 6; i += 1) {
      await s.page.getByTestId('product-cart-button').screenshot({ path: path.join(OUT, `product-00-bag-tick-f${i}.png`) }).catch(() => {});
      await s.page.waitForTimeout(50);
    }
    await s.page.waitForTimeout(800);
    r.badgeAfter = await s.page.getByTestId('product-cart-badge').innerText().catch(() => null);
    await s.shot('product-01-after-add');
    // Close any sheet the add opened, then open the photo viewer.
    await s.page.keyboard.press('Escape').catch(() => {});
    await s.page.waitForTimeout(600);
    await tap(s.cdp, 195, 260);
    await s.page.waitForTimeout(1200);
    r.viewerOpen = await exists(s.page, 'photo-viewer-close');
    await s.shot('product-02-viewer-open');
    if (r.viewerOpen) {
      const down = []; for (let i = 0; i <= 14; i += 1) down.push([{ x: lerp(195, 225, i / 14), y: lerp(420, 600, i / 14) }]);
      await touchPath(s.cdp, down, { stepMs: 24 });
      await s.page.waitForTimeout(80);
      await s.shot('product-03-dismiss-drag-mid');
      r.midDragTransform = await s.page.evaluate(() => {
        const imgs = [...document.querySelectorAll('img')].filter((i) => i.getBoundingClientRect().width > 200);
        const el = imgs[0]?.closest('[style*="transform"]');
        return el ? getComputedStyle(el).transform : null;
      });
      await touchEnd(s.cdp);
      await s.page.waitForTimeout(900);
      r.viewerClosedAfterDrag = !(await exists(s.page, 'photo-viewer-close'));
      await s.shot('product-04-after-dismiss');
    }
    results.product = r;
    await s.context.close();
  },
});

Object.assign(STEPS, {
  // (7) swipe-right quote reply, (8) double-tap heart, (9) long-press reaction row
  async dm(browser, images) {
    const devServer = await serveBuild(DEV_BUILD);
    try {
      const s = await openWithRetry(browser, images, devServer.origin, 'seller', '/seller-conversation?id=preview-seller-conversation-01',
        (p) => p.locator('[data-testid^="conversation-bubble-"]:not([data-testid*="swipe"])'), { direct: true });
      await s.settle(1200);
      const r = {};
      await s.shot('dm-00-thread');
      const bubbles = s.page.locator('[data-testid^="conversation-bubble-"]:not([data-testid*="swipe"])');
      r.bubbleCount = await bubbles.count();
      const b = await bubbles.nth(Math.max(0, r.bubbleCount - 2)).boundingBox();
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      // Swipe right -> reply banner.
      const sw = []; for (let i = 0; i <= 12; i += 1) sw.push([{ x: cx + 90 * (i / 12), y: cy }]);
      await touchPath(s.cdp, sw, { stepMs: 20 });
      await s.shot('dm-01-swipe-right-mid');
      await touchEnd(s.cdp);
      await s.page.waitForTimeout(700);
      r.replyBanner = await s.page.getByText(/Replying to/i).first().isVisible().catch(() => false);
      await s.shot('dm-02-reply-banner');
      // Double-tap -> heart.
      await tap(s.cdp, cx, cy); await s.page.waitForTimeout(80); await tap(s.cdp, cx, cy);
      await frames(s, 'dm-03-double-tap-heart', 4, 110);
      await s.page.waitForTimeout(900);
      // Long-press -> reaction row.
      await touchPath(s.cdp, [[{ x: cx, y: cy }]]);
      await s.page.waitForTimeout(900);
      await touchEnd(s.cdp);
      await s.page.waitForTimeout(500);
      await s.shot('dm-04-long-press-reactions');
      r.reactionRowText = (await s.page.locator('body').innerText()).match(/super react|Reply|Copy/gi)?.slice(0, 4) ?? [];
      results.dm = r;
      await s.context.close();
    } finally { devServer.close(); }
  },
});

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
const server = await serveBuild(BUILD);
try {
  for (const [name, step] of Object.entries(STEPS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    try { await step(browser, images, server.origin); } catch (error) { results[name] = { error: String(error?.stack ?? error) }; }
  }
} finally {
  writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await server.close?.();
  await browser.close();
}
console.log(JSON.stringify(results, null, 2).slice(0, 6000));
