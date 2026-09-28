#!/usr/bin/env node
/**
 * Verification screenshots for the Activity redesign + swipe/menu/remove-
 * follower/block PR — see docs/activity-flows.md.
 *
 * Captures the activity list, the swipe-revealed "..."/trash, the "..."
 * menu open, and the remove-follower confirm sheet, at 375x667 / 390x844 /
 * 430x932, for the buyer preview (and one seller shot to confirm the same
 * screen serves both roles — see docs/activity-flows.md §1).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR, DEFAULT_BUILD_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'activity-follower-management');
const IMAGES_DIR = path.join(WORK_DIR, 'demo-images');
const WIDTHS = [
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
];

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Building preview web export...');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, IMAGES_DIR);
  try {
    for (const device of WIDTHS) {
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: device.width, height: device.height }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'buyer',
        origin,
        images,
      });
      await openScreen(page, activity, origin, 'buyer', '/activity-center');
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `01-list-${device.id}.png`) });

      // Swipe the first row left to reveal "..." + trash.
      const row = page.locator('[aria-label*="started following you"], [aria-label*="liked"]').first();
      const box = await row.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x - 40, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `02-swipe-revealed-${device.id}.png`) });

        // Tap "..." to open the menu.
        const moreBtn = page.locator('[aria-label="More options"]').first();
        if (await moreBtn.count()) {
          await moreBtn.click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUTPUT_DIR, `03-menu-open-${device.id}.png`) });

          const removeFollowerBtn = page.locator('text=Remove follower').first();
          if (await removeFollowerBtn.count()) {
            await removeFollowerBtn.click();
            await page.waitForTimeout(400);
            await page.screenshot({ path: path.join(OUTPUT_DIR, `04-remove-follower-confirm-${device.id}.png`) });
          }
        }
      }
      await context.close();
    }

    // One seller-preview shot confirming the same screen serves both roles.
    const { context, page, activity } = await openContext(browser, {
      device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined },
      role: 'seller',
      origin,
      images,
    });
    await openScreen(page, activity, origin, 'seller', '/activity-center');
    await waitForImages(page);
    await waitForQuietNetwork(activity);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '05-seller-list-390x844.png') });
    await context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Screenshots written to ${OUTPUT_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
