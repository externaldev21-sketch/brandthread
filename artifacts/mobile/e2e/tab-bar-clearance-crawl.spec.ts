/**
 * Tab-bar clearance crawl.
 *
 * Dev's report (from a Replit phone-frame preview screenshot): the seller
 * Dashboard's "TRAFFIC SOURCES" heading and "See all" link were visible
 * UNDER the floating tab bar, with content even spilling past the rounded
 * bottom edge of the device frame. Standing rule: "nothing under the tab
 * bar." Root cause and fix:
 *   1. Every screen behind the floating tab bar already pads its scroll
 *      content by `useTabBarMetrics()/useBuyerTabBarInset()`'s
 *      `occupiedHeight` (bar height + bottom offset + safe-area inset, plus
 *      breathing room) — confirmed already wired on Dashboard/Products/
 *      Orders/buyer feed. The actual bug was the web app's outer document
 *      being scrollable/unbounded, letting a phone-frame preview's own
 *      viewport show content beyond what the app itself renders as "the
 *      screen" — fixed by clipping html/body/#root to one viewport with
 *      `overflow: hidden` (see lib/webTextRendering.ts's
 *      injectWebRootClipStyles).
 *   2. A separate, now-deleted bug: `TabBarGlassZone`, a full-width
 *      translucent `backdrop-filter` band that used to sit behind the
 *      floating bar on every tab screen, flickered as the bar animated
 *      (Dev: "I know there's a thin black transparency block that
 *      sometimes pops up and goes away... I know I'm not tripping").
 *      Deleted outright — the only surfaces now allowed behind the tab bar
 *      are the pill-shaped bar segments themselves and the separate round
 *      buttons. No full-width backdrop, blur strip, tint, or scrim of any
 *      kind is allowed to reappear.
 *
 * This crawl scrolls each tab-bar screen to the bottom and asserts:
 *   (a) no text/interactive element's box intersects the tab bar's own box;
 *   (b) no element extends beyond the viewport's bottom edge;
 *   (c) no element wider than 300px in the bottom 120px of the screen has a
 *       translucent background or a backdrop-filter (guards against the
 *       deleted TabBarGlassZone-style band reappearing in any form).
 *
 * Local run:
 *   pnpm exec playwright test e2e/tab-bar-clearance-crawl.spec.ts --config e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function loadHarness() {
  return import('../scripts/store-screenshots/harness.mjs') as Promise<{
    DEFAULT_BUILD_DIR: string;
    launchBrowser: () => Promise<any>;
    openContext: (browser: any, opts: any) => Promise<{ context: any; page: any; activity: any }>;
    serveBuild: (buildDir: string) => Promise<{ origin: string; close: () => void }>;
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

const SCREENS: Array<{ name: string; role: 'buyer' | 'seller'; route: string; tabBarTestId: string }> = [
  { name: 'seller-dashboard', role: 'seller', route: '/(tabs)', tabBarTestId: 'seller-global-tab-bar' },
  { name: 'seller-products', role: 'seller', route: '/(tabs)/products', tabBarTestId: 'seller-global-tab-bar' },
  { name: 'seller-orders', role: 'seller', route: '/(tabs)/orders', tabBarTestId: 'seller-global-tab-bar' },
  { name: 'buyer-feed', role: 'buyer', route: '/(buyer)', tabBarTestId: 'buyer-bottom-tab-bar' },
];

const CLEARANCE_SCAN_SCRIPT = `(() => {
  const tabBarTestId = ${JSON.stringify('__TAB_BAR_TEST_ID__')};
  const bar = document.querySelector('[data-testid="' + tabBarTestId + '"]');
  if (!bar) return { skipped: true, reason: 'tab bar not found' };
  const barRect = bar.getBoundingClientRect();
  const violations = [];

  const rectsIntersect = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    if (el === bar || bar.contains(el) || el.contains(bar)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent && n.textContent.trim());
    const isInteractive = el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT' || el.getAttribute('role') === 'button';
    if (!hasOwnText && !isInteractive) continue;

    // (a) intersects the tab bar's own box.
    if (rectsIntersect(rect, barRect)) {
      violations.push({ kind: 'intersects-tab-bar', tag: el.tagName, text: (el.textContent || '').slice(0, 40), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
      continue;
    }
    // (b) extends beyond the viewport's bottom edge.
    if (rect.bottom > window.innerHeight + 1 && rect.top < window.innerHeight) {
      violations.push({ kind: 'beyond-viewport-bottom', tag: el.tagName, text: (el.textContent || '').slice(0, 40), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
  }

  // (c) no element wider than 300px in the bottom 120px with a translucent
  // background or a backdrop-filter — guards against a TabBarGlassZone-style
  // band reappearing in any form.
  for (const el of all) {
    if (el === bar || bar.contains(el)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 300 || rect.height === 0) continue;
    const bottom120 = window.innerHeight - 120;
    if (rect.bottom <= bottom120) continue; // entirely above the bottom 120px band

    const bg = style.backgroundColor;
    const alphaMatch = bg.match(/rgba?\\(\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*[\\d.]+\\s*,\\s*([\\d.]+)\\s*\\)/);
    const bgAlpha = alphaMatch ? parseFloat(alphaMatch[1]) : (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' ? 1 : 0);
    const isTranslucentFill = bgAlpha > 0 && bgAlpha < 0.999;
    const backdropFilter = style.backdropFilter || style.webkitBackdropFilter;
    const hasBackdropFilter = !!backdropFilter && backdropFilter !== 'none';

    if (isTranslucentFill || hasBackdropFilter) {
      violations.push({ kind: 'wide-translucent-band-near-bottom', tag: el.tagName, backgroundColor: bg, backdropFilter, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
    }
  }

  return { skipped: false, violations };
})()`;

interface ClearanceFailure {
  screen: string;
  kind: string;
  tag: string;
  text?: string;
  backgroundColor?: string;
  backdropFilter?: string;
  rect: { x: number; y: number; width: number; height: number };
}

test.setTimeout(0);

test('every tab-bar screen keeps content clear of the bar at max scroll, with no full-width band behind it', async () => {
  const { DEFAULT_BUILD_DIR, launchBrowser, openContext, serveBuild, waitForQuietNetwork } = await loadHarness();
  const { ensureDemoImages } = await loadDemoImages();

  const outDir = path.join(process.cwd(), 'e2e', '.tab-bar-clearance-crawl-out');
  mkdirSync(outDir, { recursive: true });

  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const failures: ClearanceFailure[] = [];

  try {
    const images = await ensureDemoImages(browser, path.join(outDir, 'images'));
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };

    for (const screen of SCREENS) {
      const { page, activity } = await openContext(browser, { device, role: screen.role, origin, images, seedOptions: { fresh: false } });
      try {
        let landed = '';
        const targetPath = screen.route.split('?')[0];
        for (let attempt = 0; attempt < 5; attempt++) {
          await page.goto(`${origin}/?bt_preview=${screen.role}&demo=1`);
          await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
          await waitForQuietNetwork(activity, 800, 8000).catch(() => {});
          await page.evaluate((url: string) => {
            history.pushState(history.state, '', url);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
          }, `${screen.route}${screen.route.includes('?') ? '&' : '?'}bt_preview=${screen.role}`);
          await waitForQuietNetwork(activity, 800, 8000).catch(() => {});
          await page.waitForTimeout(1200);
          landed = await page.evaluate(() => location.pathname);
          if (landed.startsWith(targetPath) || targetPath === '/(tabs)' && landed === '/' || targetPath === '/(buyer)' && landed === '/') break;
        }

        const acceptAll = await page.$('text=Accept all');
        if (acceptAll) { await acceptAll.click().catch(() => {}); await page.waitForTimeout(300); }

        // Scroll the page's scroll container(s) to the bottom.
        await page.evaluate(() => {
          const scrollers = Array.from(document.querySelectorAll('div')).filter((el) => {
            const style = getComputedStyle(el);
            return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
          });
          for (const el of scrollers) el.scrollTop = el.scrollHeight;
        });
        await page.waitForTimeout(600);

        const script = CLEARANCE_SCAN_SCRIPT.replace('__TAB_BAR_TEST_ID__', screen.tabBarTestId);
        const result = await page.evaluate(script);
        if (!result.skipped) {
          for (const v of result.violations as any[]) {
            failures.push({ screen: screen.name, ...v });
          }
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }

  writeFileSync(path.join(outDir, 'tab-bar-clearance-report.json'), JSON.stringify(failures, null, 2));

  if (failures.length > 0) {
    console.log('Tab-bar clearance violations:', failures.slice(0, 10));
  }
  expect(failures, `tab-bar clearance violations found — see ${path.join(outDir, 'tab-bar-clearance-report.json')}`).toEqual([]);
});
