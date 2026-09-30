#!/usr/bin/env node
/**
 * Phase 1 verification: gallery title, canvas top bar (Modify row toggle),
 * sidebar (inset handles + drag preview card), no floating squares.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.store-screenshots', 'design-canvas-phase1'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });

    // 1. Gallery
    await page.goto(`${origin}/design?bt_preview=seller`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(500);
    await waitForImages(page, 6_000);
    const galleryText = await page.locator('body').innerText().catch(() => '');
    console.log('=== gallery ===');
    console.log(galleryText.replace(/\s+/g, ' | ').slice(0, 200));
    await page.screenshot({ path: path.join(OUT, '01-gallery.png') });

    // 2. Create a new canvas via the "+" button, then the "Screen" preset.
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

    // 3. Canvas top bar, Modify collapsed
    await page.screenshot({ path: path.join(OUT, '02-canvas-modify-collapsed.png') });
    const modifyBtn = page.locator('[data-testid="btn-modify-toggle"]').first();
    console.log('modifyBtn found:', await modifyBtn.count() > 0);

    // 4. Tap Modify to expand row 2
    if (await modifyBtn.count() > 0) {
      await modifyBtn.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '03-canvas-modify-expanded.png') });
    }

    // 5. Drag the size slider to show the big preview card
    const sizeSlider = page.locator('[data-testid="brush-size-slider"]').first();
    if (await sizeSlider.count() > 0) {
      const box = await sizeSlider.boundingBox();
      if (box) {
        const x = box.x + box.width / 2;
        const yStart = box.y + box.height * 0.8;
        const yEnd = box.y + box.height * 0.2;
        await page.mouse.move(x, yStart);
        await page.mouse.down();
        await page.mouse.move(x, yEnd - 20, { steps: 10 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, '04-canvas-size-drag.png') });
        await page.mouse.up();
      }
    }
    console.log('sizeSlider found:', await sizeSlider.count() > 0);

    await context.close();
  } finally {
    close();
    await browser.close();
  }
  console.log(`\nWrote screenshots to ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
