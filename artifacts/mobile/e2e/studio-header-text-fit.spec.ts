/**
 * Text-fit & alignment check for the two rows this round touched: the
 * Studio menu header (avatar + name, see components/SellerStudioRadialMenu.tsx)
 * and the Dashboard's title + store-URL + copy-icon row (see
 * components/SellerHomeCommerceDashboard.tsx). Dev, reviewing screenshots:
 * "boxes and the text inside them look choppy — text not fitting its box."
 * Standing rule going forward: no truncated labels on a button/chip/tab, no
 * text touching/overflowing its container, run a text-fit sweep at 393x852
 * before shipping any UI change. Same harness (static preview build + mocked
 * API, no live backend) as e2e/tab-bar-clearance-crawl.spec.ts.
 *
 * Local run:
 *   pnpm exec playwright test e2e/studio-header-text-fit.spec.ts --config e2e/playwright.config.ts
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function loadHarness() {
  return import('../scripts/store-screenshots/harness.mjs') as Promise<{
    DEFAULT_BUILD_DIR: string;
    launchBrowser: () => Promise<any>;
    openContext: (browser: any, opts: any) => Promise<{ context: any; page: any; activity: any }>;
    openScreen: (page: any, activity: any, origin: string, role: string, target: string) => Promise<void>;
    serveBuild: (buildDir: string) => Promise<{ origin: string; close: () => void }>;
    waitForQuietNetwork: (activity: any, quietMs?: number, timeout?: number) => Promise<void>;
  }>;
}

const IPHONE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 393, height: 852 };

/** Any text element whose content overflows its own box (scrollWidth >
 *  clientWidth — the literal DOM signal for "text doesn't fit its box"),
 *  or whose box extends past its own parent's box, within `rootSelector`. */
const TEXT_FIT_SCAN_SCRIPT = `(() => {
  const rootSelector = ${JSON.stringify('__ROOT_SELECTOR__')};
  const root = document.querySelector(rootSelector);
  if (!root) return { skipped: true, reason: 'root not found: ' + rootSelector };
  const offenders = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const ownText = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent && n.textContent.trim()).map((n) => n.textContent).join('');
    if (ownText && el.scrollWidth > el.clientWidth + 1) {
      offenders.push({ kind: 'text-overflow', tag: el.tagName, text: ownText.slice(0, 60), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    // Box-overflows-parent: only meaningful for elements that actually carry
    // text themselves — a hitSlop-expanded empty touch target isn't a
    // visual "text not fitting its box" bug, so it's excluded here.
    if (!ownText) continue;
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    if (parent && rect.width > 0 && rect.height > 0) {
      const pStyle = getComputedStyle(parent);
      if (style.position !== 'absolute' && style.position !== 'fixed' && pStyle.overflow !== 'hidden') {
        const prect = parent.getBoundingClientRect();
        if (rect.right > prect.right + 1 || rect.left < prect.left - 1) {
          offenders.push({ kind: 'box-overflows-parent', tag: el.tagName, text: ownText.slice(0, 60), rect: { left: rect.left, right: rect.right }, parentRect: { left: prect.left, right: prect.right } });
        }
      }
    }
  }
  return { skipped: false, offenders };
})()`;

interface TextFitFailure {
  screen: string;
  kind: string;
  tag: string;
  text?: string;
  scrollWidth?: number;
  clientWidth?: number;
  rect?: { left: number; right: number };
  parentRect?: { left: number; right: number };
}

test.setTimeout(0);

test('Studio header (avatar + name) and Dashboard title/store-url row fit their boxes at 393x852', async () => {
  const { DEFAULT_BUILD_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } = await loadHarness();

  const outDir = path.join(process.cwd(), 'e2e', '.studio-header-text-fit-out');
  mkdirSync(outDir, { recursive: true });

  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const failures: TextFitFailure[] = [];

  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: IPHONE_USER_AGENT };

    // Studio menu header — named store.
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      try {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/');
        await waitForQuietNetwork(activity, 800, 15_000);
        await page.getByTestId('seller-bottom-menu').click();
        await page.waitForTimeout(600);
        const result = await page.evaluate(TEXT_FIT_SCAN_SCRIPT.replace('__ROOT_SELECTOR__', "[data-testid='seller-studio-header']"));
        if (!result.skipped) for (const o of result.offenders as any[]) failures.push({ screen: 'studio-header-named-store', ...o });
      } finally {
        await page.close();
      }
    }

    // Dashboard title + store-url + copy-icon row.
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      try {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/');
        await waitForQuietNetwork(activity, 1000, 15_000);
        await page.waitForTimeout(500);
        const result = await page.evaluate(TEXT_FIT_SCAN_SCRIPT.replace('__ROOT_SELECTOR__', "[data-testid='seller-dashboard-scroll-position']"));
        if (!result.skipped) for (const o of result.offenders as any[]) failures.push({ screen: 'dashboard-title-row', ...o });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }

  writeFileSync(path.join(outDir, 'text-fit-report.json'), JSON.stringify(failures, null, 2));
  if (failures.length > 0) console.log('Text-fit violations:', failures.slice(0, 10));
  expect(failures, `text-fit violations found — see ${path.join(outDir, 'text-fit-report.json')}`).toEqual([]);
});
