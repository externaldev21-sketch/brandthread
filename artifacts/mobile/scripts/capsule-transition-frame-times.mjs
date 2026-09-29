#!/usr/bin/env node
/**
 * Frame-time measurement for the buyer capsule compact<->regular transition
 * (Home <-> any other tab). Real (non-reduced) motion — reduced motion would
 * just snap instantly and hide exactly the jank being measured.
 *
 *   node scripts/capsule-transition-frame-times.mjs
 *   node scripts/capsule-transition-frame-times.mjs --skip-build
 *
 * Hooks requestAnimationFrame in-page to log frame deltas, taps through
 * Threads -> Discover -> Inbox -> Profile -> Threads N times, and reports
 * the worst frame time and how many frames exceeded 20ms during each leg.
 */
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  BUYER_USER, DEMO_TIME_ZONE, IMAGE_HOST, localStorageSeed, respond,
} from './store-screenshots/demo-data.mjs';
import { clerkStubScript } from './store-screenshots/clerk-stub.mjs';

const VIEWPORT = { width: 390, height: 844 };
const DEMO_API = 'https://api.brandthread.test';
const ROUND_TRIPS = Number(process.argv.find(a => a.startsWith('--trips='))?.split('=')[1] ?? 10);

/** Same as harness.mjs's openContext, but with real motion (no reduced-motion
 *  override) so the capsule's spring/timing actually plays out across
 *  frames — see PR notes for why context.clock.install() is also skipped
 *  (it stalls Reanimated's real-motion timing entirely in this sandbox). */
async function openMotionContext(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    locale: 'en-US',
    timezoneId: DEMO_TIME_ZONE,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  });
  await context.addInitScript(clerkStubScript(BUYER_USER));
  await context.addInitScript((seed) => {
    if (sessionStorage.getItem('bt:screenshot-seeded')) return;
    for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
    localStorage.setItem('bt:intro-splash:launched:v1', 'true');
    sessionStorage.setItem('bt:screenshot-seeded', '1');
  }, localStorageSeed('buyer', {}));

  const activity = { lastApiAt: Date.now() };
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === (globalThis.__origin)) return route.continue();
    if (url.origin === IMAGE_HOST) return route.fulfill({ status: 404, body: '' });
    if (url.origin === DEMO_API) {
      const cors = {
        'access-control-allow-origin': globalThis.__origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      activity.lastApiAt = Date.now();
      const body = respond({ method: request.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
      if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":{"code":"NOT_SEEDED","message":"Not part of the demo data"}}' });
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    }
    return route.abort();
  });

  const page = await context.newPage();
  await page.bringToFront();
  return { context, page, activity };
}

/** Installs a rAF hook that records every frame's own delta (ms since the
 *  previous frame) into `window.__frames` from the moment it's called. */
async function startFrameLog(page) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    let raf = 0;
    const tick = (t) => {
      window.__frames.push(t - last);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    window.__stopFrameLog = () => cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  });
}

async function readFrames(page) {
  const frames = await page.evaluate(() => window.__frames.slice());
  await page.evaluate(() => { window.__stopFrameLog?.(); window.__frames = []; });
  return frames;
}

function summarize(frames) {
  // Drop the first frame of each window (delta from before the log started).
  const ds = frames.slice(1);
  const max = ds.length ? Math.max(...ds) : 0;
  const over20 = ds.filter(d => d > 20).length;
  return { max, over20, count: ds.length };
}

async function tapAndMeasure(page, testId, settleMs) {
  await startFrameLog(page);
  await page.getByTestId(testId).click();
  await page.waitForTimeout(settleMs);
  return summarize(await readFrames(page));
}

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  globalThis.__origin = origin;
  const browser = await launchBrowser();
  await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images')); // warms the cache; buyer run doesn't need real images

  const { context, page, activity } = await openMotionContext(browser);
  page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
  // Home ('/') itself is a heavy full-bleed autoplay-video screen that's
  // slow/unreliable to settle in this harness (reproducible on an
  // unmodified checkout, unrelated to the tab bar) — start on Discover
  // instead and reach Home via a normal tab press like every other leg.
  await openScreenReliably(page, activity, origin, 'buyer', '/discover');
  await page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 20_000 });
  await page.waitForTimeout(400);
  await waitForImages(page);

  const legs = [
    ['discover -> index', 'buyer-tab-index'],
    ['index -> inbox', 'buyer-tab-inbox'],
    ['inbox -> profile', 'buyer-tab-profile'],
    ['profile -> index', 'buyer-tab-index'],
    ['index -> discover', 'buyer-tab-discover'],
  ];
  const totals = new Map(legs.map(([name]) => [name, { max: 0, over20: 0, count: 0 }]));

  for (let trip = 0; trip < ROUND_TRIPS; trip += 1) {
    for (const [name, testId] of legs) {
      const result = await tapAndMeasure(page, testId, 400);
      const t = totals.get(name);
      t.max = Math.max(t.max, result.max);
      t.over20 += result.over20;
      t.count += result.count;
    }
  }

  console.log(`\n${ROUND_TRIPS} round trips, per-leg worst frame + total frames >20ms:`);
  for (const [name] of legs) {
    const t = totals.get(name);
    console.log(`  ${name.padEnd(20)} worst=${t.max.toFixed(1)}ms  frames>20ms=${t.over20}/${t.count}`);
  }

  await context.close();
  await browser.close();
  close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
