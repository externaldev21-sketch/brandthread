/**
 * design-studio-fonts.spec.ts — real Playwright coverage for the Design
 * Studio's real Google Fonts (lib/designStudioFonts.ts /
 * lib/designStudioFontsList.ts), wired into app/design-canvas.tsx's Add
 * Text sheet and SVG text renderer.
 *
 * Before this: `renderLayerInSvg`'s text case never set a `fontFamily` prop
 * on `<SvgText>` at all, and `letterSpacing`/`lineHeight` were hardcoded to
 * 0/1.4 and never read back from layer data — font choice, letter-spacing
 * and line-height had ZERO effect on the actual rendered/exported output,
 * only cosmetically in the Add Text composer's own preview. This verifies
 * the real fix: each font chip renders its own label in that font, the
 * selected font's family name actually reaches the rendered SVG text, and
 * the whole Add Text sheet (now with 16 font chips + two new sliders) has
 * no truncated/overflowing text at 393×852.
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

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/design-studio-fonts');
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

async function openAddTextSheet(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.waitForTimeout(1200);

  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-actions"]').click();
  await page.waitForTimeout(400);
  await page.locator('text=Add Text').first().click();
  await page.waitForTimeout(400);
}

test('each font chip renders its own label in that real font, with no overflow', async () => {
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

  await openAddTextSheet(page);

  // Spot-check a handful of real chips (not the whole 16 — representative
  // sample across the installed font families) actually apply their own
  // font-family to their own label, i.e. this isn't a static list of plain
  // names but each one genuinely rendered in that font.
  const sample = [
    { family: 'PlayfairDisplay_400Regular', label: 'Playfair Display' },
    { family: 'BebasNeue_400Regular', label: 'Bebas Neue' },
    { family: 'PermanentMarker_400Regular', label: 'Permanent Marker' },
    { family: 'Caveat_400Regular', label: 'Caveat' },
  ];
  for (const f of sample) {
    const chipText = page.locator(`[data-testid="font-chip-${f.family}"]`).locator('text=' + f.label);
    await expect(chipText).toBeVisible({ timeout: 5000 });
    const fontFamily = await chipText.evaluate((el: Element) => getComputedStyle(el).fontFamily);
    expect(fontFamily).toContain(f.family);
  }

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-add-text-sheet-font-chips.png') });

  // Permanent text-fit/box-overflow regression guard: 16 font chips plus
  // the new letter-spacing/line-height sliders is meaningfully more content
  // in this sheet than before — confirm none of it is truncated or
  // overflowing at 393×852.
  await assertNoTextOrBoxOverflow(page, 'body');

  await context.close();
});

test('placing text with a non-default font actually renders that font in the SVG output', async () => {
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

  await openAddTextSheet(page);

  await page.locator('[data-testid="add-text-input"]').fill('Styled text');
  await page.locator('[data-testid="font-chip-BebasNeue_400Regular"]').click();
  await page.waitForTimeout(200);
  await page.locator('text=Add to Canvas').first().click();
  await page.waitForTimeout(500);

  // The real rendered SVG <text> for the placed layer must carry the
  // selected font-family — this is exactly what was broken before (the
  // renderer never set fontFamily on SvgText at all).
  const svgText = page.locator('text=Styled text').first();
  await expect(svgText).toBeVisible({ timeout: 5000 });
  const fontFamily = await svgText.evaluate((el: Element) => getComputedStyle(el).fontFamily);
  expect(fontFamily).toContain('BebasNeue_400Regular');

  await context.close();
});
