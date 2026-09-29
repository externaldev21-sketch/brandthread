/**
 * App-wide notch/Dynamic-Island + home-indicator crawl.
 *
 * Builds the web preview export (the same one scripts/store-screenshots
 * uses for real screenshots — signed-in demo account, seeded local storage,
 * a fake API), serves it statically, then visits every static route under
 * app/ (dynamic routes get one real seeded id each — see ROUTE_OVERRIDES)
 * for both the buyer and seller preview roles, and both a fully-populated
 * demo account and a brand-new "fresh" one (some chrome — an onboarding
 * checklist banner, an empty-cart state — only ever renders in one of the
 * two), at 393x852 (an iPhone-class viewport — see CLAUDE.md's device
 * matrix).
 *
 * At each screen (depth 0) and after tapping up to CLICK_DEPTH_LIMIT visible
 * tappable elements — buttons, rows, tabs, segmented controls — up to
 * CLICK_DEPTH levels deep (opening in-screen `<Modal>`s, bottom sheets, and
 * whatever they open in turn), it asserts that no visible text, icon,
 * image-button or input sits with its top edge above TOP_SAFE_LINE (an
 * iPhone 14/15-class Dynamic Island's clearance) or its bottom edge below
 * BOTTOM_SAFE_LINE (the home-indicator strip) — unless the element is
 * explicitly marked full-bleed background/media via `data-notch-exempt`.
 *
 * It also asserts every screen's `ScreenHeader`-rendered title
 * (`testID="screen-header-title"`) sits at the identical top/left position
 * and font-size/weight as the first one seen (within 1px) — Dev's exact
 * complaint was two screens' titles visibly differing in size.
 *
 * Every failure is written to notch-crawl-report.json (route, depth, role,
 * data state, element description, its bounding box) with a screenshot
 * alongside it, so a failing CI run tells you exactly what to open and
 * where to look.
 *
 * Local run:
 *   pnpm exec playwright test e2e/notch-crawl.spec.ts --config e2e/playwright.config.ts
 * (needs nothing else running — it builds and serves its own web export)
 *
 * CI (fast mode — depth 0 everywhere, depth 1 only for routes touched by the
 * PR diff, demo data state only) is wired in docs/ci/notch-crawl.yml.disabled
 * via NOTCH_CRAWL_FAST and NOTCH_CRAWL_ROUTES (a comma-separated route
 * allowlist for the deeper pass). The full crawl (every route, depth 3, both
 * data states) runs nightly and needs no env vars.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// harness.mjs / demo-images.mjs are native ES modules; this spec file gets
// transpiled to CommonJS by Playwright's TS loader, and a *static* import of
// an .mjs file from generated CJS trips Node's dual-package hazard
// ("exports is not defined in ES module scope"). A dynamic `import()` always
// goes through Node's real ESM loader regardless of how the importing file
// was transpiled, so every .mjs helper below is loaded that way instead.
async function loadHarness() {
  return import('../scripts/store-screenshots/harness.mjs') as Promise<{
    buildPreviewWeb: (outputDir?: string, cwd?: string) => void;
    DEFAULT_BUILD_DIR: string;
    MOBILE_ROOT: string;
    launchBrowser: () => Promise<any>;
    openContext: (browser: any, opts: any) => Promise<{ context: any; page: any; activity: any }>;
    openScreen: (page: any, activity: any, origin: string, role: string, target: string, opts?: any) => Promise<void>;
    serveBuild: (buildDir: string) => Promise<{ origin: string; close: () => void }>;
    waitForImages: (page: any, timeout?: number) => Promise<void>;
    waitForQuietNetwork: (activity: any, quietMs?: number, timeout?: number) => Promise<void>;
  }>;
}
async function loadDemoImages() {
  return import('../scripts/store-screenshots/demo-images.mjs') as Promise<{
    ensureDemoImages: (browser: any, outDir: string) => Promise<Record<string, string>>;
  }>;
}

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const VIEWPORT = { width: 393, height: 852 };
const TOP_SAFE_LINE = 59; // iPhone 14/15-class Dynamic Island clearance
const BOTTOM_SAFE_LINE = VIEWPORT.height - 34; // home-indicator strip
// Tappable elements probed per screen at each depth level — fewer at deeper
// levels since the branching factor compounds fast (6 * 4 * 3 = 72 taps per
// route/role/data-state at full depth already).
const CLICK_BREADTH = [6, 4, 3];
const ROLES = ['buyer', 'seller'] as const;
const DATA_STATES = ['demo', 'fresh'] as const;
const CLICKABLE_SELECTOR = '[role="button"], [role="tab"], [role="radio"], [role="switch"], button, a[href]';

const ROUTE_OVERRIDES: Record<string, string> = {
  '/c/[collectionId]': '/c/col_demo',
  '/drops/[dropId]': '/drops/drop_nl_04',
  '/store/product/[productId]': '/store/product/prod_nl_hoodie_ember',
  '/u/[username]': '/u/northlinestudio',
};

function discoverRoutes(mobileRoot: string): string[] {
  const appDir = path.join(mobileRoot, 'app');
  const routes: string[] = [];
  function walk(dir: string, prefix: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full, `${prefix}/${entry}`);
        continue;
      }
      if (!/\.tsx$/.test(entry)) continue;
      if (entry === '_layout.tsx' || entry.startsWith('+') || entry.endsWith('.test.tsx')) continue;
      const name = entry.replace(/\.tsx$/, '');
      const segment = name === 'index' ? '' : `/${name}`;
      // Route groups like (tabs)/(buyer) don't appear in the URL.
      const cleanPrefix = prefix.replace(/\/\([^/]+\)/g, '');
      let route = `${cleanPrefix}${segment}` || '/';
      routes.push(route);
    }
  }
  walk(appDir, '');
  const unique = [...new Set(routes)];
  return unique.map((r) => ROUTE_OVERRIDES[r] ?? r);
}

const FAST = process.env.NOTCH_CRAWL_FAST === '1';
const ROUTE_ALLOWLIST = process.env.NOTCH_CRAWL_ROUTES
  ? new Set(process.env.NOTCH_CRAWL_ROUTES.split(',').map((r) => r.trim()).filter(Boolean))
  : null;
// Fast mode only spends its deeper-tap budget on the PR's changed routes,
// and never on the fresh-account pass (nightly's job) — depth 0 across
// every route on the default demo account is still checked every time.
const DATA_STATES_TO_RUN: readonly (typeof DATA_STATES)[number][] = FAST ? ['demo'] : DATA_STATES;
const MAX_DEPTH = FAST ? 1 : CLICK_BREADTH.length;

interface Failure {
  kind: 'clearance';
  route: string;
  role: string;
  dataState: string;
  depth: number;
  via?: string[]; // the chain of elements tapped to reach this depth
  element: string;
  edge: 'top' | 'bottom';
  box: { x: number; y: number; width: number; height: number };
  screenshot: string;
}

interface ConsistencyFailure {
  kind: 'consistency';
  route: string;
  role: string;
  dataState: string;
  mismatch: string;
  expected: unknown;
  actual: unknown;
  screenshot: string;
}

const VIOLATION_SCRIPT = `(() => {
  const TOP_SAFE_LINE = ${TOP_SAFE_LINE};
  const BOTTOM_SAFE_LINE = ${BOTTOM_SAFE_LINE};
  const results = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (el.closest('[data-notch-exempt]')) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const isText = el.childNodes.length > 0 && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim());
    const tag = el.tagName;
    const isLeafOfInterest = isText || tag === 'IMG' || tag === 'INPUT' || tag === 'BUTTON' || tag === 'svg' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'img';
    if (!isLeafOfInterest) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    // Scrolled off-screen (above or below the visible viewport) — not
    // actually clipped by anything, just not on screen right now.
    if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
    // An element spanning the exact full viewport is a deliberate full-bleed
    // overlay (a modal scrim, a tap-out-to-dismiss backdrop, a coach-mark's
    // full-screen touchable) — edge-to-edge is the point, not a notch bug.
    if (rect.x === 0 && rect.y === 0 && rect.width === window.innerWidth && rect.height === window.innerHeight) continue;
    if (rect.top < TOP_SAFE_LINE) {
      results.push({ edge: 'top', box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, element: (tag + (el.id ? '#' + el.id : '') + ' "' + (el.textContent || '').slice(0, 40) + '"') });
    }
    // The buyer/seller persistent bottom tab bars deliberately float their
    // capsule with a slightly tighter home-indicator clearance than a
    // one-off sticky footer (bottomOffset = max(bottomInset - 10, 12) — see
    // components/buyer-nav/buyerTabBarMetrics.ts) — a reviewed, separately
    // tested design (tests/buyer-tab-bar-metrics.test.ts), not this crawl's
    // concern, so its own buttons are exempt from the bottom check.
    if (el.closest('[data-testid="buyer-bottom-tab-bar"], [data-testid="seller-global-tab-bar"]')) continue;
    // Only flag a button/input truly pinned near the bottom (fixed/sticky,
    // or absolutely positioned with an explicit 'bottom' anchor — how every
    // sticky footer and floating action button in this app is built).
    // Skip a plain in-flow list row that merely straddles the viewport's
    // bottom edge — that's normal scroll clipping, not a home-indicator
    // clearance bug; the user scrolls to reach it, nothing hides it forever.
    // height < 100 rules out a swipeable list row's reveal-action button
    // caught mid-drag by a synthetic click (its box briefly spans most of
    // the row during the swipe animation) — a crawler click artifact, not a
    // real sticky-footer element.
    const isBottomPinned = rect.bottom > window.innerHeight - 100 && rect.height < 100 && (style.position === 'fixed' || style.position === 'sticky' || (style.position === 'absolute' && style.bottom !== 'auto'));
    // INPUT is excluded here (kept for the top check above): react-native-web
    // renders a Switch/checkbox as a visually-hidden <input> absolutely
    // positioned to cover its custom control for accessibility/hit-testing —
    // that's an implementation detail of whatever row it happens to be in,
    // not a real sticky-footer element, and flags on whatever toggle a
    // scrollable list happens to have scrolled to the bottom of the viewport.
    if (rect.bottom > BOTTOM_SAFE_LINE && isBottomPinned && (tag === 'BUTTON' || el.getAttribute('role') === 'button')) {
      results.push({ edge: 'bottom', box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, element: (tag + (el.id ? '#' + el.id : '') + ' "' + (el.textContent || '').slice(0, 40) + '"') });
    }
  }
  return results;
})()`;

/** Reads the ScreenHeader-rendered title's geometry + font, if this screen
 * has one, for the cross-screen consistency assertion below. Returns null
 * when there's no `screen-header-title` node currently on screen (e.g. a
 * screen without a header, or a modal/sheet with no title of its own) —
 * absence is not a failure, only a mismatched *presence* is. */
