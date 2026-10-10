#!/usr/bin/env node
/**
 * Web performance harness.
 *
 * Serves the static web export (artifacts/mobile/static-build, built via
 * `pnpm run build`) and uses Playwright to visit each route, recording
 * standard browser timing: Time to First Byte, First Contentful Paint,
 * DOMContentLoaded and Load.
 *
 * These are real browser metrics (not app-level console logs), so they
 * work the same whether the export was built in dev or production mode —
 * that's the fairest way to compare the two, since dev-mode JS is
 * unminified and includes extra checks (see PERF_NOTES.md).
 *
 * Only the statically pre-rendered public routes (`PUBLIC_ROUTES` in
 * scripts/build-web.js) are reachable without a live backend + signed-in
 * Clerk session, so those are what this script measures by default.
 * Once pointed at an environment with a real API server and a logged-in
 * session (e.g. a staging deploy), pass --routes to add authenticated
 * buyer/seller routes such as /buyer-product-detail or /(tabs)/products.
 *
 * Usage:
 *   pnpm run build                 # produces static-build/
 *   node scripts/perf-harness.mjs [--base-url http://localhost:PORT] [--routes /a,/b]
 *
 * App mode (`--screens`): cold start, time-to-interactive per main screen and
 * dropped frames while scrolling the feed, at 390x844 in a fresh (cold-cache)
 * browser context per load, median of `--runs` (default 3):
 *   node scripts/perf-harness.mjs --screens [--runs 3] [--throttle] [--json] [--only feed]
 * Signed-out screens work on any export. The demo=1 buyer/seller screens need
 * the preview-enabled export used for screenshots:
 *   EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST=1 pnpm run build
 * (plus EXPO_PUBLIC_PERF_MARKS=1 to also read the app's own marks from
 * lib/perf.ts). --throttle emulates a mid-range phone on 4G: 4x CPU slowdown,
 * 10 Mbit/s down, 40 ms latency.
 *
 * TTI here is browser-observed and works on any build: the end of the last
 * long task or content (DOM text/child) change before 1.5 s of quiet. When
 * the build has perf marks, the app's own `bt-tti:<screen>` mark is shown
 * next to it.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DEFAULT_ROUTES = ['/', '/privacy', '/terms', '/community-guidelines'];

const DEMO = 'demo=1';
/** Main screens for --screens. `cold` marks the launch screens (their TTI is the cold start). */
const APP_SCREENS = [
  { name: 'landing (static, signed-out)', path: '/', cold: true },
  { name: 'app shell (signed-out)', path: '/privacy', cold: true },
  { name: 'feed', path: `/?bt_preview=buyer&${DEMO}`, cold: true, mark: 'feed', feed: true, scroll: true },
  { name: 'discover', path: `/discover?bt_preview=buyer&${DEMO}`, mark: 'discover', scroll: true },
  { name: 'search', path: `/buyer-search?bt_preview=buyer&${DEMO}`, mark: 'search' },
  { name: 'product detail', path: `/buyer-product-detail?productId=prod_nl_jacket_rust&bt_preview=buyer&${DEMO}`, mark: 'product-detail' },
  { name: 'bag', path: `/cart?bt_preview=buyer&${DEMO}`, mark: 'bag' },
  { name: 'checkout', path: `/buyer-checkout?bt_preview=buyer&${DEMO}`, mark: 'checkout' },
  { name: 'inbox', path: `/inbox?bt_preview=buyer&${DEMO}`, mark: 'inbox' },
  { name: 'profile', path: `/profile?bt_preview=buyer&${DEMO}`, mark: 'profile' },
  { name: 'seller dashboard', path: `/?bt_preview=seller&${DEMO}`, cold: true, mark: 'seller-dashboard' },
];

function parseArgs(argv) {
  const args = { baseUrl: null, routes: DEFAULT_ROUTES, port: 4173, screens: false, runs: 3, throttle: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-url') args.baseUrl = argv[++i];
    else if (argv[i] === '--routes') args.routes = argv[++i].split(',').map((r) => r.trim()).filter(Boolean);
    else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10);
    else if (argv[i] === '--screens') args.screens = true;
    else if (argv[i] === '--runs') args.runs = Math.max(1, parseInt(argv[++i], 10) || 1);
    else if (argv[i] === '--throttle') args.throttle = true;
    else if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--only') args.only = argv[++i];
  }
  return args;
}

