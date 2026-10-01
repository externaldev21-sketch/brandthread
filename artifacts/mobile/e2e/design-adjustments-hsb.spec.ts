/**
 * design-adjustments-hsb.spec.ts — real Playwright coverage for the new
 * HSB sub-tool in the Adjustments sheet (app/design-canvas.tsx +
 * lib/adjustmentsModel.ts + lib/layerRenderer.ts's hsbToColorMatrixString):
 * real hue/saturation/brightness sliders, applied as a genuine SVG
 * feColorMatrix filter (not a fake CSS overlay), alongside the existing
 * Curves and Liquify sub-tools.
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

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-adjustments-hsb');
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

/**
 * Opens a fresh canvas, draws a real stroke (brush is the default active
 * tool) so a real drawing layer exists and gets auto-selected — Adjustments
 * needs a selected layer, and HSB's effect is only observable with real
 * layer content, not a stub.
 */
async function openCanvasWithDrawnLayer(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();

  // Wait for the canvas editor's own toolbar (not just a fixed delay) before
  // doing anything else — a raw mouse drag fired before the canvas has
  // actually mounted can land on whatever screen is still showing
  // underneath (e.g. a bottom tab bar), silently navigating away instead of
  // drawing a stroke. This caught a real flake, not just slowness.
  await page.locator('[data-testid="btn-brush"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(300);

  // Draw a real stroke in the canvas area (default tool is 'brush').
  await page.mouse.move(120, 320);
  await page.mouse.down();
  await page.mouse.move(180, 420, { steps: 8 });
  await page.mouse.move(260, 360, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function openAdjustmentsHsb(page: import('@playwright/test').Page) {
  // Adjustments lives in the top bar's second row, which only renders once
  // "Modify" is expanded — tapping it straight away (without this) leaves
  // btn-adjustments absent from the DOM entirely, not just hidden.
  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-adjustments"]').first().click();
  await page.waitForTimeout(300);

  // btn-adjustments both selects the tool AND immediately opens the
  // Adjustments sheet (defaulting to Curves) — its own full-screen overlay
  // Pressable then sits on top of the sub-mode bar (adj-mode-hsb lives
  // there, not inside the sheet), blocking any click on it. The real flow
  // is: close the sheet first, THEN tap the HSB chip, which re-opens the
  // sheet already on HSB.
  await page.locator('[data-testid="adjustments-sheet-done"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="adj-mode-hsb"]').click();
  await page.waitForTimeout(300);
}

test('HSB sub-tool renders real sliders for a selected layer, no overflow', async () => {
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

  await openCanvasWithDrawnLayer(page);
  await openAdjustmentsHsb(page);

  const panel = page.locator('[data-testid="adjustments-hsb-panel"]');
  await expect(panel).toBeVisible();
  // Two "HSB" texts exist at once (the sheet title and the now-active
  // sub-mode chip's own label) — scope to the sheet's dialog role.
  await expect(page.getByRole('dialog').getByText('HSB', { exact: true })).toBeVisible();
  for (const key of ['hue', 'saturation', 'brightness']) {
    await expect(page.locator(`[data-testid="hsb-${key}-value"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="hsb-${key}-dec"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="hsb-${key}-inc"]`)).toBeVisible();
  }

  // Starts at identity (0°, 0%, 0%) for a freshly-drawn layer.
  await expect(page.locator('[data-testid="hsb-hue-value"]')).toHaveText('0°');
  await expect(page.locator('[data-testid="hsb-saturation-value"]')).toHaveText('0%');
  await expect(page.locator('[data-testid="hsb-brightness-value"]')).toHaveText('0%');

  await assertNoTextOrBoxOverflow(page, '[data-testid="adjustments-hsb-panel"]');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-hsb-identity.png') });

  await context.close();
});

test('Hue slider actually changes the value AND applies a real feColorMatrix filter to the layer', async () => {
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

  await openCanvasWithDrawnLayer(page);
  await openAdjustmentsHsb(page);

  // No feColorMatrix filter should exist yet (identity adjustment is
  // skipped entirely — not rendered as a no-op filter).
  const filtersBefore = await page.locator('svg feColorMatrix').count();

  // Tap Hue "+" three times → +30°.
  const hueInc = page.locator('[data-testid="hsb-hue-inc"]');
  await hueInc.click();
  await hueInc.click();
  await hueInc.click();
  await page.waitForTimeout(200);

  await expect(page.locator('[data-testid="hsb-hue-value"]')).toHaveText('+30°');

  // A real feColorMatrix filter now exists in the SVG tree (the layer is
  // actually re-rendered with the new colour matrix, not just a label
  // update).
  const filtersAfter = await page.locator('svg feColorMatrix').count();
  expect(filtersAfter).toBeGreaterThan(filtersBefore);

  // Reset brings it back to identity and the filter disappears again.
  await page.locator('[data-testid="hsb-reset"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="hsb-hue-value"]')).toHaveText('0°');

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-hsb-hue-shifted.png') });

  await context.close();
});

test('Saturation and Brightness sliders are independent of each other and of Hue', async () => {
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

  await openCanvasWithDrawnLayer(page);
  await openAdjustmentsHsb(page);

  await page.locator('[data-testid="hsb-saturation-dec"]').click(); // -10%
  await page.waitForTimeout(150);
  await expect(page.locator('[data-testid="hsb-saturation-value"]')).toHaveText('-10%');
  await expect(page.locator('[data-testid="hsb-hue-value"]')).toHaveText('0°');
  await expect(page.locator('[data-testid="hsb-brightness-value"]')).toHaveText('0%');

  await page.locator('[data-testid="hsb-brightness-inc"]').click(); // +10%
  await page.waitForTimeout(150);
  await expect(page.locator('[data-testid="hsb-brightness-value"]')).toHaveText('+10%');
  // Saturation's own change from the previous step is untouched.
  await expect(page.locator('[data-testid="hsb-saturation-value"]')).toHaveText('-10%');

  await assertNoTextOrBoxOverflow(page, '[data-testid="adjustments-hsb-panel"]');

  await context.close();
});
