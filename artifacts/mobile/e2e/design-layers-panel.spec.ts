/**
 * design-layers-panel.spec.ts — real Playwright coverage for the Layers
 * panel rebuild (components/design-studio/LayersPanel.tsx): opens the panel
 * on the actual canvas, verifies it renders as a full-height sheet (not the
 * old small corner popover) with Procreate's structure (title, Done, New
 * layer, a pinned Background colour row), then drives real interactions —
 * toggling a layer's visibility checkbox, opening its context menu, and a
 * real pointer swipe-left that reveals Lock/Duplicate/Delete.
 *
 * Self-contained: builds + serves its own preview web build in beforeAll,
 * the same harness scripts/store-screenshots/*.mjs use for their own
 * verification runs, so this needs nothing already running.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';

// The harness/demo-images modules are real ESM (.mjs); Playwright transpiles
// this spec through CJS, which cannot `import` an ESM file statically —
// loaded lazily via dynamic import() instead, which Node's interop handles.
let harness: typeof import('../scripts/store-screenshots/harness.mjs');
let demoImages: typeof import('../scripts/store-screenshots/demo-images.mjs');

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

async function openCanvasWithLayers(device: { width: number; height: number }) {
  const { context, page, activity } = await harness.openContext(browser, {
    device: { viewport: device, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller',
    origin,
    images,
    onUnseeded: () => {},
  });
  await page.goto(`${origin}/design?bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await harness.waitForQuietNetwork(activity, 600, 10_000);
  await page.waitForTimeout(400);

  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.waitForTimeout(1200);
  await harness.waitForQuietNetwork(activity, 600, 8_000);
  await harness.waitForImages(page, 6_000).catch(() => {});

  // Add two real drawing layers so the panel has more than the base layer to
  // exercise selection, swipe and (when present) reorder against.
  const addLayerBtn = page.locator('[data-testid="btn-layers"]').first();
  await addLayerBtn.click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="layers-add-layer"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="layers-add-layer"]').click();
  await page.waitForTimeout(200);

  return { context, page };
}

test('layers panel renders as a full-height sheet with Procreate structure', async () => {
  const { context, page } = await openCanvasWithLayers({ width: 393, height: 852 });

  const panel = page.locator('[data-testid="layers-panel"]');
  await expect(panel).toBeVisible();

  // Structural elements Procreate's own Layers sheet always shows.
  await expect(page.getByText('Layers', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="layers-done"]')).toBeVisible();
  await expect(page.locator('[data-testid="layers-add-layer"]')).toBeVisible();
  await expect(page.locator('[data-testid="layer-row-background"]')).toBeVisible();

  // It must actually be a full-height sheet, not the old ~280px-wide corner
  // popover: assert real, measured pixel dimensions rather than trusting a
  // class name or style prop.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(300); // old popover was a fixed 280px card
  expect(box!.height).toBeGreaterThan(300); // old popover was only as tall as its ~3 rows

  await context.close();
});

test('tapping the selected layer opens its context menu with real actions', async () => {
  const { context, page } = await openCanvasWithLayers({ width: 393, height: 852 });

  const rows = page.locator('[data-testid^="layer-row-"]:not([data-testid="layer-row-background"])');
  const firstRow = rows.first();
  await firstRow.waitFor({ timeout: 5000 });
  const rowTestId = await firstRow.getAttribute('data-testid');
  const layerId = rowTestId!.replace('layer-row-', '');

  // Tapping an UNSELECTED row only selects it; tapping the row again while
  // it's already selected is what opens the menu. The freshly-added layer
  // is auto-selected on insert, so whichever state this row starts in, one
  // tap either opens the menu directly (already selected) or selects it —
  // in which case a second tap opens it.
  const menu = page.locator(`[data-testid="layer-context-menu-${layerId}"]`);
  await firstRow.click();
  await page.waitForTimeout(200);
  if (!(await menu.isVisible())) {
    await firstRow.click();
    await page.waitForTimeout(200);
  }
  await expect(menu).toBeVisible();
  await expect(page.locator(`[data-testid="layer-menu-rename-${layerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="layer-menu-alphalock-${layerId}"]`)).toBeVisible();

  await context.close();
});

test('visibility checkbox toggles a layer\'s visible state', async () => {
  const { context, page } = await openCanvasWithLayers({ width: 393, height: 852 });

  const rows = page.locator('[data-testid^="layer-row-"]:not([data-testid="layer-row-background"])');
  const firstRow = rows.first();
  await firstRow.waitFor({ timeout: 5000 });
  const rowTestId = await firstRow.getAttribute('data-testid');
  const layerId = rowTestId!.replace('layer-row-', '');

  const checkbox = page.locator(`[data-testid="layer-visibility-${layerId}"]`);
  const checkGlyph = page.locator(`[data-testid="layer-visibility-check-${layerId}"]`);
  await expect(checkbox).toBeVisible();
  // Starts visible: the checkbox renders a check glyph inside it.
  await expect(checkGlyph).toBeVisible();
  await checkbox.click();
  await page.waitForTimeout(150);
  await expect(checkGlyph).toHaveCount(0);
  await checkbox.click();
  await page.waitForTimeout(150);
  await expect(checkGlyph).toBeVisible();

  await context.close();
});

test('a real pointer swipe-left on a row reveals Lock/Duplicate/Delete', async () => {
  const { context, page } = await openCanvasWithLayers({ width: 393, height: 852 });

  const rows = page.locator('[data-testid^="layer-row-"]:not([data-testid="layer-row-background"])');
  const firstRow = rows.first();
  await firstRow.waitFor({ timeout: 5000 });
  const rowTestId = await firstRow.getAttribute('data-testid');
  const layerId = rowTestId!.replace('layer-row-', '');

  const box = await firstRow.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  const startX = box!.x + box!.width - 20;
  const endX = box!.x + 20;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(250);

  await expect(page.locator(`[data-testid="layer-swipe-delete-${layerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="layer-swipe-duplicate-${layerId}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="layer-swipe-lock-${layerId}"]`)).toBeVisible();

  await context.close();
});