// Injected before any page script: records long tasks and content changes
// (child/text mutations; style-only animation frames are ignored) for TTI.
function installObservers() {
  const h = { longTasks: [], lastMutation: 0, modulesEvaluated: 0 };
  window.__btHarness = h;
  // Count JS modules actually evaluated (not just shipped): wrap each module
  // factory as Metro's runtime registers it via the global `__d`.
  try {
    let define;
    Object.defineProperty(globalThis, '__d', {
      configurable: true,
      get: () => define,
      set: (realDefine) => {
        define = function (factory, ...rest) {
          return realDefine.call(this, function (...args) {
            h.modulesEvaluated += 1;
            return factory.apply(this, args);
          }, ...rest);
        };
      },
    });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) h.longTasks.push(e.startTime + e.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  const watch = () => {
    try {
      new MutationObserver(() => { h.lastMutation = performance.now(); })
        .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    } catch {}
  };
  if (document.documentElement) watch();
  else document.addEventListener('DOMContentLoaded', watch);
}

const QUIET_MS = 1500;
const TTI_CAP_MS = 20000;

async function waitForInteractive(page) {
  const started = Date.now();
  for (;;) {
    const s = await page.evaluate(() => {
      const h = window.__btHarness || { longTasks: [], lastMutation: 0 };
      const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
      return {
        now: performance.now(),
        fcp: fcp ? fcp.startTime : null,
        lastBusy: Math.max(h.lastMutation, ...h.longTasks, 0),
      };
    });
    if (s.fcp !== null && s.now - s.lastBusy >= QUIET_MS) return Math.round(Math.max(s.fcp, s.lastBusy));
    if (Date.now() - started > TTI_CAP_MS) return null;
    await page.waitForTimeout(100);
  }
}

// The feed needs posts to scroll. The harness runs without a backend, so the
// feed's public-posts request is answered with plain grey photo posts (test
// fixture for this script only; the app itself never sees fake data). The
// feed still needs a Clerk publishable key in the build to request them; a
// build without one keeps the feed on its loading state and the scroll
// sample is reported as not valid.
const FIXTURE_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#2c2c2e"/></svg>',
);
function feedFixturePosts(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    userId: `harness-seller-${i % 3}`,
    seller: { brandName: `Harness Studio ${i % 3}`, username: `harness${i % 3}` },
    caption: `Harness post ${i}`,
    mediaType: 'photo',
    mediaUrls: [FIXTURE_IMAGE],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
}
async function routeFeedFixture(page) {
  // Reachability probe (lib/offlineState.ts): any HTTP answer means online.
  await page.route(/\/api\/healthz/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }));
  await page.route(/\/api\/(v1\/)?public\/posts\?/, (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset') || 0);
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(offset > 0 ? [] : feedFixturePosts(12)) });
  });
}

