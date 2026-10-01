/**
 * design-cold-load.spec.ts — regression for the cold-load identity race in
 * the design screens (services/designService.whenDesignServiceReady).
 *
 * Before the fix: saving a project, then loading
 * /design-mockup-preview?projectId=… (or /design-canvas?id=…) by URL — a
 * deep link or a page reload — showed "Open a garment project to see the
 * mockup preview." / "Project not found" for a project that exists, because
 * the screen's getProject() ran before app/_layout's ServiceConfigurer had
 * scoped storage to the signed-in user. In-app navigation never hit it.
 *
 * Self-contained: builds + serves its own preview web build in beforeAll.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertNoTextOrBoxOverflow } from './lib/textFitCheck.mjs';

let harness: typeof import('../scripts/store-screenshots/harness.mjs');
let demoImages: typeof import('../scripts/store-screenshots/demo-images.mjs');

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-cold-load');
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

const FALLBACK = 'Open a garment project to see the mockup preview.';

test('a saved project survives a cold URL load of the mockup preview and the canvas', async () => {
  const { context, page, activity } = await harness.openContext(browser, {
    device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller',
    origin,
    images,
    onUnseeded: () => {},
  });
  await page.goto(`${origin}/design?bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await harness.waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await page.waitForTimeout(500);

  // Create a canvas with one real stroke, then leave via btn-back so the
  // coordinated save writes it to storage under the signed-in user's scope.
  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.locator('[data-testid="btn-brush"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);
  await page.mouse.move(120, 320);
  await page.mouse.down();
  await page.mouse.move(180, 420, { steps: 8 });
  await page.mouse.move(260, 360, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-back"]').click();
  await page.locator('[data-testid="header-new-canvas"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(400);

  const gridItem = page.locator('[data-testid^="grid-item-"]').first();
  await expect(gridItem).toBeVisible();
  const projectId = (await gridItem.getAttribute('data-testid'))!.replace('grid-item-', '');
  expect(projectId.length).toBeGreaterThan(0);

  // ── Cold load #1: mockup preview by URL (full page navigation = fresh JS).
  await page.goto(`${origin}/design-mockup-preview?projectId=${encodeURIComponent(projectId)}&bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  // The real preview panel: "<garment> · Front" overlay label, never the fallback.
  await expect(page.getByText(/· Front$/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(FALLBACK, { exact: true })).toHaveCount(0);
  await assertNoTextOrBoxOverflow(page, 'body');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-mockup-preview-cold-load.png') });

  // ── Cold load #2: the canvas itself by URL.
  await page.goto(`${origin}/design-canvas?id=${encodeURIComponent(projectId)}&bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await page.locator('[data-testid="btn-brush"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(500);
  // The saved stroke is rendered (a real path inside the canvas SVG) — the
  // project loaded under the right storage scope, not a blank "not found".
  expect(await page.locator('svg path[stroke]').count()).toBeGreaterThan(0);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-canvas-cold-load.png') });

  await context.close();
});
