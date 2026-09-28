#!/usr/bin/env node
/**
 * Verification screenshots for item 116 ("Reel editor: trim, speed, text,
 * audio"), run against dev as it stands today (item 115's photo-crop/photo-
 * Effects work is a separate, still-unmerged PR and isn't part of this
 * verification). The Text tool is shared code between the video editor and
 * the photo slideshow editor (both use the same `EditorToolChip` row in
 * app/create-post.tsx), so it's captured here via the photo path, which this
 * sandbox's headless Chromium can actually render.
 *
 * The video-only Trim and Speed controls, and real video playback, could NOT
 * be captured live: this sandbox's Chromium build has no H.264 decoder
 * (`<video>` throws "Failed to load because no supported source was found"
 * for every real .mp4 in the repo, including assets already bundled with
 * the app) — an environment limitation, not an app bug. Trim/speed were
 * instead verified by reading app/create-post.tsx: both are sent as real
 * fields (`trimStart`, `trimEnd`, `clip.speed`) to the real
 * `api.posts.composeVideo` call, which post-video.ts applies via ffmpeg.
 * See docs/creation-flows.md for the full write-up.
 *
 *   node scripts/reel-editor-verify-screenshots.mjs
 *   node scripts/reel-editor-verify-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/reel-editor/ours/<viewport>/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'reel-editor', 'ours');
const WORK_DIR = path.join(MOBILE_ROOT, '.store-screenshots');

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

async function runViewport(browser, { origin, images, viewport }) {
  console.log(`\n== ${viewport.id} ==`);
  const outDir = path.join(OUTPUT_ROOT, viewport.id);
  const device = { viewport: { width: viewport.width, height: viewport.height }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  let index = 0;

  try {
    await openScreenReliably(page, activity, origin, 'seller', '/create-post?accountType=seller');
    await page.waitForSelector('text=New Thread', { timeout: 15_000 });

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByLabel('Choose from files').click(),
    ]);
    await chooser.setFiles(images['hoodie-ember']);
    await page.waitForSelector('[data-testid="picker-next-btn"], text=Next', { timeout: 15_000 }).catch(() => {});
    const nextBtn = page.getByTestId('picker-next-btn');
    if (await nextBtn.count()) await nextBtn.click();
    // This branch is cut from dev as-is: no photo-crop step and no photo
    // Effects/filter chip (both are item 115's, still unmerged) — Next from
    // the picker goes straight to slide-edit, whose tool row here is only
    // Text/Sticker/Overlay/Audio.
    await page.waitForSelector('[data-testid="slide-tool-text"]', { timeout: 15_000 });
    await waitForImages(page);
    await shot(page, outDir, ++index, 'slide-editor');

    // Text tool
    await page.getByTestId('slide-tool-text').click();
    await page.waitForTimeout(400);
    await shot(page, outDir, ++index, 'text-overlay-editor');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);

    // Audio — honest "coming soon" empty state (no sound catalog backend yet)
    await page.getByTestId('slide-tool-audio').click();
    await page.waitForSelector('text=Sound library coming soon.', { timeout: 15_000 });
    await shot(page, outDir, ++index, 'audio-sheet-empty-state');
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
