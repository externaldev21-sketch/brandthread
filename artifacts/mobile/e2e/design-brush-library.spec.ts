/**
 * design-brush-library.spec.ts — real Playwright coverage for the Brush
 * Library structural rebuild (components/design-studio/BrushLibrary.tsx):
 * a full-screen two-pane picker (left: brush-set sidebar, right: that
 * set's brushes, swipe-left for Share/Duplicate/Delete), replacing the old
 * ~72%-height single-column bottom sheet.
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

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-brush-library');
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

async function openBrushLibrary(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.waitForTimeout(1200);

  await page.locator('[data-testid="btn-brush"]').first().click();
  await page.waitForTimeout(400);
}

test('Brush Library renders as a full-screen two-pane picker, not a bottom sheet', async () => {
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

  await openBrushLibrary(page);

  const panel = page.locator('[data-testid="brush-library"]');
  await expect(panel).toBeVisible();
  await expect(page.getByText('Brushes', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="brush-library-done"]')).toBeVisible();

  // Real full-screen takeover (not a ~72%-height sheet): measured pixel
  // dimensions close to the full 852pt viewport, not a fraction of it.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThan(750);

  // Two-pane structure: a real category sidebar, all 5 real categories.
  for (const cat of ['Sketching', 'Inking', 'Painting', 'Airbrushing', 'Marker']) {
    await expect(page.locator(`[data-testid="brush-category-${cat}"]`)).toBeVisible();
  }

  await assertNoTextOrBoxOverflow(page, '[data-testid="brush-library"]');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-sketching-set.png') });

  await context.close();
});

test('Selecting a different category filters the right pane for real', async () => {
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

  await openBrushLibrary(page);

  // Default set (Studio Pen's own category, Inking) shows Inking brushes,
  // not Sketching ones.
  await expect(page.getByText('Studio Pen', { exact: true })).toBeVisible();
  await expect(page.getByText('HB Pencil', { exact: true })).toHaveCount(0);

  // Switching to Painting swaps the ENTIRE right pane's content.
  await page.locator('[data-testid="brush-category-Painting"]').click();
  await page.waitForTimeout(200);
  await expect(page.getByText('Flat Brush', { exact: true })).toBeVisible();
  await expect(page.getByText('Soft Brush', { exact: true })).toBeVisible();
  await expect(page.getByText('Studio Pen', { exact: true })).toHaveCount(0);

  await assertNoTextOrBoxOverflow(page, '[data-testid="brush-library"]');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-painting-set.png') });

  await context.close();
});

test('Tapping a brush row actually selects it as the active brush', async () => {
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

  await openBrushLibrary(page);
  await page.locator('[data-testid="brush-category-Painting"]').click();
  await page.waitForTimeout(200);

  // b7 = "Flat Brush" — not the default active brush (b4, Studio Pen).
  const card = page.locator('[data-testid="brush-row-card-b7"]');
  const bgBefore = await card.evaluate((el: Element) => getComputedStyle(el).backgroundColor);

  await page.locator('[data-testid="brush-select-b7"]').click();
  await page.waitForTimeout(200);

  const bgAfter = await card.evaluate((el: Element) => getComputedStyle(el).backgroundColor);
  expect(bgAfter).not.toBe(bgBefore); // real selection re-render, not a no-op tap

  await context.close();
});

test('Swipe-left on a brush row reveals real Duplicate/Delete actions that actually mutate the library', async () => {
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

  await openBrushLibrary(page);
  await page.locator('[data-testid="brush-category-Painting"]').click();
  await page.waitForTimeout(200);

  await expect(page.getByText('Soft Brush Copy', { exact: true })).toHaveCount(0);

  // Swipe the "Soft Brush" (b8) row left to reveal Share/Duplicate/Delete.
  const row = page.locator('[data-testid="brush-row-b8"]');
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width - 20;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 160, startY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  await page.locator('[data-testid="brush-duplicate-b8"]').click();
  await page.waitForTimeout(300);

  // Real duplicate: a NEW row with the expected name, inserted right after
  // the original — not a fake toast or a no-op.
  await expect(page.getByText('Soft Brush Copy', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-swipe-actions.png') });

  // The newly-created copy has its own id; find it and swipe-delete it to
  // confirm Delete also really mutates the list (not just Duplicate).
  const copyRow = page.locator('[data-testid="brush-library-list"] >> text=Soft Brush Copy');
  const copyBox = await copyRow.boundingBox();
  expect(copyBox).not.toBeNull();
  const cStartX = copyBox!.x + 150;
  const cStartY = copyBox!.y + 10;
  await page.mouse.move(cStartX, cStartY);
  await page.mouse.down();
  await page.mouse.move(cStartX - 160, cStartY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const deleteButtons = page.locator('[data-testid^="brush-delete-"]');
  // The swiped-open row's own delete button is the only one with pointer
  // events enabled; click via the row's testID directly once we know its id
  // isn't b8 (the original, untouched).
  const allRows = await page.locator('[data-testid="brush-library-list"] [data-testid^="brush-row-"]').all();
  let copyId: string | null = null;
  for (const r of allRows) {
    const text = await r.textContent();
    if (text?.includes('Soft Brush Copy')) {
      copyId = (await r.getAttribute('data-testid'))!.replace('brush-row-', '');
      break;
    }
  }
  expect(copyId).not.toBeNull();
  await page.locator(`[data-testid="brush-delete-${copyId}"]`).click();
  await page.waitForTimeout(300);

  await expect(page.getByText('Soft Brush Copy', { exact: true })).toHaveCount(0);

  await assertNoTextOrBoxOverflow(page, '[data-testid="brush-library"]');

  await context.close();
});
