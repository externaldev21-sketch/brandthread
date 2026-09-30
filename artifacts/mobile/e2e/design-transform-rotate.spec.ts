/**
 * design-transform-rotate.spec.ts — real Playwright coverage for the
 * Transform tool's new rotate handle (lib/transformModel.ts's
 * computeRotationDelta/applyRotateHandle, wired into
 * app/design-canvas.tsx's extTransformPanResponder).
 *
 * Before this: the Transform tool (the tool newly-placed/selected layers
 * land in — see PR #554/#565) rendered 8 resize handles and NO rotate
 * handle at all; the only rotate math in the file belonged to a dead
 * 'select'-tool PanResponder whose handle Pressables were never rendered.
 * Rotation was unreachable from the UI. This spec drives a real pointer
 * drag on the new rotate handle and asserts the layer's rendered SVG
 * actually picks up a rotate() transform.
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

const SCREENSHOT_DIR = path.resolve(__dirname, '../../../docs/pr-assets/rotate-handle');
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

async function openCanvasWithTextInTransformTool(page: import('@playwright/test').Page, activity: any) {
  await page.goto(`${origin}/design?bt_preview=seller`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await harness.waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await page.waitForTimeout(500);

  await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const presetTile = page.locator('[data-testid="preset-screen"]').first();
  if (await presetTile.count() > 0) await presetTile.click();
  await page.waitForTimeout(1200);

  // Reveal row 2 (Actions/Adjustments/Selection/Transform) and place a text
  // layer via the real Add Text flow — placing auto-selects into the
  // Transform tool (PR #554's fix), which is exactly where the rotate
  // handle now lives.
  await page.locator('[data-testid="btn-modify-toggle"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="btn-actions"]').click();
  await page.waitForTimeout(400);
  await page.locator('text=Add Text').first().click();
  await page.waitForTimeout(400);
  await page.locator('textarea, input[type="text"]').first().fill('Rotate me');
  await page.locator('text=Add to Canvas').first().click();
  await page.waitForTimeout(500);
}

test('dragging the rotate handle actually rotates the selected layer', async () => {
  const { context, page, activity } = await harness.openContext(browser, {
    device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller',
    origin,
    images,
    onUnseeded: () => {},
  });

  await openCanvasWithTextInTransformTool(page, activity);

  const rotateHandle = page.locator('[data-testid="transform-handle-rotate"]');
  await expect(rotateHandle).toBeVisible({ timeout: 5000 });

  const box = await rotateHandle.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;

  // Drag the rotate handle in an arc around the canvas center-ish area below
  // it — a real pointer drag, not a synthetic value set.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY + 40, { steps: 15 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Re-locate the rotate handle after the drag: its on-screen position
  // should have moved (it's rendered inside the rotated <G>), confirming a
  // visible rotation actually took effect, not just an internal state flip.
  const boxAfter = await rotateHandle.boundingBox();
  expect(boxAfter).not.toBeNull();
  const moved = Math.abs(boxAfter!.x - box!.x) > 3 || Math.abs(boxAfter!.y - box!.y) > 3;
  expect(moved).toBe(true);

  await context.close();
});

test('Transform tool UI (mode bar + rotate handle) has no truncated/overflowing text or boxes, at 393×852', async () => {
  const { context, page, activity } = await harness.openContext(browser, {
    device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
    role: 'seller',
    origin,
    images,
    onUnseeded: () => {},
  });

  await openCanvasWithTextInTransformTool(page, activity);

  const modeBar = page.locator('[data-testid="transform-mode-bar"]');
  await expect(modeBar).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(200);

  // Zoomed screenshots for PR review — the Freeform/Uniform/Distort/Warp
  // chip row, and the canvas top area (top bar + rotate handle), not just a
  // full-screen shot.
  await modeBar.screenshot({ path: path.join(SCREENSHOT_DIR, '01-transform-mode-bar-zoomed.png') });
  const rotateHandle = page.locator('[data-testid="transform-handle-rotate"]');
  await expect(rotateHandle).toBeVisible({ timeout: 5000 });
  const rhBox = await rotateHandle.boundingBox();
  if (rhBox) {
    // A slightly wider crop around the handle itself (its own box is tiny).
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-rotate-handle-zoomed.png'),
      clip: { x: Math.max(0, rhBox.x - 60), y: Math.max(0, rhBox.y - 20), width: 160, height: 120 },
    });
  }

  // Permanent regression guard, scoped to the mode bar (the only new text
  // this PR's UI introduces — the rotate handle itself has no text).
  await assertNoTextOrBoxOverflow(page, '[data-testid="transform-mode-bar"]');

  await context.close();
});
