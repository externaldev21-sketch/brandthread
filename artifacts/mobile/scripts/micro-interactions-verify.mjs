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
  DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const val = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const OUT = path.resolve(val('--out', path.join(MOBILE_ROOT, 'scratch', 'micro-interactions')));
const BUILD = path.resolve(val('--build-dir', DEFAULT_BUILD_DIR));
const ONLY = val('--only', null)?.split(',');
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

async function open(browser, images, origin, role, target, { contextOptions = {}, routes } = {}) {
  const { context, page, activity } = await openContext(browser, {
    device: DEVICE, role, origin, images, contextOptions: { reducedMotion: 'no-preference', ...contextOptions },
  });
  if (routes) await routes(context);
  await openScreen(page, activity, origin, role, target);
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
function feedRoutes(state) {
  return async (context) => {
    await context.route(/api\.brandthread\.test\/api\/(v1\/)?(posts\/feed|public\/posts|posts\/for-you|feed\/for-you)/, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const base = Array.from({ length: 5 }, (_, i) => ({
        id: `post_mi_${i + 1}`, userId: 'user_seller_northline',
        seller: { brandName: 'Northline Studio', displayName: 'Northline Studio' },
        caption: i === 0 ? 'Three looks, one jacket.' : `Look ${i + 1}`,
        mediaType: 'photo',
        mediaUrls: i === 0 ? [img('story-rust'), img('story-mono'), img('hoodie-moss')] : [img(['runner-rust', 'hoodie-moss', 'story-mono', 'cargo-rust'][i - 1])],
        mediaUrl: img('story-rust'), likesCount: 100 + i, commentsCount: 3, repostsCount: 1,
        createdAt: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
      }));
      const rows = state.fresh ? [{ ...base[1], id: 'post_mi_fresh', caption: 'Just posted' }, ...base] : base;
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
    const r = { feedRequestsAtStart: state.feedRequests ?? 0 };
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
    await frames(s, 'home-03-double-tap-heart', 5, 110);
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