async function dismissOverlays(page) {
  for (const label of ['Necessary only', 'Tap to keep watching']) {
    const target = page.getByText(label, { exact: true });
    if (await target.count()) {
      await target.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
}

async function sampleScroll(page) {
  await dismissOverlays(page);
  await page.mouse.move(195, 422);
  await page.evaluate(() => {
    const stamps = [];
    window.__btFrames = stamps;
    const loop = (t) => { stamps.push(t); if (window.__btFrames === stamps) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 844);
    await page.waitForTimeout(700);
  }
  return page.evaluate(() => {
    const stamps = window.__btFrames || [];
    window.__btFrames = null;
    const deltas = stamps.slice(1).map((t, i) => t - stamps[i]).filter((d) => d > 0);
    if (!deltas.length) return null;
    const vsync = Math.min(33.4, Math.max(8.3, Math.min(...deltas)));
    const dropped = deltas.reduce((n, d) => n + Math.max(0, Math.round(d / vsync) - 1), 0);
    const app = (globalThis.__btPerf && globalThis.__btPerf.frames) || [];
    const scrolled = [...document.querySelectorAll('*')].some((e) => e.scrollTop > 0);
    return { scrolled, frames: stamps.length, dropped, worstMs: Math.round(Math.max(...deltas)), appSamples: app.length, appDropped: app.reduce((n, f) => n + f.droppedFrames, 0) };
  });
}

async function measureScreen(browser, baseUrl, screen, throttle) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  if (throttle) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: 1_310_720, uploadThroughput: 655_360 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(installObservers);
  if (screen.feed) await routeFeedFixture(page);
  let jsBytes = 0;
  page.on('response', async (res) => {
    if (!/\.js(\?|$)/.test(res.url())) return;
    try { jsBytes += (await res.body()).length; } catch {}
  });
  await page.goto(`${baseUrl}${screen.path}`, { waitUntil: 'load', timeout: 60_000 });
  const tti = await waitForInteractive(page);
  const info = await page.evaluate((markName) => {
    const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    const appMark = markName ? performance.getEntriesByName(`bt-tti:${markName}`)[0] : null;
    const cold = globalThis.__btPerf && globalThis.__btPerf.coldStart;
    return {
      fcp: fcp ? Math.round(fcp.startTime) : null,
      appTti: appMark ? Math.round(appMark.startTime) : null,
      appColdStart: cold ? cold.processToInteractiveMs ?? cold.jsToInteractiveMs : null,
      modules: window.__btHarness ? window.__btHarness.modulesEvaluated : null,
      hasContent: ((document.getElementById('root') || document.body).innerText || '').trim().length > 0,
    };
  }, screen.mark ?? null);
  const frames = screen.scroll && info.hasContent ? await sampleScroll(page) : null;
  await context.close();
  return { ...info, tti, jsKb: Math.round(jsBytes / 1024), frames };
}

const median = (values) => {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

async function runScreens(browser, baseUrl, args) {
  const rows = [];
  for (const screen of APP_SCREENS.filter((s) => !args.only || s.name.includes(args.only))) {
    const runs = [];
    for (let i = 0; i < args.runs; i++) {
      try {
        runs.push(await measureScreen(browser, baseUrl, screen, args.throttle));
      } catch (error) {
        runs.push({ error: String(error) });
      }
    }
    const pick = (key) => median(runs.map((r) => r[key]));
    const frameRuns = runs.map((r) => r.frames).filter(Boolean);
    rows.push({
      screen: screen.name,
      cold: !!screen.cold,
      fcp: pick('fcp'),
      tti: pick('tti'),
      appTti: pick('appTti'),
      appColdStart: pick('appColdStart'),
      jsKb: pick('jsKb'),
      modules: pick('modules'),
      content: runs.some((r) => r.hasContent),
      droppedFrames: frameRuns.length ? median(frameRuns.map((f) => f.dropped)) : null,
      frames: frameRuns.length ? median(frameRuns.map((f) => f.frames)) : null,
      worstFrameMs: frameRuns.length ? median(frameRuns.map((f) => f.worstMs)) : null,
      feedScrolled: frameRuns.some((f) => f.scrolled),
      appDroppedFrames: frameRuns.length && frameRuns.some((f) => f.appSamples) ? median(frameRuns.map((f) => f.appDropped)) : null,
    });
  }
  return rows;
}

function printScreens(rows, args) {
  const fmt = (v, suffix = '') => (v === null || v === undefined ? '—' : `${v}${suffix}`);
  console.log(`\nApp screens — 390x844, cold cache, median of ${args.runs}${args.throttle ? ', throttled (4x CPU, 10 Mbit/s, 40 ms)' : ''}`);
  const header = ['Screen', 'FCP', 'TTI', 'App TTI mark', 'JS loaded', 'Modules run', 'Content'];
  const body = rows.map((r) => [
    r.screen + (r.cold ? ' *' : ''), fmt(r.fcp, ' ms'), fmt(r.tti, ' ms'), fmt(r.appTti, ' ms'), fmt(r.jsKb, ' KB'), fmt(r.modules), r.content ? 'yes' : 'no',
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of body) console.log(line(row));
  console.log('* launch screen: its TTI is the cold start (navigation start → interactive).');
  for (const row of rows.filter((r) => r.frames !== null)) {
    console.log(`\n${row.screen} scroll (6 pages${row.feedScrolled ? '' : ' — the list did not move; not a valid sample'}): ` +
      `${row.droppedFrames} dropped of ${row.frames} frames, worst frame ${row.worstFrameMs} ms` +
      (row.appDroppedFrames !== null ? `; in-app sampler: ${row.appDroppedFrames} dropped` : ''));
  }
  if (!rows.some((r) => r.frames !== null)) {
    console.log('\nScroll: not measured (the demo=1 screens did not render — build with EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST=1).');
  }
}

async function measureRoute(page, baseUrl, route) {
  const url = `${baseUrl}${route}`;
  const start = Date.now();
  const response = await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  const status = response ? response.status() : null;
  // The Expo Router web export hydrates client-side after `load`; give the
  // first paint a moment to land before reading paint timing.
  await page.waitForTimeout(500);

  const timing = await page.evaluate(() => {
    const [nav] = performance.getEntriesByType('navigation');
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find((p) => p.name === 'first-contentful-paint');
    return {
      ttfb: nav ? Math.round(nav.responseStart - nav.requestStart) : null,
      domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load: nav ? Math.round(nav.loadEventEnd) : null,
      firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null,
      transferSizeKb: nav ? Math.round(nav.transferSize / 1024) : null,
    };
  });

  return {
    route,
    status,
    wallClockMs: Date.now() - start,
    ...timing,
  };
}

function findPinnedChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = '/opt/pw-browsers';
  if (!fs.existsSync(root)) return null;
  const candidate = fs
    .readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
    .map((name) => path.join(root, name, 'chrome-linux', 'chrome'))
    .find((p) => fs.existsSync(p));
  return candidate ?? null;
}

function printTable(results) {
  const cols = ['route', 'status', 'ttfb', 'firstContentfulPaint', 'domContentLoaded', 'load', 'transferSizeKb'];
  const header = ['Route', 'HTTP', 'TTFB (ms)', 'FCP (ms)', 'DCL (ms)', 'Load (ms)', 'Transfer (KB)'];
  const rows = results.map((r) => cols.map((c) => String(r[c] ?? '—')));
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const fmt = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(fmt(row));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let baseUrl = args.baseUrl;
  let server = null;

  if (!baseUrl) {
    const staticBuildDir = path.join(projectRoot, 'static-build');
    if (!fs.existsSync(staticBuildDir)) {
      console.error('static-build/ not found. Run `pnpm run build` first, or pass --base-url for an already-running server.');
      process.exit(1);
    }
    process.env.PORT = String(args.port);
    ({ server } = await import('../server/serve.js'));
    await new Promise((resolve) => server.listen(args.port, '0.0.0.0', resolve));
    baseUrl = `http://localhost:${args.port}`;
    console.log(`Serving static-build/ at ${baseUrl}`);
  }

  const { chromium } = await import('playwright');
  // Prefer a pre-installed browser (some CI/sandbox images pin a chromium
  // build under /opt/pw-browsers that doesn't exactly match this project's
  // Playwright version) so this script doesn't require a network fetch of
  // a matching browser build. Falls back to Playwright's own resolution
  // (PLAYWRIGHT_BROWSERS_PATH / a normal `playwright install`) otherwise.
  const launchOptions = { executablePath: findPinnedChromium() };
  const browser = await chromium.launch(
    launchOptions.executablePath ? launchOptions : {},
  );
  if (args.screens) {
    const rows = await runScreens(browser, baseUrl, args);
    await browser.close();
    if (server) server.close();
    if (args.json) console.log(JSON.stringify(rows, null, 2));
    else printScreens(rows, args);
    return rows;
  }

  const page = await browser.newPage();

  const results = [];
  for (const route of args.routes) {
    try {
      results.push(await measureRoute(page, baseUrl, route));
    } catch (error) {
      results.push({ route, status: 'ERROR', wallClockMs: null, error: String(error) });
    }
  }

  await browser.close();
  if (server) server.close();

  printTable(results);
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