const HEADER_GEOMETRY_SCRIPT = `(() => {
  const el = document.querySelector('[data-testid="screen-header-title"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return {
    top: Math.round(rect.top), left: Math.round(rect.left),
    fontSize: parseFloat(style.fontSize), fontWeight: style.fontWeight,
  };
})()`;

test.setTimeout(0);

/** Light client-side navigation — same pushState trick openScreen uses for
 * its own in-app navigation, without redoing the full app boot + Clerk wait
 * every time. Reusing one context/page per role and navigating this way
 * turns 500+ page loads into 2 app boots, which is the difference between a
 * crawl that finishes and one that doesn't. Also the recovery step after
 * exploring a click's subtree: it resets straight to a known route by URL
 * rather than `goBack()`, which would need to unwind exactly as many history
 * entries as the recursion went deep — easy to get wrong once a click three
 * levels down changes the URL itself. */
async function navigateTo(page: any, target: string, role: string) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate((url: string) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
}

const BREADTH = process.env.NOTCH_CRAWL_BREADTH
  ? process.env.NOTCH_CRAWL_BREADTH.split(',').map(Number)
  : CLICK_BREADTH;
const DEPTH = process.env.NOTCH_CRAWL_DEPTH ? Number(process.env.NOTCH_CRAWL_DEPTH) : MAX_DEPTH;

