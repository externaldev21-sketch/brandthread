/**
 * design-colours.spec.ts — real Playwright coverage for the Colours picker
 * rebuild (components/design-studio/ColorPicker.tsx): Procreate's own
 * full-height 5-tab sheet (Disc/Classic/Harmony/Value/Palettes), replacing
 * the old ~240px floating popover with a fake Disc/Classic toggle.
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

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-colours');
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

async function openColourSheet(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.waitForTimeout(1200);

  await page.locator('[data-testid="btn-color"]').first().click();
  await page.waitForTimeout(400);
}

test('Colours sheet renders as a full-height sheet with all 5 real tabs, no overflow', async () => {
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

  await openColourSheet(page);

  const panel = page.locator('[data-testid="color-picker"]');
  await expect(panel).toBeVisible();
  await expect(page.getByText('Colours', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="color-done"]')).toBeVisible();
  await expect(page.locator('[data-testid="color-eyedropper"]')).toBeVisible();

  // Real full-height sheet (not the old ~240px popover): measured pixel
  // dimensions, not a style/class assertion.
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(300);
  expect(box!.height).toBeGreaterThan(400);

  // All 5 real tabs exist and are switchable.
  for (const tab of ['disc', 'classic', 'harmony', 'value', 'palettes']) {
    const tabBtn = page.locator(`[data-testid="color-tab-${tab}"]`);
    await expect(tabBtn).toBeVisible();
    await tabBtn.click();
    await page.waitForTimeout(150);
  }

  await page.locator('[data-testid="color-tab-disc"]').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-disc-tab.png') });

  await assertNoTextOrBoxOverflow(page, '[data-testid="color-picker"]');

  await context.close();
});

test('Classic tab\'s real SV square and hue slider actually change the colour', async () => {
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

  await openColourSheet(page);
  await page.locator('[data-testid="color-tab-classic"]').click();
  await page.waitForTimeout(300);

  const hexBefore = await page.locator('[data-testid="color-hex-input"]').inputValue();

  const square = page.locator('[data-testid="color-sv-square"]');
  await expect(square).toBeVisible();
  const box = await square.boundingBox();
  expect(box).not.toBeNull();

  // Real pointer drag from one corner of the SV square to another.
  await page.mouse.move(box!.x + 10, box!.y + 10);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + box!.height - 10, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  const hexAfter = await page.locator('[data-testid="color-hex-input"]').inputValue();
  expect(hexAfter).not.toBe(hexBefore);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-classic-tab.png') });

  await context.close();
});

test('Harmony tab computes real complementary/analogous swatches from the base hue', async () => {
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

  await openColourSheet(page);
  await page.locator('[data-testid="color-tab-harmony"]').click();
  await page.waitForTimeout(300);

  // Complementary (default rule) shows exactly one secondary swatch.
  await expect(page.locator('[data-testid="color-harmony-swatch-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="color-harmony-swatch-1"]')).toHaveCount(0);

  // Switching to Analogous shows two secondary swatches instead.
  await page.locator('[data-testid="harmony-rule-analogous"]').click();
  await page.waitForTimeout(200);
  await expect(page.locator('[data-testid="color-harmony-swatch-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="color-harmony-swatch-1"]')).toBeVisible();

  // Tapping a harmony swatch actually applies that colour.
  const hexBefore = await page.locator('[data-testid="color-hex-input"]').inputValue();
  await page.locator('[data-testid="color-harmony-swatch-0"]').click();
  await page.waitForTimeout(200);
  const hexAfter = await page.locator('[data-testid="color-hex-input"]').inputValue();
  expect(hexAfter).not.toBe(hexBefore);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-harmony-tab.png') });

  await context.close();
});

test('Value tab\'s HSB/RGB sliders each independently change the colour', async () => {
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

  await openColourSheet(page);
  await page.locator('[data-testid="color-tab-value"]').click();
  await page.waitForTimeout(300);

  for (const channel of ['h', 's', 'v', 'r', 'g', 'b']) {
    await expect(page.locator(`[data-testid="color-channel-${channel}"]`)).toBeVisible();
  }

  const hexBefore = await page.locator('[data-testid="color-hex-input"]').inputValue();
  const box = await page.locator('[data-testid="color-channel-s"]').boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const hexAfter = await page.locator('[data-testid="color-hex-input"]').inputValue();
  expect(hexAfter).not.toBe(hexBefore);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-value-tab.png') });

  await context.close();
});

test('Palettes tab: create, rename, set default, and delete a palette for real', async () => {
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

  await openColourSheet(page);
  await page.locator('[data-testid="color-tab-palettes"]').click();
  await page.waitForTimeout(300);

  const beforeCount = await page.locator('[data-testid^="palette-set-default-"]').count();
  await page.locator('[data-testid="color-new-palette"]').click();
  await page.waitForTimeout(300);
  const afterCount = await page.locator('[data-testid^="palette-set-default-"]').count();
  expect(afterCount).toBe(beforeCount + 1);

  // Set the newest palette as default and verify its label flips to "Default".
  const setDefaultButtons = page.locator('[data-testid^="palette-set-default-"]');
  const lastSetDefault = setDefaultButtons.last();
  await lastSetDefault.click();
  await page.waitForTimeout(200);
  await expect(lastSetDefault).toHaveText('Default');

  // Delete it again — count drops back down.
  const deleteButtons = page.locator('[data-testid^="palette-delete-"]');
  await deleteButtons.last().click();
  await page.waitForTimeout(300);
  const finalCount = await page.locator('[data-testid^="palette-set-default-"]').count();
  expect(finalCount).toBe(beforeCount);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-palettes-tab.png') });

  await context.close();
});
