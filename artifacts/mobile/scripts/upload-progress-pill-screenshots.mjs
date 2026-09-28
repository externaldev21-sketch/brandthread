#!/usr/bin/env node
/**
 * Verification screenshots for item 118 ("Upload progress pill in feed
 * header after posting"). Mobbin reference: Instagram's own posting-
 * progress row — docs/creation-flows.md row 9 (11b-posting-progress.webp).
 *
 * Drives the real UploadProgressPill component via the same
 * lib/postUploadProgress.ts store the real composer flow uses, through a
 * screenshot/e2e-only bridge the component exposes under the existing
 * bt_preview gate (components/feed/UploadProgressPill.tsx) — chasing the
 * real composer -> background-persist -> client navigation chain end to end
 * in this harness hit a real limitation: openScreen() always does a full
 * page.goto() reload, which wipes the module-level store, so it can't be
 * used again after the in-app Post tap without destroying the very state
 * being verified. The component and the store it reads are both real and
 * already exercised by app/create-post.tsx's actual Post-button handler;
 * this script's job is to verify the PILL renders correctly for each real
 * status the store can be in.
 *
 *   node scripts/upload-progress-pill-screenshots.mjs
 *   node scripts/upload-progress-pill-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/upload-progress-pill/ours/<viewport>/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'upload-progress-pill', 'ours');

const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844 },
];

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

async function shot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function runViewport(browser, { origin, viewport }) {
  console.log(`\n== ${viewport.id} ==`);
  const outDir = path.join(OUTPUT_ROOT, viewport.id);
  const device = { viewport: { width: viewport.width, height: viewport.height }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  let index = 0;

  try {
    await openScreenReliably(page, activity, origin, 'seller', '/feed');
    await page.waitForFunction(() => !!(window).__btUploadProgress, undefined, { timeout: 20_000 });
    // Dismiss the "Watching Threads" gesture-guide overlay if it's up, so it
    // doesn't sit over the pill in the screenshot.
    const gestureGuideDismiss = page.getByText('Tap to keep watching');
    if (await gestureGuideDismiss.count()) await gestureGuideDismiss.click();

    // Real "uploading" state.
    await page.evaluate(() => {
      (window).__btUploadProgress.startPostUpload({ id: 'demo-1', kind: 'thread', thumbnailUri: undefined });
      (window).__btUploadProgress.updatePostUploadProgress('demo-1', 0.55);
    });
    await page.waitForSelector('[data-testid="upload-progress-pill"]', { timeout: 5_000 });
    await waitForImages(page);
    await shot(page, outDir, ++index, 'pill-uploading');

    // Real "success" state.
    await page.evaluate(() => (window).__btUploadProgress.completePostUpload('demo-1'));
    await page.waitForTimeout(200);
    await shot(page, outDir, ++index, 'pill-success');

    // Real "failed" state (a fresh entry, since success auto-clears).
    await page.evaluate(() => {
      (window).__btUploadProgress.startPostUpload({ id: 'demo-2', kind: 'thread', thumbnailUri: undefined });
      (window).__btUploadProgress.failPostUpload('demo-2');
    });
    await page.waitForTimeout(200);
    await shot(page, outDir, ++index, 'pill-failed');
  } catch (error) {
    console.error(`  ✗ ${viewport.id}: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, outDir, ++index, 'FAILED-state').catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });

  if (!skipBuild) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();

  try {
    for (const viewport of VIEWPORTS) {
      await runViewport(browser, { origin, viewport });
    }
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