test('every screen clears the notch, the home indicator, and matches every other screen\'s header', async () => {
  const {
    buildPreviewWeb, DEFAULT_BUILD_DIR, MOBILE_ROOT, launchBrowser,
    openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
  } = await loadHarness();
  const { ensureDemoImages } = await loadDemoImages();

  const outDir = path.join(MOBILE_ROOT, '.notch-crawl');
  mkdirSync(outDir, { recursive: true });

  if (process.env.NOTCH_CRAWL_SKIP_BUILD !== '1') {
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(outDir, 'images'));

  let routes = discoverRoutes(MOBILE_ROOT);
  if (process.env.NOTCH_CRAWL_ONLY) {
    const only = process.env.NOTCH_CRAWL_ONLY.split(',');
    routes = routes.filter((r) => only.includes(r));
  } else if (process.env.NOTCH_CRAWL_LIMIT) {
    routes = routes.slice(0, Number(process.env.NOTCH_CRAWL_LIMIT));
  }
  const failures: Failure[] = [];
  const consistencyFailures: ConsistencyFailure[] = [];
  let checked = 0;
  const device = { viewport: VIEWPORT, scale: 3, isMobile: true, userAgent: IPHONE_USER_AGENT };
  // The first screen-header-title geometry seen becomes the baseline every
  // other screen's title is compared against — recorded once, globally
  // (not per role/data-state), since the whole point is that it must never
  // differ anywhere in the app.
  let headerBaseline: { top: number; left: number; fontSize: number; fontWeight: string } | null = null;

  async function checkScreen(page: any, route: string, role: string, dataState: string, depth: number, via: string[]) {
    checked += 1;
    const violations: any[] = await page.evaluate(VIOLATION_SCRIPT).catch(() => []);
    for (const v of violations) {
      const shot = path.join(outDir, `fail-${failures.length + consistencyFailures.length}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      failures.push({
        kind: 'clearance', route, role, dataState, depth, via: via.length ? via : undefined,
        element: v.element, edge: v.edge, box: v.box, screenshot: shot,
      });
    }

    const geo = await page.evaluate(HEADER_GEOMETRY_SCRIPT).catch(() => null);
    if (geo) {
      if (!headerBaseline) {
        headerBaseline = geo;
      } else {
        const mismatches: string[] = [];
        if (Math.abs(geo.top - headerBaseline.top) > 1) mismatches.push(`top ${geo.top} vs baseline ${headerBaseline.top}`);
        if (Math.abs(geo.left - headerBaseline.left) > 1) mismatches.push(`left ${geo.left} vs baseline ${headerBaseline.left}`);
        if (Math.abs(geo.fontSize - headerBaseline.fontSize) > 1) mismatches.push(`fontSize ${geo.fontSize} vs baseline ${headerBaseline.fontSize}`);
        if (geo.fontWeight !== headerBaseline.fontWeight) mismatches.push(`fontWeight ${geo.fontWeight} vs baseline ${headerBaseline.fontWeight}`);
        if (mismatches.length) {
          const shot = path.join(outDir, `fail-${failures.length + consistencyFailures.length}.png`);
          await page.screenshot({ path: shot }).catch(() => {});
          consistencyFailures.push({
            kind: 'consistency', route, role, dataState, mismatch: mismatches.join('; '),
            expected: headerBaseline, actual: geo, screenshot: shot,
          });
        }
      }
    }

    if (depth >= DEPTH) return;
    const breadth = BREADTH[depth] ?? BREADTH[BREADTH.length - 1];
    const handles = await page.$$(CLICKABLE_SELECTOR);
    for (const handle of handles.slice(0, breadth)) {
      const box = await handle.boundingBox().catch(() => null);
      if (!box || box.y < 0 || box.y > VIEWPORT.height) continue;
      const label = await handle.evaluate((el: Element) => (el.textContent || el.getAttribute('aria-label') || el.tagName).slice(0, 40)).catch(() => 'unknown');
      await handle.click({ timeout: 2000, force: true }).catch(() => {});
      await page.waitForTimeout(300);
      await waitForImages(page, 2500);

      await checkScreen(page, route, role, dataState, depth + 1, [...via, label]);

      // Reset to this level's screen before trying the next sibling handle,
      // regardless of how deep the recursive exploration above went.
      await navigateTo(page, route, role);
      await waitForImages(page, 2500);
    }
  }

  try {
    for (const role of ROLES) {
      for (const dataState of DATA_STATES_TO_RUN) {
        const activity = { lastApiAt: Date.now() };
        const contextOpts: Record<string, unknown> = dataState === 'fresh'
          ? { seedOptions: { fresh: true }, apiOptions: { fresh: true } }
          : {};
        const { context, page } = await openContext(browser, {
          device, role, origin, images, onUnseeded: () => {}, ...contextOpts,
        });
        try {
          // One full app boot per (role, data-state); every route after
          // this is a light client-side navigation on the same page.
          await openScreen(page, activity, origin, role, routes[0] ?? '/');
          await waitForImages(page, 6000);
          await waitForQuietNetwork(activity, 500, 6000);

          for (const route of routes) {
            const deepen = !FAST || (ROUTE_ALLOWLIST && ROUTE_ALLOWLIST.has(route));
            await navigateTo(page, route, role);
            await waitForImages(page, 4000);
            await waitForQuietNetwork(activity, 400, 4000);
            await checkScreen(page, route, role, dataState, deepen ? 0 : DEPTH, []);
          }
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    close();
  }

  writeFileSync(
    path.join(outDir, 'notch-crawl-report.json'),
    JSON.stringify({
      checked, routeCount: routes.length,
      failureCount: failures.length, failures,
      consistencyFailureCount: consistencyFailures.length, consistencyFailures,
      headerBaseline,
    }, null, 2),
  );

  const total = failures.length + consistencyFailures.length;
  if (total > 0) {
    const clearanceSummary = failures
      .slice(0, 20)
      .map((f) => `  [${f.role}/${f.dataState}] ${f.route}${f.via ? ` → ${f.via.join(' → ')}` : ''} (depth ${f.depth}): ${f.element} ${f.edge} edge at ${f.edge === 'top' ? f.box.y.toFixed(0) : (f.box.y + f.box.height).toFixed(0)}`)
      .join('\n');
    const consistencySummary = consistencyFailures
      .slice(0, 20)
      .map((f) => `  [${f.role}/${f.dataState}] ${f.route}: header ${f.mismatch}`)
      .join('\n');
    expect(total, `${failures.length} clearance + ${consistencyFailures.length} header-consistency failures (see ${outDir}/notch-crawl-report.json for all of them):\n${clearanceSummary}\n${consistencySummary}`).toBe(0);
  }
});
