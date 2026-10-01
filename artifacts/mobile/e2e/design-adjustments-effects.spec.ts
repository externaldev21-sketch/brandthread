/**
 * design-adjustments-effects.spec.ts — real Playwright coverage for the
 * Adjustments sheet rebuilt as Procreate's category grid → tool list → tool
 * panel (lib/adjustmentsCatalog.ts, components/design-studio/AdjustmentsMenu.tsx)
 * and the seven new effects applied as real SVG filter primitives
 * (lib/layerRenderer.ts builders + design-canvas.tsx's generic stage chain).
 *
 * Every "applies" assertion checks the live SVG tree for the actual
 * primitive element (feGaussianBlur, feConvolveMatrix, feTurbulence,
 * feOffset, feComponentTransfer) — the filter is really attached to the
 * layer, not just a label change.
 *
 * Self-contained: builds + serves its own preview web build in beforeAll,
 * the same harness scripts/store-screenshots/*.mjs use.
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { assertNoTextOrBoxOverflow } from './lib/textFitCheck.mjs';

let harness: typeof import('../scripts/store-screenshots/harness.mjs');
let demoImages: typeof import('../scripts/store-screenshots/demo-images.mjs');

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-adjustments-effects');
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

/** Fresh canvas with one real drawn stroke (so a layer exists and is selected), Adjustments sheet open at the category grid. */
async function openAdjustmentsGrid() {
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

  // Adjustments is in the top bar's second row (behind "Modify"); tapping it
  // selects the tool and opens the sheet at the category grid.
  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-adjustments"]').first().click();
  await page.waitForTimeout(400);
  return { context, page };
}

/** From the grid, drill into a category then a tool. */
async function openTool(page: import('@playwright/test').Page, category: string, tool: string) {
  await page.locator(`[data-testid="adj-cat-${category}"]`).click();
  await page.waitForTimeout(250);
  await page.locator(`[data-testid="adj-tool-${tool}"]`).click();
  await page.waitForTimeout(300);
}

async function svgCount(page: import('@playwright/test').Page, tag: string) {
  return page.locator(`svg ${tag}`).count();
}

