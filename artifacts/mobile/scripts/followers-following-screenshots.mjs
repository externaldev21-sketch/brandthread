#!/usr/bin/env node
/**
 * Verification screenshots for the Followers/Following lists PR (PR2 of the
 * Instagram activity/follower-management mirror series) — see the PR
 * description for the Mobbin references each capture matches.
 *
 * Captures, at 375x667 / 390x844 / 430x932, for the buyer preview (plus one
 * seller shot per screen to confirm both roles share this screen):
 *  01 Followers tab (own list, with Remove buttons + a "Follows you" mutual)
 *  02 Following tab (with the Sort-by row)
 *  03 The sort bottom sheet open
 *  04 The search bar filtering results
 *  05 The remove-follower confirm sheet
 *  06 The "Removed" toast
 *  07 The unfollow confirm (tapping "Following" on the Following list)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR, DEFAULT_BUILD_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'followers-following-lists');
const IMAGES_DIR = path.join(WORK_DIR, 'demo-images');
const WIDTHS = [
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
];

async function captureFor(browser, origin, images, role, device) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: { width: device.width, height: device.height }, scale: 2, isMobile: true, userAgent: undefined },
    role,
    origin,
    images,
  });
  const tag = (name) => path.join(OUTPUT_DIR, `${name}-${role}-${device.id}.png`);

  // 01 — Followers tab (own list: no userId param).
  await openScreen(page, activity, origin, role, '/connections?type=followers');
  await waitForImages(page);
  await waitForQuietNetwork(activity);
  // The tabs row only paints once both /followers and /following have
  // resolved (Promise.all in app/connections.tsx) — wait for its text
  // instead of a fixed delay, which was flaky under load.
  const followingTab = page.locator('text=/\\d+ following/').first();
  await followingTab.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: tag('01-followers-own-list') });

  // 02 — Following tab (Sort-by row visible).
  if (await followingTab.count()) {
    await followingTab.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: tag('02-following-list') });

    // 03 — Sort-by bottom sheet.
    const sortRow = page.locator('text=Sort by').first();
    if (await sortRow.count()) {
      await sortRow.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: tag('03-sort-sheet') });
      // Close it (backdrop tap) before continuing.
      await page.keyboard.press('Escape').catch(() => {});
      await page.mouse.click(10, 10);
      await page.waitForTimeout(200);
    }

    // 07 — Unfollow confirm: tap a "Following" pill (aria-label, not the
    // ambiguous "text=Following" which also matches the tab label).
    const followingPill = page.locator('[aria-label="Following, tap to unfollow"]').first();
    if (await followingPill.count()) {
      await followingPill.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: tag('07-unfollow-confirm') });
      await page.mouse.click(10, 10);
      await page.waitForTimeout(200);
    }
  }

  // Back to Followers for the search + remove flow.
  const followersTab = page.locator('text=/\\d+ followers/').first();
  if (await followersTab.count()) {
    await followersTab.click();
    await page.waitForTimeout(300);
  }

  // 04 — Search bar filtering.
  const search = page.getByPlaceholder(/Search followers/i).first();
  if (await search.count()) {
    await search.click();
    await search.fill('Priya');
    await page.waitForTimeout(300);
    await page.screenshot({ path: tag('04-search-filter') });
    await search.fill('');
    await page.waitForTimeout(200);
  }

  // 05 — Remove-follower confirm sheet.
  const removeBtn = page.locator('text=Remove').first();
  if (await removeBtn.count()) {
    await removeBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: tag('05-remove-follower-confirm') });

    // 06 — Confirm → "Removed" toast.
    const confirmRemove = page.locator('text=Remove').last();
    if (await confirmRemove.count()) {
      await confirmRemove.click();
      await page.waitForTimeout(250);
      await page.screenshot({ path: tag('06-removed-toast') });
    }
  }

  await context.close();
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log('Building preview web export...');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, IMAGES_DIR);
  try {
    for (const device of WIDTHS) {
      await captureFor(browser, origin, images, 'buyer', device);
    }
    // One seller-preview pass at the reference width to confirm both roles
    // share this screen.
    await captureFor(browser, origin, images, 'seller', { id: '390x844', width: 390, height: 844 });
  } finally {
    await browser.close();
    close();
  }
  console.log(`Screenshots written to ${OUTPUT_DIR}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
