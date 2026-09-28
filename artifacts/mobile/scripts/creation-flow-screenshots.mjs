#!/usr/bin/env node
/**
 * Screenshots of the restyled Thread-creation picker/camera/editor (PR 1 of
 * the Instagram-modeled creation flow — see docs/creation-flows.md) at three
 * viewport sizes, for side-by-side comparison against the Mobbin reference
 * frames in docs/polish/screenshots/creation-flow/mobbin-reference/.
 *
 *   node scripts/creation-flow-screenshots.mjs
 *   node scripts/creation-flow-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/creation-flow/ours/<viewport>/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT,
  WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'creation-flow', 'ours');

const VIEWPORTS = [
  { id: '375x667', width: 375, height: 667 },
  { id: '390x844', width: 390, height: 844 },
  { id: '430x932', width: 430, height: 932 },
];

/**
 * openScreen's client-side pushState can race the app's own initial
 * AuthGate redirect (still settling on "/" right as we navigate away from
 * it) and lose — the app's effect then wins and the URL stays put. Retry
 * the navigation until the URL actually reflects the target.
 */
async function openScreenReliably(page, activity, origin, role, target, opts = {}) {
  const { openScreen: openScreenFn } = opts;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreenFn(page, activity, origin, role, target);
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

async function runViewport(browser, { origin, images, viewport }) {
  console.log(`\n== ${viewport.id} ==`);
  const outDir = path.join(OUTPUT_ROOT, viewport.id);
  const device = { viewport: { width: viewport.width, height: viewport.height }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  page.on('console', (msg) => { if (msg.type() === 'error') console.log(`    (console.error: ${msg.text().slice(0, 200)})`); });
  let index = 0;

  try {
    // ── 01: Picker, empty ──────────────────────────────────────────────
    await openScreenReliably(page, activity, origin, 'buyer', '/create-post?accountType=buyer', { openScreen });
    await page.waitForSelector('text=New Thread', { timeout: 15_000 });
    await waitForImages(page);
    await shot(page, outDir, ++index, 'picker-empty');

    // ── 02: Camera (web fallback — expo-camera has no web implementation,
    // camera-capture.tsx renders CameraCaptureWeb instead) ───────────────
    await page.getByLabel('Open camera').click();
    await page.waitForSelector('text=Camera capture is mobile-only', { timeout: 15_000 });
    await shot(page, outDir, ++index, 'camera-web-fallback');
    await page.getByText('Back to upload options').click();
    await page.waitForSelector('text=New Thread', { timeout: 15_000 });

    // ── 03: Picker, photo selected via the web "Choose from files" tile ──
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByLabel('Choose from files').click(),
    ]);
    await chooser.setFiles(images['hoodie-ember']);
    await page.waitForSelector('[data-testid="picker-next-btn"], text=Next', { timeout: 15_000 }).catch(() => {});
    await waitForImages(page);
    await shot(page, outDir, ++index, 'picker-selected');

    // ── 04: Photo crop — Instagram's post-creation crop step (item 115) ──
    const nextBtn = page.getByTestId('picker-next-btn');
    if (await nextBtn.count()) await nextBtn.click();
    else await page.getByText('Next', { exact: true }).click();
    await waitForQuietNetwork(activity, 500, 5_000);
    await page.waitForSelector('text=Edit', { timeout: 15_000 });
    await waitForImages(page);
    await shot(page, outDir, ++index, 'photo-crop');

    // ── 05: Editor (slide-edit — a single photo builds a one-slide Thread) ─
    await page.getByTestId('crop-next-btn').click();
    await waitForQuietNetwork(activity, 500, 5_000);
    await waitForImages(page);
    await shot(page, outDir, ++index, 'editor-slide-edit');

    // ── 06: Details step (caption row + Tag people pill) ─────────────────
    const slideNextBtn = page.getByTestId('slide-editor-next-btn');
    if (await slideNextBtn.count()) await slideNextBtn.click();
    await waitForQuietNetwork(activity, 500, 5_000);
    await page.waitForSelector('[data-testid="post-details-caption-row"]', { timeout: 15_000 }).catch(() => {});
    await waitForImages(page);
    await shot(page, outDir, ++index, 'post-details');

    // ── 07: Caption screen — full-screen entry, chip row above keyboard ───
    const captionRow = page.getByTestId('post-details-caption-row');
    if (await captionRow.count()) {
      await captionRow.click();
      await page.waitForSelector('text=Caption', { timeout: 15_000 });
      await shot(page, outDir, ++index, 'caption-screen');

      // ── 08: Tag people sheet, reached from the caption chip row ─────────
      await page.getByTestId('caption-chip-tag-people').click();
      await page.waitForSelector('[data-testid="tag-people-search"]', { timeout: 15_000 });
      await shot(page, outDir, ++index, 'tag-people-sheet');
      await page.getByTestId('tag-people-done-btn').click().catch(() => {});
      await page.getByTestId('caption-done-btn').click().catch(() => {});
    }
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
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));

  try {
    for (const viewport of VIEWPORTS) {
      await runViewport(browser, { origin, images, viewport });
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