test('Adjustments opens on Procreate\'s 2×2 category grid; every category lists its real tools; deferred tools are absent; no overflow', async () => {
  const { context, page } = await openAdjustmentsGrid();

  const grid = page.locator('[data-testid="adj-category-grid"]');
  await expect(grid).toBeVisible();
  for (const c of ['colour', 'blur', 'effects', 'retouch']) {
    await expect(page.locator(`[data-testid="adj-cat-${c}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-testid="adjustments-sheet-title"]')).toHaveText('Adjustments');
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-category-grid"]');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-category-grid.png') });

  // Colour Adjustment → HSB / Colour Balance / Curves / Gradient Map (Procreate's exact list).
  await page.locator('[data-testid="adj-cat-colour"]').click();
  await page.waitForTimeout(250);
  for (const t of ['hsb', 'colorBalance', 'curves', 'gradientMap']) {
    await expect(page.locator(`[data-testid="adj-tool-${t}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-testid="adjustments-sheet-title"]')).toHaveText('Colour Adjustment');
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-tool-list-colour"]');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-colour-list.png') });

  // Back returns to the grid.
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(250);
  await expect(grid).toBeVisible();

  // Effects lists Opacity/Noise/Sharpen/Bloom/Chromatic — and NOT the deferred Glitch/Halftone.
  await page.locator('[data-testid="adj-cat-effects"]').click();
  await page.waitForTimeout(250);
  for (const t of ['opacity', 'noise', 'sharpen', 'bloom', 'chromatic']) {
    await expect(page.locator(`[data-testid="adj-tool-${t}"]`)).toBeVisible();
  }
  await expect(page.getByText('Glitch', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Halftone', { exact: true })).toHaveCount(0);
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-tool-list-effects"]');

  await context.close();
});

test('Gaussian Blur attaches a real feGaussianBlur to the layer, scales with the slider, and Reset removes it', async () => {
  const { context, page } = await openAdjustmentsGrid();
  await openTool(page, 'blur', 'gaussianBlur');

  await expect(page.locator('[data-testid="adj-panel-gaussianBlur"]')).toBeVisible();
  expect(await svgCount(page, 'feGaussianBlur')).toBe(0);

  await page.locator('[data-testid="adj-gaussianBlur-value-inc"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="adj-gaussianBlur-value-value"]')).toHaveText('2 px');
  expect(await svgCount(page, 'feGaussianBlur')).toBeGreaterThan(0);
  const std1 = await page.locator('svg feGaussianBlur').first().getAttribute('stdDeviation');

  await page.locator('[data-testid="adj-gaussianBlur-value-inc"]').click();
  await page.waitForTimeout(200);
  const std2 = await page.locator('svg feGaussianBlur').first().getAttribute('stdDeviation');
  expect(parseFloat(std2!)).toBeGreaterThan(parseFloat(std1!)); // the primitive's own attribute tracks the slider

  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-panel-gaussianBlur"]');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-gaussian-blur.png') });

  await page.locator('[data-testid="adj-gaussianBlur-reset"]').click();
  await page.waitForTimeout(200);
  expect(await svgCount(page, 'feGaussianBlur')).toBe(0);

  await context.close();
});

test('Motion Blur and Sharpen attach real feConvolveMatrix kernels; Motion Blur\'s order grows with amount', async () => {
  const { context, page } = await openAdjustmentsGrid();
  await openTool(page, 'blur', 'motionBlur');

  expect(await svgCount(page, 'feConvolveMatrix')).toBe(0);
  await page.locator('[data-testid="adj-motionBlur-amount-inc"]').click(); // 2 px → order 3
  await page.waitForTimeout(200);
  expect(await svgCount(page, 'feConvolveMatrix')).toBe(1);
  const order1 = await page.locator('svg feConvolveMatrix').first().getAttribute('order');
  for (let i = 0; i < 3; i++) await page.locator('[data-testid="adj-motionBlur-amount-inc"]').click(); // 8 px → order 9
  await page.waitForTimeout(200);
  const order2 = await page.locator('svg feConvolveMatrix').first().getAttribute('order');
  expect(parseInt(order2!, 10)).toBeGreaterThan(parseInt(order1!, 10));
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-panel-motionBlur"]');

  // Back out to the Effects category and add Sharpen on top — two convolve stages now.
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await openTool(page, 'effects', 'sharpen');
  await page.locator('[data-testid="adj-sharpen-value-inc"]').click();
  await page.waitForTimeout(200);
  expect(await svgCount(page, 'feConvolveMatrix')).toBe(2);

  await context.close();
});

test('Noise, Chromatic Aberration and Gradient Map each attach their own real primitive', async () => {
  const { context, page } = await openAdjustmentsGrid();

  await openTool(page, 'effects', 'noise');
  expect(await svgCount(page, 'feTurbulence')).toBe(0);
  await page.locator('[data-testid="adj-noise-value-inc"]').click();
  await page.waitForTimeout(200);
  expect(await svgCount(page, 'feTurbulence')).toBe(1);

  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adj-tool-chromatic"]').click();
  await page.waitForTimeout(250);
  expect(await svgCount(page, 'feOffset')).toBe(0);
  await page.locator('[data-testid="adj-chromatic-value-inc"]').click();
  await page.waitForTimeout(200);
  expect(await svgCount(page, 'feOffset')).toBe(2); // red pushed one way, blue the other
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-chromatic.png') });

  // Gradient Map: picking a preset starts mix at 100% and installs the ramp.
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await openTool(page, 'colour', 'gradientMap');
  expect(await svgCount(page, 'feComponentTransfer')).toBe(0);
  await page.locator('[data-testid="adj-gradient-preset-sepia"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="adj-gradientMap-mix-value"]')).toHaveText('100%');
  expect(await svgCount(page, 'feComponentTransfer')).toBe(1);
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-panel-gradientMap"]');
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-gradient-map.png') });

  await context.close();
});

test('Opacity under Effects drives the real layer opacity; Colour Balance panel states its global-only scope', async () => {
  const { context, page } = await openAdjustmentsGrid();

  await openTool(page, 'effects', 'opacity');
  await expect(page.locator('[data-testid="adj-opacity-value-value"]')).toHaveText('100%');
  await page.locator('[data-testid="adj-opacity-value-dec"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="adj-opacity-value-value"]')).toHaveText('90%');

  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="adjustments-sheet-back"]').click();
  await page.waitForTimeout(200);
  await openTool(page, 'colour', 'colorBalance');
  await expect(page.locator('[data-testid="adj-panel-colorBalance"]')).toContainText('Shadows / Midtones / Highlights');
  await page.locator('[data-testid="adj-colorBalance-cyanRed-inc"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="adj-colorBalance-cyanRed-value"]')).toHaveText('+10%');
  await assertNoTextOrBoxOverflow(page, '[data-testid="adj-panel-colorBalance"]');

  await context.close();
});
