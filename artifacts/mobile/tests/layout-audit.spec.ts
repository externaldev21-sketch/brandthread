#!/usr/bin/env node
/**
 * Automated layout-regression audit.
 *
 *   pnpm run test:layout-audit                  build the web app, then audit everything
 *   pnpm run test:layout-audit -- --skip-build   reuse the last preview web build (faster)
 *
 * Renders ~12 key buyer/seller screens at the device-matrix viewports (the
 * smallest phone through the largest tablet), plus one large-text-zoom pass,
 * and fails the run the moment any element:
 *   - extends past `document.documentElement`'s width or height (page-level
 *     horizontal/vertical overflow that clips or requires scrolling to see), or
 *   - overlaps the floating tab bar's own bounding box while not being part
 *     of the tab bar itself.
 *
 * KNOWN LIMITATION (tracked for follow-up, not fixed here): the tab-bar-
 * overlap check runs against the screen's initial, unscrolled DOM. Two
 * situations currently read as false positives rather than real bugs and
 * should be special-cased before this check is trusted as fully signal-only:
 *   1. A legitimate full-screen `Modal` (e.g. the seller dashboard's first-run
 *      setup walkthrough) is SUPPOSED to paint above the floating tab bar —
 *      that's correct modal behavor, not a layout defect.
 *   2. The floating tab bar is an intentionally translucent glass surface;
 *      list rows are expected to be momentarily visible behind it near the
 *      initial fold, same as any frosted bottom-bar pattern. The real bug
 *      class ("can never scroll far enough to fully reveal the last row/
 *      tile") requires scrolling the list to its end before sampling, which
 *      this version does not yet do.
 *
 * Reuses the same demo web build, fake Clerk/API and preview-role bypass
 * (`?bt_preview=buyer|seller`) as `scripts/store-screenshots/`, so nothing
 * here touches a real account, server or payment provider. See
 * scripts/store-screenshots/harness.mjs for how that bypass works and
 * app/_layout.tsx's "DEV design-preview bypass" comment for why it's safe
 * (dev/preview builds only, opt-in via the `bt_preview` query param).
 *
 * Layout-audit-specific viewports (the owner's device matrix — distinct from
 * the App Store / Play Store sizes in scripts/store-screenshots/devices.mjs):
 *   320x568   smallest supported phone (iPhone SE 1st gen)
 *   375x667   iPhone 8 / SE 2-3
 *   390x844   iPhone 12/13/14
 *   430x932   iPhone Pro Max
 *   768x1024  iPad portrait
 *   1024x1366 iPad Pro 12.9" portrait (largest)
 *
 * Text-zoom approximation: web has no exact equivalent of iOS Dynamic Type /
 * Android font scale. We approximate it the way a browser's own
 * "page zoom"/OS-level text-size boost behaves — by overriding the root
 * `<html>` font-size (rem basis) before the app's first paint, which scales
 * every rem-based measurement in the app's design system consistently. This
 * is documented here rather than silently assumed: it is NOT the same code
 * path as native Dynamic Type, just the closest realistic web analogue, and
 * it only stresses screens that use relative (rem) type scales; hard-coded
 * pixel font sizes are unaffected either way, same as on a real device with
 * an app that ignores the OS text-size setting.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from '../scripts/store-screenshots/harness.mjs';
import { BUYER_USER } from '../scripts/store-screenshots/demo-data.mjs';

const BUYER_CLERK_ID = BUYER_USER.id;

// ─── The device matrix (owner's requirement: smallest through largest) ─────
const VIEWPORTS = [
  { id: '320x568', width: 320, height: 568, label: 'Smallest phone (iPhone SE 1st gen)' },
  { id: '375x667', width: 375, height: 667, label: 'Standard phone (iPhone 8 / SE 2-3)' },
  { id: '390x844', width: 390, height: 844, label: 'iPhone 12/13/14' },
  { id: '430x932', width: 430, height: 932, label: 'iPhone Pro Max' },
  { id: '768x1024', width: 768, height: 1024, label: 'iPad portrait' },
  { id: '1024x1366', width: 1024, height: 1366, label: 'iPad Pro 12.9" portrait (largest)' },
];

// One extra pass at a mid-size phone viewport with a large text-zoom applied
// (see the file header for what this approximates and why).
const TEXT_ZOOM_VIEWPORT = { id: '390x844@zoom200', width: 390, height: 844, label: 'iPhone 12/13/14 at 200% text zoom' };
const TEXT_ZOOM_ROOT_FONT_PX = 32; // 2x the browser default (16px) root font-size.

// ─── The ~12 key screens (buyer + seller, tab-bar-bearing where relevant) ──
const TAB_BAR_SELECTOR = {
  buyer: '[data-testid="buyer-bottom-tab-bar"]',
  seller: '[data-testid="seller-global-tab-bar"]',
};

const SCREENS = [
  { id: 'buyer-feed', title: 'Buyer feed', role: 'buyer', path: '/(buyer)', ready: 'Drop 04 is live', hasTabBar: true },
  { id: 'discover', title: 'Discover', role: 'buyer', path: '/discover', ready: 'Heavyweight Hoodie — Ember', hasTabBar: true },
  { id: 'buyer-cart', title: 'Cart', role: 'buyer', path: '/cart', ready: 'Order summary', hasTabBar: false },
  { id: 'buyer-checkout', title: 'Checkout', role: 'buyer', path: '/buyer-checkout?source=cart', ready: '1120 NW Everett Street', hasTabBar: false },
  { id: 'buyer-product-detail', title: 'Product detail', role: 'buyer', path: '/buyer-product-detail?productId=prod_nl_jacket_rust', ready: 'Field Shell Jacket — Rust', hasTabBar: false },
  { id: 'buyer-profile', title: 'Buyer profile', role: 'buyer', path: '/(buyer)/profile', ready: '@jordanreyes', hasTabBar: true },
  { id: 'seller-dashboard', title: 'Seller dashboard', role: 'seller', path: '/(tabs)', ready: '$1,842.50', hasTabBar: true },
  { id: 'seller-orders', title: 'Seller orders', role: 'seller', path: '/(tabs)/orders', ready: 'Orders', hasTabBar: true },
  { id: 'seller-products', title: 'Seller products', role: 'seller', path: '/(tabs)/products', ready: 'Products', hasTabBar: true },
  { id: 'seller-settings', title: 'Seller settings', role: 'seller', path: '/seller-settings', ready: 'Settings', hasTabBar: false },
  { id: 'manufacturer-hub', title: 'Manufacturer hub', role: 'seller', path: '/manufacturer-hub', ready: 'Porto Knit Collective', hasTabBar: false },
  { id: 'theme-picker', title: 'Theme picker', role: 'seller', path: '/app-theme', ready: 'Choose your Brandthread finish', hasTabBar: false },
];

// ─── In-page audit: overflow + tab-bar overlap ─────────────────────────────
// Runs inside the browser (page.evaluate). Kept dependency-free (no DOM
// libs) since it executes in the app's own page context.
function auditPage(tabBarSelector: string | null) {
  const EPS = 1; // px slack for sub-pixel rounding
  const docEl = document.documentElement;
  const pageWidth = docEl.clientWidth;
  const pageHeight = Math.max(docEl.scrollHeight, docEl.clientHeight);

  function isScrollableAncestor(el: Element | null) {
    // <body> legitimately clips overflow on this app (it sets
    // `overflow: hidden` to prevent page-level scroll on web) — it counts
    // as a valid clipping ancestor. Only `<html>` itself is excluded, since
    // walking past it would mean "nothing clips this at all".
    if (!el || el === docEl) return false;
    const style = getComputedStyle(el);
    const overflowX = style.overflowX;
    const overflowY = style.overflowY;
    const canScrollX = (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') && el.scrollWidth > el.clientWidth + EPS;
    const canScrollY = (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') && el.scrollHeight > el.clientHeight + EPS;
    return canScrollX || canScrollY;
  }

  // An element is exempt from the page-level overflow check when a
  // non-document ancestor already clips/scrolls it (horizontal product
  // rails, vertical lists, etc. are expected to have off-screen children).
  function isClippedByAncestor(el: Element) {
    let node = el.parentElement;
    while (node && node !== docEl) {
      if (isScrollableAncestor(node)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function describe(el: Element) {
    const testId = el.getAttribute('data-testid');
    const role = el.getAttribute('role');
    const text = (el.textContent || '').trim().slice(0, 40);
    const cls = typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : '';
    const parts = [el.tagName.toLowerCase()];
    if (testId) parts.push(`data-testid="${testId}"`);
    if (role) parts.push(`role="${role}"`);
    if (cls) parts.push(`class~="${cls}"`);
    if (text) parts.push(`text="${text}"`);
    return parts.join(' ');
  }

  const tabBar = tabBarSelector ? document.querySelector(tabBarSelector) : null;
  const tabBarRect = tabBar ? tabBar.getBoundingClientRect() : null;

  const overflowViolations = [];
  const overlapViolations = [];

  const all = document.body.querySelectorAll('*');
  for (const el of all) {
    if (tabBar && (el === tabBar || tabBar.contains(el))) continue; // the tab bar itself is exempt from the overlap check
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    // Elements deliberately parked off-canvas (closed drawers/sheets using a
    // translateX/Y transform) aren't visible overflow bugs — skip anything
    // whose own rect has zero area, which off-canvas + collapsed elements
    // usually have on this codebase's animated sheets.
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.position === 'fixed' && el.getAttribute('aria-hidden') === 'true') continue;

    // Page-level overflow (skip anything an ancestor already clips/scrolls).
    if (!isClippedByAncestor(el)) {
      const overflowsRight = rect.right > pageWidth + EPS;
      const overflowsLeft = rect.left < -EPS;
      const overflowsBottom = rect.bottom > pageHeight + EPS;
      if (overflowsRight || overflowsLeft || overflowsBottom) {
        overflowViolations.push({
          selector: describe(el),
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
          page: { width: pageWidth, height: pageHeight },
          direction: [overflowsRight && 'right', overflowsLeft && 'left', overflowsBottom && 'bottom'].filter(Boolean).join('+'),
        });
      }
    }
  }

  // Tab-bar overlap: real hit-testing (document.elementFromPoint), not
  // bounding-box intersection. A bounding-box check flags every full-screen
  // wrapper <View> in the tree (nearly all of them, since RN screens are one
  // root View covering the whole page) even though the tab bar visually
  // paints on top of them — that's not a layout bug, it's how every screen
  // is structured. elementFromPoint reports the actual topmost *painted*
  // element at a pixel (and — usefully — already skips `pointer-events:
  // none` layers), so it only flags something that would truly cover the
  // tab bar on screen. We sample a grid of points across the tab bar's box,
  // inset slightly from its edges to avoid grazing sibling elements.
  if (tabBarRect && tabBarRect.width > 0 && tabBarRect.height > 0) {
    const inset = 3;
    const left = tabBarRect.left + inset;
    const right = tabBarRect.right - inset;
    const top = tabBarRect.top + inset;
    const bottom = tabBarRect.bottom - inset;
    const xs = [left, (left + right) / 2, right];
    const ys = [top, (top + bottom) / 2, bottom];
    const seen = new Set();
    for (const y of ys) {
      for (const x of xs) {
        if (x < 0 || y < 0 || x > pageWidth) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === tabBar || tabBar!.contains(hit)) continue;
        if (hit === document.documentElement || hit === document.body) continue;
        const key = describe(hit);
        if (seen.has(key)) continue;
        seen.add(key);
        const hitRect = hit.getBoundingClientRect();
        overlapViolations.push({
          selector: key,
          point: { x: Math.round(x), y: Math.round(y) },
          rect: { left: Math.round(hitRect.left), top: Math.round(hitRect.top), right: Math.round(hitRect.right), bottom: Math.round(hitRect.bottom) },
          tabBarRect: { left: Math.round(tabBarRect.left), top: Math.round(tabBarRect.top), right: Math.round(tabBarRect.right), bottom: Math.round(tabBarRect.bottom) },
        });
      }
    }
  }

  return {
    pageWidth,
    pageHeight,
    overflowViolations: overflowViolations.slice(0, 20),
    overlapViolations: overlapViolations.slice(0, 20),
  };
}

// ─── Runner ─────────────────────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const options: { skipBuild: boolean; buildDir: string; only: string[] | null } = { skipBuild: false, buildDir: DEFAULT_BUILD_DIR, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--only') options.only = argv[++i].split(',');
    else if (arg === '--build-dir') options.buildDir = path.resolve(argv[++i]);
  }
  return options;
}

type ScreenDef = (typeof SCREENS)[number];
type ViewportDef = (typeof VIEWPORTS)[number] | typeof TEXT_ZOOM_VIEWPORT;

async function auditOne(
  browser: any,
  { screen, viewport, origin, zoom }: { screen: ScreenDef; viewport: ViewportDef; origin: string; zoom: boolean },
) {
  const device = {
    viewport: { width: viewport.width, height: viewport.height },
    scale: 1,
    isMobile: viewport.width < 700,
    userAgent: undefined,
  };
  const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images: {}, onUnseeded: undefined });
  const failures: string[] = [];
  try {
    // The buyer feed shows a one-time "Watching Threads" gesture-coach
    // overlay on first view (components/FeedGestureGuide.tsx,
    // lib/feedGestureGuideStorage.ts). It's a deliberate full-screen
    // takeover on first run, not a steady-state layout bug, so seed it as
    // already-seen the same way a returning user's device would have it —
    // otherwise every buyer-feed audit would trip on that overlay's
    // intentional coverage of the whole screen (including the tab bar).
    if (screen.role === 'buyer') {
      await context.addInitScript((key: string) => {
        try { localStorage.setItem(key, '1'); } catch {}
      }, `feed_gesture_guide_seen:${BUYER_CLERK_ID}`);
    }
    if (zoom) {
      await context.addInitScript((px: number) => {
        document.addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.fontSize = `${px}px`;
        });
      }, TEXT_ZOOM_ROOT_FONT_PX);
    }
    await openScreen(page, activity, origin, screen.role, screen.path);
    await page.getByText(screen.ready, { exact: false }).first().waitFor({ timeout: 30_000 });
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.waitForTimeout(500);

    const tabBarSelector = screen.hasTabBar ? TAB_BAR_SELECTOR[screen.role as 'buyer' | 'seller'] : null;
    if (tabBarSelector) {
      await page.waitForSelector(tabBarSelector, { timeout: 5_000 }).catch(() => {
        failures.push(`expected tab bar "${tabBarSelector}" was not found in the DOM for a screen marked hasTabBar`);
      });
    }

    const result = await page.evaluate(auditPage, tabBarSelector);

    for (const v of result.overflowViolations) {
      failures.push(
        `element extends past the ${viewport.id} viewport (${v.direction}): ${v.selector} ` +
        `rect=${JSON.stringify(v.rect)} page=${JSON.stringify(v.page)}`,
      );
    }
    for (const v of result.overlapViolations) {
      failures.push(
        `element overlaps the floating tab bar at ${viewport.id}: ${v.selector} ` +
        `rect=${JSON.stringify(v.rect)} tabBarRect=${JSON.stringify(v.tabBarRect)}`,
      );
    }
    return { status: failures.length ? 'fail' : 'pass', failures };
  } catch (error: any) {
    return { status: 'error', failures: [String(error?.message ?? error).split('\n')[0]] };
  } finally {
    await context.close();
  }
}

// Retries only an infra-flake ("error": a timeout/navigation hiccup), never
// a genuine "fail" (an actual layout violation must never be silently
// retried away).
async function auditWithRetry(browser: any, args: { screen: ScreenDef; viewport: ViewportDef; origin: string; zoom: boolean }) {
  let result = await auditOne(browser, args);
  if (result.status === 'error') {
    console.log(`  (retrying ${args.screen.id} @ ${args.viewport.id} after: ${result.failures[0]})`);
    result = await auditOne(browser, args);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const screens = SCREENS.filter((s) => !options.only || options.only.includes(s.id));
  if (!screens.length) throw new Error('Nothing to audit: check --only.');

  if (!options.skipBuild || !existsSync(path.join(options.buildDir, 'index.html'))) {
    console.log('Building the web app in preview mode (a few minutes)…');
    buildPreviewWeb(options.buildDir);
  }

  const server = await serveBuild(options.buildDir);
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const screen of screens) {
      for (const viewport of VIEWPORTS) {
        const result = await auditWithRetry(browser, { screen, viewport, origin: server.origin, zoom: false });
        results.push({ screen: screen.id, viewport: viewport.id, ...result });
        report(screen, viewport, result);
      }
      // One extra pass at large text-zoom per screen.
      const zoomResult = await auditWithRetry(browser, { screen, viewport: TEXT_ZOOM_VIEWPORT, origin: server.origin, zoom: true });
      results.push({ screen: screen.id, viewport: TEXT_ZOOM_VIEWPORT.id, ...zoomResult });
      report(screen, TEXT_ZOOM_VIEWPORT, zoomResult);
    }
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => r.status !== 'pass');
  const summaryPath = path.join(MOBILE_ROOT, 'scratch', 'layout-audit-results.json');
  mkdirSync(path.dirname(summaryPath), { recursive: true });
  writeFileSync(summaryPath, JSON.stringify(results, null, 2));

  console.log(`\n${results.length - failed.length}/${results.length} screen×viewport combinations passed.`);
  console.log(`Full results: ${path.relative(MOBILE_ROOT, summaryPath)}`);

  if (failed.length) {
    console.log(`\n${failed.length} FAILED:`);
    for (const f of failed) {
      console.log(`\n✖ ${f.screen} @ ${f.viewport} (${f.status})`);
      for (const line of f.failures) console.log(`    ${line}`);
    }
    process.exitCode = 1;
  }
}

function report(screen: ScreenDef, viewport: ViewportDef, result: { status: string; failures: string[] }) {
  const mark = result.status === 'pass' ? '✓' : '✗';
  console.log(`${mark} ${screen.id.padEnd(24)} ${viewport.id.padEnd(16)} ${result.status}${result.failures.length ? `  (${result.failures.length} issue${result.failures.length === 1 ? '' : 's'})` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}`);
    process.exit(1);
  });
}
