#!/usr/bin/env node
/**
 * Screenshots of the camera-first Create screen (components/create-post/
 * CreateCamera.tsx, opened by app/create-post.tsx) at 393x852 on the web
 * preview, for the PR: live camera, mode dropdown, every duration chip,
 * recording state, camera-roll sheet, buyer dropdown, and the no-camera
 * black placeholder.
 *
 *   node scripts/create-camera-screenshots.mjs            # builds first
 *   node scripts/create-camera-screenshots.mjs --skip-build
 *
 * Chromium is launched with a fake webcam (--use-fake-device-for-media-stream)
 * so the live preview and MediaRecorder path are exercised for real; the
 * last capture runs without it to show the placeholder.
 *
 * Output: docs/pr-screenshots/create-camera/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, openContext, openScreen, serveBuild, waitForImages,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-screenshots', 'create-camera');
const DEVICE = {
  viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};

async function openCreate(page, activity, origin, role) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, `/create-post${role === 'buyer' ? '?accountType=buyer' : ''}`);
    await page.waitForTimeout(600);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith('/create-post')) break;
  }
  await page.waitForSelector('[data-testid="create-camera-shutter"]', { timeout: 20_000 });
  await waitForImages(page);
}

let index = 0;
async function shot(page, name) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${String(++index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function run({ origin }) {
  const { chromium } = await import('playwright');
  rmSync(OUTPUT_DIR, { recursive: true, force: true });

  // ── With a (fake) webcam ──
  const browser = await chromium.launch({
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  try {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
    await context.grantPermissions(['camera', 'microphone'], { origin });
    page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));

    await openCreate(page, activity, origin, 'seller');
    await page.waitForTimeout(1200);
    await shot(page, 'camera');

    await page.getByTestId('create-camera-mode-title').click();
    await page.waitForSelector('[data-testid="create-camera-mode-menu"]');
    await page.waitForTimeout(300);
    await shot(page, 'mode-dropdown');
    await page.getByTestId('create-camera-mode-thread').click();
    await page.waitForTimeout(200);

    for (const chip of ['10m', '60s', '30s', '15s', 'photo']) {
      await page.getByTestId(`create-camera-chip-${chip}`).click();
      await page.waitForTimeout(350);
      await shot(page, `chip-${chip}`);
    }

    await page.getByTestId('create-camera-timer').click();
    await page.waitForTimeout(200);
    await shot(page, 'timer-3s');
    await page.getByTestId('create-camera-timer').click();
    await page.getByTestId('create-camera-timer').click(); // back to off
    await page.waitForTimeout(100);

    await page.getByTestId('create-camera-chip-15s').click();
    await page.waitForTimeout(300);
    await page.getByTestId('create-camera-shutter').click();
    await page.waitForTimeout(2600);
    await shot(page, 'recording');
    await page.getByTestId('create-camera-shutter').click();
    // A finished clip lands in the existing video editor.
    await page.waitForTimeout(1500);
    await shot(page, 'after-record-video-edit');

    // Back to the camera: reopen the screen fresh for the picker sheet.
    await openCreate(page, activity, origin, 'seller');
    await page.waitForTimeout(600);
    await page.getByTestId('create-camera-roll').click();
    await page.waitForSelector('text=New Thread', { timeout: 15_000 });
    await page.waitForTimeout(500);
    await shot(page, 'camera-roll-sheet');
    await page.getByLabel('Close').first().click();
    await page.waitForSelector('[data-testid="create-camera-shutter"]', { timeout: 15_000 });
    await page.waitForTimeout(400);
    await shot(page, 'back-to-camera-from-sheet');
    await context.close();

    // Buyer: Post / Story only.
    const buyer = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images: {} });
    await buyer.context.grantPermissions(['camera', 'microphone'], { origin });
    await openCreate(buyer.page, buyer.activity, origin, 'buyer');
    await buyer.page.waitForTimeout(800);
    await buyer.page.getByTestId('create-camera-mode-title').click();
    await buyer.page.waitForSelector('[data-testid="create-camera-mode-menu"]');
    await buyer.page.waitForTimeout(300);
    await shot(buyer.page, 'buyer-mode-dropdown');
    await buyer.context.close();
  } finally {
    await browser.close();
  }

  // ── Without any camera: clean black placeholder, same chrome ──
  const plain = await chromium.launch();
  try {
    const { context, page, activity } = await openContext(plain, { device: DEVICE, role: 'seller', origin, images: {} });
    await openCreate(page, activity, origin, 'seller');
    await page.waitForTimeout(1200);
    await shot(page, 'no-camera-placeholder');
    await context.close();
  } finally {
    await plain.close();
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  if (!skipBuild) buildPreviewWeb();
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await run({ origin: server.origin });
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
