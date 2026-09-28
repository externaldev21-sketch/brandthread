#!/usr/bin/env node
/**
 * Fastest-booting variant: reuses an already-exported static build
 * (`.store-screenshots/web-build`, produced once by an earlier
 * `buildPreviewWeb()` run) instead of rebuilding — the app bundle never
 * references demo-data.mjs (that file only answers the Node-side Playwright
 * route interception), so a stale build is still valid after editing seed
 * data. Just `serveBuild()` + capture, no Metro bundle step at all.
 *
 * Falls back to a fresh `buildPreviewWeb()` if no build is cached yet.
 */
import { existsSync, mkdirSync } from 'node:fs';
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

/** Finds the whole-row bounding box (the row container, not just the text run). */
async function rowBox(page) {
  const row = page.locator('[aria-label*="started following you"]').first();
  if (!(await row.count())) return null;
  return row.boundingBox().catch(() => null);
}

/** Swipe-left simulation: many small, paced pointer moves starting the
 * instant the pointer goes down (a single fast down→move→up, or too few
 * steps, reads as a tap to React Native Web's PanResponder, not a drag). */
async function swipeAndCapture(page, device) {
  const box = await rowBox(page);
  if (!box) return false;
  const y = box.y + box.height / 2;
  const startX = box.x + box.width - 20;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // A big first jump (well past PanResponder's dx<-8 claim threshold)
  // before any smaller incremental moves — claiming the responder on the
  // very first sample is what keeps the underlying Pressable from treating
  // this as a tap once the pointer lifts, regardless of total distance.
  await page.mouse.move(startX - 20, y);
  await page.waitForTimeout(80);
  for (let dx = 25; dx <= 100; dx += 5) {
    await page.mouse.move(startX - dx, y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUTPUT_DIR, `02-swipe-revealed-${device.id}.png`) });
  // Success iff the URL is still the Activity screen's own — a mis-read
  // tap navigates to the actor's profile (a different route) instead,
  // which (confusingly) shares both "Activity"-adjacent text and its own
  // unrelated "More options" button, so DOM content isn't reliable here;
  // the URL is unambiguous.
  return page.url().includes('activity-center');
}

/** Long-press: opens the same "..." menu the swipe-revealed button does
 * (activity-center.tsx wires both to `onOpenMenu`) — used as the reliable
 * trigger for menu/confirm-sheet/toast screenshots, since simulating the
 * PanResponder swipe with synthetic pointer events is not reliably
 * reproducible headless (see PR caveats). */
async function longPressOpenMenu(page) {
  const box = await rowBox(page);
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForTimeout(400);
  return true;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) {
    console.log('No cached build found — building once...');
    buildPreviewWeb();
  } else {
    console.log('Reusing cached build at', DEFAULT_BUILD_DIR);
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, IMAGES_DIR);
  try {
    for (const device of WIDTHS) {
      console.log(`Capturing ${device.id}...`);
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: device.width, height: device.height }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'buyer',
        origin,
        images,
      });
      await openScreen(page, activity, origin, 'buyer', '/activity-center');
      await page.waitForSelector('text=Highlights', { timeout: 30_000 }).catch(() => {});
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `01-list-${device.id}.png`) });

      const swiped = await swipeAndCapture(page, device);
      console.log(`  swiped: ${swiped}`);

      // Reload to a clean list regardless of whether the swipe drag was
      // correctly read as a drag or (headless Playwright pointer-event
      // quirk) as a tap-through to the profile — long-press is the
      // reliable trigger for the menu (same `onOpenMenu` handler the
      // swipe-revealed "..." button calls).
      await openScreen(page, activity, origin, 'buyer', '/activity-center');
      await page.waitForSelector('text=Highlights', { timeout: 30_000 }).catch(() => {});
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(500);
      const longPressed = await longPressOpenMenu(page);
      console.log(`  long-press opened menu: ${longPressed}`);
      if (longPressed) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, `03-menu-open-${device.id}.png`) });

        const removeFollowerBtn = page.locator('text=Remove follower').first();
        if (await removeFollowerBtn.count()) {
          await removeFollowerBtn.click({ force: true });
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(OUTPUT_DIR, `04-remove-follower-confirm-${device.id}.png`) });

          if (device.id === '390x844') {
            const removeBtn = page.locator('text=Remove').last();
            if (await removeBtn.count()) {
              await removeBtn.click({ force: true });
              await page.waitForTimeout(300);
              await page.screenshot({ path: path.join(OUTPUT_DIR, `05-removed-toast-${device.id}.png`) });
            }
          }
        }
      }
      await context.close();
    }

    // Block-from-menu — separate context so a fresh unremoved follower row exists.
    {
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'buyer', origin, images,
      });
      await openScreen(page, activity, origin, 'buyer', '/activity-center');
      await page.waitForSelector('text=Highlights', { timeout: 30_000 }).catch(() => {});
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(600);
      if (await longPressOpenMenu(page)) {
        const blockBtn = page.locator('text=Block').first();
        if (await blockBtn.count()) {
          await blockBtn.click({ force: true });
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUTPUT_DIR, '06-block-from-menu-390x844.png') });
        }
      }
      await context.close();
    }

    // Seller list.
    {
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'seller', origin, images,
      });
      await openScreen(page, activity, origin, 'seller', '/activity-center');
      await page.waitForSelector('text=Activity', { timeout: 30_000 }).catch(() => {});
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '07-seller-list-390x844.png') });
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(`Screenshots written to ${OUTPUT_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
