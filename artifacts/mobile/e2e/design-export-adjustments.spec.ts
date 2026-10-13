/**
 * design-export-adjustments.spec.ts — proves that adjustments made on the
 * canvas survive into the read-only compositing surfaces: the gallery
 * thumbnail and the full-size preview modal (both DesignLayerCompositor in
 * app/design.tsx; the mockup preview uses the same component). All build their filter
 * chain from the ONE shared builder (components/design-studio/
 * layerFilterChain.tsx) the editor uses, so the same SVG primitives
 * (feColorMatrix for HSB, feOffset ×2 for Chromatic Aberration) must be
 * present in the thumbnail's own <svg> after saving — not just on the canvas.
 *
 * Self-contained: builds + serves its own preview web build in beforeAll.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertNoTextOrBoxOverflow } from './lib/textFitCheck.mjs';

let harness: typeof import('../scripts/store-screenshots/harness.mjs');
let demoImages: typeof import('../scripts/store-screenshots/demo-images.mjs');

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-export-adjustments');
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

/** Count a primitive inside a given <svg> root (first match of `root`). */
async function primCount(scope: import('@playwright/test').Locator, tag: string) {
  return scope.locator(tag).count();
}

test('HSB + Chromatic Aberration applied on the canvas are carried by the gallery thumbnail and the full-size preview modal after saving', async () => {
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

  // Gallery thumbnails before: no adjustment filter anywhere.
  const thumbsBefore = await page.locator('[data-testid^="grid-item-"] svg filter[id^="cf_"]').count();
  expect(thumbsBefore).toBe(0);

  // New canvas, draw a real stroke so a layer exists and is selected.
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

  // Adjustments → Colour Adjustment → HSB: +30° hue.
  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-adjustments"]').first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-testid="adj-cat-colour"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="adj-tool-hsb"]').click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await page.locator('[data-testid="hsb-hue-inc"]').click();
  await expect(page.locator('[data-testid="hsb-hue-value"]')).toHaveText('+30°');

  // Back → grid → Effects → Chromatic Aberration: 2 px.
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adj-cat-effects"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="adj-tool-chromatic"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="adj-chromatic-value-inc"]').click();
  await expect(page.locator('[data-testid="adj-chromatic-value-value"]')).toHaveText('2 px');

  // Sanity: the canvas's own filter has them.
  const canvasFilter = page.locator('svg filter[id^="lf_"]').first();
  expect(await primCount(canvasFilter, 'feColorMatrix')).toBeGreaterThanOrEqual(4); // hsb + 3 chromatic channel splits
  expect(await primCount(canvasFilter, 'feOffset')).toBe(2);

  await page.locator('[data-testid="adjustments-sheet-done"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-canvas-adjusted.png') });

  // Leave the canvas: btn-back runs the coordinated save before navigating
  // back to the gallery, whose thumbnails are DesignLayerCompositor renders.
  await page.locator('[data-testid="btn-back"]').click();
  await page.locator('[data-testid="header-new-canvas"]').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(600);

  const adjustedThumb = page.locator('[data-testid^="grid-item-"]').filter({ has: page.locator('svg filter[id^="cf_"]') }).first();
  await expect(adjustedThumb).toHaveCount(1, { timeout: 10_000 });
  const thumbFilter = adjustedThumb.locator('svg filter[id^="cf_"]').first();
  expect(await primCount(thumbFilter, 'feColorMatrix')).toBeGreaterThanOrEqual(4);
  expect(await primCount(thumbFilter, 'feOffset')).toBe(2);
  // Chromatic shift is scaled to the thumbnail (xScale = 1 inside the viewBox,
  // so the offset is in canvas units, exactly as on the canvas).
  const dx = await thumbFilter.locator('feOffset').first().getAttribute('dx');
  expect(Math.abs(parseFloat(dx!))).toBeGreaterThan(0);
  await assertNoTextOrBoxOverflow(page, '[data-testid^="grid-item-"]');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-gallery-thumbnail-adjusted.png') });

  // Tapping the thumbnail opens the gallery's full-size preview modal, which
  // composites the same project through the same compositor at preview size.
  // (The mockup-preview route is only reachable via a cold URL in this build,
  // and its getProject() fires before _layout's initDesignService has scoped
  // storage to the user — a pre-existing race, noted in the PR, not covered here.)
  await adjustedThumb.click();
  const modal = page.locator('[data-testid="preview-modal"]');
  await expect(modal).toBeVisible({ timeout: 10_000 });
  const previewFilter = modal.locator('svg filter[id^="cf_"]').first();
  await expect(previewFilter).toHaveCount(1, { timeout: 10_000 });
  expect(await primCount(previewFilter, 'feOffset')).toBe(2);
  expect(await primCount(previewFilter, 'feColorMatrix')).toBeGreaterThanOrEqual(4);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-preview-modal-adjusted.png') });
  await page.locator('[data-testid="preview-close"]').click();

  await context.close();
});
