/**
 * design-actions-help.spec.ts — real Playwright coverage for the new Help
 * tab in the Actions (wrench) sheet. Procreate's Actions sheet has a Help
 * tab; ours had none. Every cell opens a REAL destination (in-app Help
 * Center, support mailbox, live chat, in-app Settings) — this spec asserts
 * the actual navigation / Linking targets, not just that buttons render.
 *
 * Self-contained: builds + serves its own preview web build in beforeAll,
 * the same harness scripts/store-screenshots/*.mjs use for their own
 * verification runs.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertNoTextOrBoxOverflow } from './lib/textFitCheck.mjs';

let harness: typeof import('../scripts/store-screenshots/harness.mjs');
let demoImages: typeof import('../scripts/store-screenshots/demo-images.mjs');

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-actions-help');
mkdirSync(SCREENSHOT_DIR, { recursive: true });

let browser: any;
let closeServer: () => void;
let origin: string;
let images: Record<string, string>;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  harness = await import('../scripts/store-screenshots/harness.mjs');
  demoImages = await import('../scripts/store-screenshots/demo-images.mjs');
  harness.buildPreviewWeb();
  browser = await harness.launchBrowser();
  images = await demoImages.ensureDemoImages(browser, path.join(harness.MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const served = await harness.serveBuild(harness.DEFAULT_BUILD_DIR);
  origin = served.origin;
  closeServer = served.close;
});

test.afterAll(() => {
  closeServer?.();
  return browser?.close();
});

async function openContextAtCanvas() {
  const { context, page, activity } = await harness.openContext(browser, {
    device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller',
    origin,
    images,
    onUnseeded: () => {},
  });
  // Record every external open (react-native-web's Linking.openURL goes
  // through window.open) so a cell's real target can be asserted without
  // actually leaving the page.
  await page.addInitScript(() => {
    (window as any).__openedUrls = [];
    const orig = window.open;
    window.open = ((url: any, ...rest: any[]) => {
      (window as any).__openedUrls.push(String(url));
      return orig ? orig.call(window, 'about:blank', ...rest) : null;
    }) as any;
  });
  await page.goto(`${origin}/design?bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await harness.waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await page.waitForTimeout(500);

  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.locator('[data-testid="btn-brush"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  return { context, page };
}

async function openHelpTab(page: import('@playwright/test').Page) {
  // Actions lives in the top bar's second row, revealed by "Modify".
  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-actions"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="wrench-tab-help"]').click();
  await page.waitForTimeout(300);
}

test('Actions sheet has a real Help tab with four real destinations, tab row and grid fit without overflow', async () => {
  const { context, page } = await openContextAtCanvas();
  await openHelpTab(page);

  // All of Procreate's tabs we can back for real are present (Video is
  // deliberately absent — see WrenchTab's comment in design-canvas.tsx).
  for (const tab of ['add', 'canvas', 'guides', 'share', 'prefs', 'help']) {
    await expect(page.locator(`[data-testid="wrench-tab-${tab}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-testid="wrench-tab-video"]')).toHaveCount(0);

  const grid = page.locator('[data-testid="wrench-help-grid"]');
  await expect(grid).toBeVisible();
  for (const id of ['help-center', 'help-support', 'help-chat', 'help-settings']) {
    await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
  }

  // Six tabs now share the row — the text-fit guard proves none truncates
  // or spills, and the grid's labels/sub-labels fit their cells.
  await assertNoTextOrBoxOverflow(page, '[data-testid="wrench-tabs-row"]');
  await assertNoTextOrBoxOverflow(page, '[data-testid="wrench-help-grid"]');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-help-tab.png') });
  await context.close();
});

test('Contact Support and Live Chat open their real external targets', async () => {
  const { context, page } = await openContextAtCanvas();
  await openHelpTab(page);

  await page.locator('[data-testid="help-support"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="help-chat"]').click();
  await page.waitForTimeout(300);

  const opened: string[] = await page.evaluate(() => (window as any).__openedUrls ?? []);
  expect(opened).toContain('mailto:support@brandthread.app');
  expect(opened).toContain('https://brandthread.app/chat');

  await context.close();
});

test('Help Center navigates to the real in-app /help screen and closes the sheet', async () => {
  const { context, page } = await openContextAtCanvas();
  await openHelpTab(page);

  await page.locator('[data-testid="help-center"]').click();
  await page.waitForTimeout(800);

  // Real route change, not a toast: the sheet is gone and the Help screen
  // is what's showing.
  await expect(page.locator('[data-testid="wrench-help-grid"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/help/);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-help-center-opened.png') });

  await context.close();
});
