#!/usr/bin/env node
/**
 * Live-verification screenshots for the share-profile 1:1 rebuild.
 * Builds the preview web export, opens the buyer and seller profile screens
 * with the demo harness, taps "Share profile", cycles the three background
 * variants, exercises the three tiles, and opens the QR scanner — saving a
 * screenshot after each step to docs/pr-review/share-profile-1to1/.
 *
 *   node scripts/share-profile-1to1-screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'share-profile-1to1');
mkdirSync(OUTPUT_DIR, { recursive: true });

const VIEWPORT = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
  console.log('  saved', name);
}

async function run() {
  if (!process.env.SKIP_BUILD) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  } else {
    console.log('Skipping build (SKIP_BUILD set), reusing existing export...');
  }
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const consoleErrors = [];

  try {
    for (const role of ['buyer', 'seller']) {
      console.log(`\n=== role: ${role} ===`);
      const { context, page, activity } = await openContext(browser, { device: VIEWPORT, role, origin, images });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin }).catch(() => {});
      page.on('pageerror', (err) => consoleErrors.push(`[${role}] pageerror: ${err.message}`));
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`[${role}] console.error: ${msg.text()}`); });

      const profilePath = role === 'buyer' ? '/(buyer)/profile' : '/seller-profile?isOwner=true';
      await openScreen(page, activity, origin, role, profilePath);
      await page.getByText('Share profile', { exact: false }).first().waitFor({ timeout: 60000 }).catch((e) => {
        console.log('  (readiness wait failed:', e.message.split('\n')[0], ')');
      });
      await page.waitForTimeout(1000);
      await waitForImages(page);
      await waitForQuietNetwork(activity, 500, 8000);
      await shot(page, `${role}-01-profile-with-share-button`);

      // Tap "Share profile" — buyer has a labeled button; seller has an icon
      // button (testID seller-share-profile-btn) plus a text row.
      const shareBtn = role === 'buyer'
        ? page.getByText('Share profile', { exact: false }).first()
        : page.getByTestId('seller-profile-share-btn');
      await shareBtn.click({ timeout: 10000 }).catch(async () => {
        await page.getByText('Share profile', { exact: false }).first().click({ timeout: 10000 });
      });
      await page.waitForTimeout(800);
      await shot(page, `${role}-02-share-profile-color`);

      // Cycle to EMOJI
      await page.getByTestId('share-profile-style-pill').click();
      await page.waitForTimeout(500);
      await shot(page, `${role}-03-share-profile-emoji`);

      // Cycle to SELFIE
      await page.getByTestId('share-profile-style-pill').click();
      await page.waitForTimeout(500);
      await waitForImages(page);
      await shot(page, `${role}-04-share-profile-selfie`);

      // Back to COLOR for a clean scanner-entry screenshot
      await page.getByTestId('share-profile-style-pill').click();
      await page.waitForTimeout(300);

      // Tiles: Copy link -> expect "Link copied" toast
      await page.getByTestId('share-profile-tile-copy-link').click();
      await page.waitForTimeout(400);
      await shot(page, `${role}-05-copy-link-toast`);
      await page.waitForTimeout(2000); // let toast dismiss

      // Download tile -> expect a captured/downloaded image, no crash
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
        page.getByTestId('share-profile-tile-download').click(),
      ]);
      await page.waitForTimeout(600);
      console.log('  download event:', download ? await download.suggestedFilename() : 'none (native path / no-op)');
      await shot(page, `${role}-06-download-tile`);
      await page.waitForTimeout(2000);

      // Share profile tile -> web fallback (copies link or no-ops cleanly)
      await page.getByTestId('share-profile-tile-share-profile').click();
      await page.waitForTimeout(500);
      await shot(page, `${role}-07-share-tile`);
      await page.waitForTimeout(2000);

      // QR scanner
      await page.getByTestId('share-profile-scan').click();
      await page.waitForTimeout(800);
      await shot(page, `${role}-08-qr-scanner`);

      // Back out of scanner, close sheet
      await page.getByTestId('qr-scanner-back').click();
      await page.waitForTimeout(300);
      await page.getByTestId('share-profile-close').click();
      await page.waitForTimeout(300);

      await context.close();
    }
  } catch (err) {
    console.log('\n--- error during run ---', err.message);
  } finally {
    console.log('\nConsole/page errors observed:', consoleErrors.length);
    for (const e of consoleErrors) console.log(' -', e);
    close();
    await browser.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
