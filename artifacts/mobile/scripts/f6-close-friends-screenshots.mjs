#!/usr/bin/env node
/**
 * Verification screenshots for item 84 "Close Friends for top buyers".
 *
 *   node scripts/f6-close-friends-screenshots.mjs
 *   node scripts/f6-close-friends-screenshots.mjs --skip-build
 *
 * The seller web preview never calls the API (services/closeFriendsService.ts
 * serves fixtures with ?demo=1 and an empty state without it), so no
 * page.route mocks are needed.
 *
 * Output: docs/pr-assets/close-friends/ours/<NN-step>.png (repo root)
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'close-friends', 'ours');
const VIEWPORT = { id: '390x844', width: 390, height: 844 };

async function openScreenReliably(page, activity, origin, role, target, extraQuery) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target, { extraQuery });
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) {
      // The client-side push passes through "/" (no query) for a frame, and
      // the screen's first load can read the preview's demo flag then.
      // Reloading on the target URL mounts it with the query in place.
      await page.reload();
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await page.waitForTimeout(1500);
      return;
    }
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

async function shot(page, index, name) {
  mkdirSync(OUTPUT_ROOT, { recursive: true });
  const file = path.join(OUTPUT_ROOT, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function withContext(browser, origin, fn) {
  const device = { viewport: { width: VIEWPORT.width, height: VIEWPORT.height }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  try {
    await fn(page, activity);
  } catch (error) {
    console.error(`  ✗ ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 99, 'FAILED-state').catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });
  if (!skipBuild) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  let index = 0;
  try {
    // 1. Entry point: Seller Settings > Privacy & safety > Close Friends
    await withContext(browser, origin, async (page, activity) => {
      await openScreenReliably(page, activity, origin, 'seller', '/seller-settings', '&demo=1');
      await page.getByText('Customer privacy', { exact: true }).first().waitFor({ timeout: 20_000 });
      await page.getByText('Close Friends', { exact: true }).first().scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 120));
      await page.waitForTimeout(400);
      await shot(page, ++index, 'seller-settings-entry');
    });

    // 2-4. The screen with demo data
    await withContext(browser, origin, async (page, activity) => {
      await openScreenReliably(page, activity, origin, 'seller', '/seller-close-friends', '&demo=1');
      await page.getByTestId('seller-cf-section-topBuyers').waitFor({ timeout: 20_000 });
      await waitForImages(page);
      await shot(page, ++index, 'list-and-top-buyers');

      await page.getByTestId('seller-cf-row-preview-cf-sam').click();
      await page.getByTestId('seller-cf-row-preview-cf-jordan').click();
      await page.waitForTimeout(300);
      await shot(page, ++index, 'top-buyers-added');

      await page.getByPlaceholder('Search').fill('pri');
      await page.waitForTimeout(300);
      await shot(page, ++index, 'search');
    });

    // 5. Fresh seller with no buyers or followers yet
    await withContext(browser, origin, async (page, activity) => {
      await openScreenReliably(page, activity, origin, 'seller', '/seller-close-friends', '');
      await page.getByText('No one to add yet').waitFor({ timeout: 20_000 });
      await shot(page, ++index, 'empty');
    });
  } finally {
    await browser.close();
    close();
  }
  console.log(`\nDone. Screenshots in ${path.relative(MOBILE_ROOT, OUTPUT_ROOT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
