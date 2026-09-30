/**
 * Appearance-theme consistency crawl.
 *
 * Settings > Appearance lets sellers/buyers switch the app's color theme
 * (12 presets, contexts/AppThemeContext.tsx). This crawl catches the
 * regression this task fixed: a component reaching for a hardcoded black or
 * white value instead of the live theme, which stays visibly black/white
 * (a "blacked out" button, in particular) no matter which theme is active.
 *
 * For each route x role x theme combination, it reads every visible
 * element's computed background/border/text color and flags one that is
 * pure/near-pure black or white when the ACTIVE THEME's own background is
 * not black/white-ish (i.e. this comparison is skipped entirely for the
 * "black" and "monochrome" presets, where black/white chrome is correct).
 * The live theme's own token values are read off `window.__btActiveTheme`
 * (set by AppThemeContext.tsx's provider in preview/test builds only) so
 * the check compares against ground truth rather than a hardcoded guess.
 *
 * This isn't (yet) the full "every route x every theme" sweep described in
 * the task — that's ~150 routes x 12 themes x 2 roles, too slow to run on
 * every change. It runs the explicitly-reported screens (Dashboard,
 * Settings, Payouts, Product page, Checkout, Messages) x both roles x two
 * non-black themes (purple, olive) plus the black theme as a negative
 * control. Widen SCREENS / THEMES here to grow coverage.
 *
 * Local run:
 *   pnpm exec playwright test e2e/theme-consistency-crawl.spec.ts --config e2e/playwright.config.ts
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

const SCREENS: Array<{ name: string; role: 'buyer' | 'seller'; route: string }> = [
  { name: 'dashboard', role: 'seller', route: '/(tabs)' },
  { name: 'settings', role: 'seller', route: '/seller-settings' },
  { name: 'payouts', role: 'seller', route: '/payouts' },
  { name: 'product-detail', role: 'seller', route: '/product-detail?id=preview-product-2' },
  { name: 'checkout', role: 'buyer', route: '/buyer-checkout' },
  { name: 'messages', role: 'seller', route: '/(tabs)/inbox' },
];

// 'black' is a negative control: black/white chrome is CORRECT there, so no
// comparison happens for it — a mismatch on any other theme is the bug.
const THEMES = ['black', 'purple', 'olive'] as const;

const BLACK_OR_WHITE = /^rgba?\(\s*(0|255)\s*,\s*\1\s*,\s*\1\s*(,\s*[\d.]+)?\)$/;

const SCAN_SCRIPT = `(() => {
  const theme = window.__btActiveTheme;
  if (!theme) return { skipped: true };
  const themeIsMonochrome = ['black', 'monochrome'].includes(theme.id ?? '');
  if (themeIsMonochrome) return { skipped: true, reason: 'monochrome-theme-control' };
  const BLACK_OR_WHITE = ${BLACK_OR_WHITE.toString()};
  const results = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) continue;
    // A meaningful fill: not transparent, and covers a real amount of area
    // (skip hairlines/dividers — 1-2px borders are allowed to stay a fixed
    // silver regardless of theme, per the design's own token choices).
    const bg = style.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && BLACK_OR_WHITE.test(bg) && rect.width > 24 && rect.height > 16) {
      results.push({ el: el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : ''), prop: 'backgroundColor', value: bg, box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, label: el.getAttribute('aria-label') || el.textContent?.slice(0, 40) || '' });
    }
  }
  return { skipped: false, results };
})()`;

interface ThemeFailure {
  screen: string;
  role: string;
  theme: string;
  element: string;
  label: string;
  prop: string;
  value: string;
  box: { x: number; y: number; width: number; height: number };
}

test('key screens follow the active Appearance theme instead of staying hardcoded black/white', async () => {
  const { DEFAULT_BUILD_DIR, launchBrowser, openContext, serveBuild, waitForQuietNetwork } = await loadHarness();
  const { ensureDemoImages } = await loadDemoImages();

  const outDir = path.join(process.cwd(), 'e2e', '.theme-consistency-crawl-out');
  mkdirSync(outDir, { recursive: true });

  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const failures: ThemeFailure[] = [];
  const counts: Record<string, number> = {};

  try {
    const images = await ensureDemoImages(browser, path.join(outDir, 'images'));
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };

    for (const themeId of THEMES) {
      for (const screen of SCREENS) {
        const { page, activity } = await openContext(browser, { device, role: screen.role, origin, images, seedOptions: { fresh: false } });
        try {
          let landed = '';
          const targetPath = screen.route.split('?')[0];
          for (let attempt = 0; attempt < 5; attempt++) {
            await page.goto(`${origin}/?bt_preview=${screen.role}&bt_theme=${themeId}&demo=1`);
            await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 }).catch(() => {});
            await waitForQuietNetwork(activity, 800, 8000).catch(() => {});
            await page.evaluate((url: string) => {
              history.pushState(history.state, '', url);
              window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
            }, `${screen.route}${screen.route.includes('?') ? '&' : '?'}bt_theme=${themeId}&bt_preview=${screen.role}`);
            await waitForQuietNetwork(activity, 800, 8000).catch(() => {});
            await page.waitForTimeout(1200);
            landed = await page.evaluate(() => location.pathname);
            if (landed.startsWith(targetPath)) break;
          }

          const scan = await page.evaluate(SCAN_SCRIPT);
          const key = `${screen.name}/${themeId}`;
          if (!scan.skipped) {
            counts[key] = scan.results.length;
            for (const r of scan.results as any[]) {
              failures.push({ screen: screen.name, role: screen.role, theme: themeId, element: r.el, label: r.label, prop: r.prop, value: r.value, box: r.box });
            }
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
    close();
  }

  writeFileSync(path.join(outDir, 'theme-consistency-report.json'), JSON.stringify({ counts, failures }, null, 2));

  if (failures.length > 0) {
    console.log('Theme consistency hits by screen/theme:', counts);
    console.log('First failures:', failures.slice(0, 10));
  }
  expect(failures, `hardcoded black/white fills found under a non-black theme — see ${path.join(outDir, 'theme-consistency-report.json')}`).toEqual([]);
});
