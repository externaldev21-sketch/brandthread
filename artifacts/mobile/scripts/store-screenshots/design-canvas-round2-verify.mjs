#!/usr/bin/env node
/**
 * Round 2 verification: dark workspace + artboard margin/shadow, slim
 * translucent sliders with smooth percentage drag, unboxed undo/redo,
 * circular color swatch, no floating Text/Photo chips, Modify row-2
 * animated reveal + active-tool highlight, select/resize a placed text
 * object, gallery-as-landing-screen flow.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'design-canvas-round2'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });

    // 1. Studio menu -> Gallery (confirm gallery is the actual landing screen)
    await page.goto(`${origin}/design?bt_preview=seller`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(500);
    await waitForImages(page, 6_000);
    const galleryTitle = await page.locator('[data-testid="gallery-title"]').first().innerText().catch(() => '');
    console.log('gallery title:', JSON.stringify(galleryTitle));
    await page.screenshot({ path: path.join(OUT, '01-gallery.png') });

    // 2. Open a canvas
    let openedCanvas = false;
    await page.locator('[data-testid="header-new-canvas"]').first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const presetTile = page.locator('[data-testid="preset-screen"]').first();
    if (await presetTile.count() > 0) {
      await presetTile.click();
      openedCanvas = true;
    }
    console.log('openedCanvas:', openedCanvas);
    await page.waitForTimeout(1500);
    await waitForQuietNetwork(activity, 600, 8_000);
    await page.screenshot({ path: path.join(OUT, '02-canvas-dark-workspace.png') });

    // 3. Color swatch shape check (circle)
    const swatch = page.locator('[data-testid="btn-color"]').first();
    if (await swatch.count() > 0) {
      const box = await swatch.boundingBox();
      console.log('color swatch box:', box);
    }

    // 4. Modify toggle animated expand + active-tool highlight
    const modifyBtn = page.locator('[data-testid="btn-modify-toggle"]').first();
    if (await modifyBtn.count() > 0) {
      await modifyBtn.click();
      await page.waitForTimeout(450);
      await page.screenshot({ path: path.join(OUT, '03-modify-expanded.png') });
    }
    const brushBtn = page.locator('[data-testid="btn-brush"]').first();
    if (await brushBtn.count() > 0) {
      await brushBtn.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, '04-brush-active-highlight.png') });
      // Close the Brush Library sheet this opened, so it doesn't sit on top
      // of the sidebar sliders for the drag tests below.
      const doneBtn = page.locator('text=Done').first();
      if (await doneBtn.count() > 0) {
        await doneBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // 5. Size slider smooth drag: down then up, check percentage label at each stage
    const sizeSlider = page.locator('[data-testid="brush-size-slider"]').first();
    if (await sizeSlider.count() > 0) {
      const box = await sizeSlider.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const yBottom = box.y + box.height * 0.95;
        const yTop = box.y + box.height * 0.05;
        const yMid = box.y + box.height * 0.5;
        await page.mouse.move(x, yBottom);
        await page.mouse.down();
        await page.mouse.move(x, yTop, { steps: 15 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, '05-size-drag-to-100.png') });
        await page.mouse.move(x, yMid, { steps: 15 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, '06-size-drag-to-50.png') });
        await page.mouse.up();
      }
    }
    console.log('sizeSlider found:', await sizeSlider.count() > 0);

    // 6. Opacity slider drag
    const opacitySlider = page.locator('[data-testid="brush-opacity-slider"]').first();
    if (await opacitySlider.count() > 0) {
      const box = await opacitySlider.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const yBottom = box.y + box.height * 0.9;
        const yTop = box.y + box.height * 0.1;
        await page.mouse.move(x, yBottom);
        await page.mouse.down();
        await page.mouse.move(x, yTop, { steps: 12 });
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(OUT, '07-opacity-drag.png') });
        await page.mouse.up();
      }
    }
    console.log('opacitySlider found:', await opacitySlider.count() > 0);

    // 7. Place text -> should auto-select + show transform handles
    await modifyBtn.click().catch(() => {}); // reopen row2 if collapsed
    await page.waitForTimeout(300);
    const actionsBtn = page.locator('[data-testid="btn-actions"]').first();
    if (await actionsBtn.count() > 0) {
      await actionsBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '08-wrench-add-sheet.png') });
      const addTextBtn = page.locator('text=Add Text').first();
      if (await addTextBtn.count() > 0) {
        await addTextBtn.click();
        await page.waitForTimeout(500);
      }
    }
    await page.screenshot({ path: path.join(OUT, '09-after-add-text.png') });

    // 8. Layers panel open
    const layersBtn = page.locator('[data-testid="btn-layers"]').first();
    if (await layersBtn.count() > 0) {
      await layersBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '10-layers-panel.png') });
    }

    await context.close();
  } finally {
    close();
    await browser.close();
  }
  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
