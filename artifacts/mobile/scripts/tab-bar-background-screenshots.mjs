#!/usr/bin/env node
/**
 * Zoomed capture of the buyer and seller floating tab bars at 390x844, used
 * to verify that nothing square or rectangular is drawn behind or around
 * the rounded pills: only the pills have fills, and the area around them is
 * transparent so the screen shows through.
 *
 * Each bar gets a full-screen shot plus a 4x crop of the bottom strip, once
 * as-is and once over a bright checkerboard inserted behind the bar, so a stray square backdrop, shadow box
 * or blur layer around the pills stands out against it.
 *
 *   node scripts/tab-bar-background-screenshots.mjs [--skip-build] [--label before|after]
 *
 * Output: docs/polish/screenshots/tab-bar-background/<label>/<NN-step>.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const labelIndex = process.argv.indexOf('--label');
const LABEL = labelIndex > -1 ? process.argv[labelIndex + 1] : 'after';
const OUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'tab-bar-background', LABEL);
const VIEWPORT = { width: 390, height: 844 };

async function capture(page, testID, name, index) {
  mkdirSync(OUT_DIR, { recursive: true });
  const prefix = path.join(OUT_DIR, `${String(index).padStart(2, '0')}-${name}`);
  await page.screenshot({ path: `${prefix}-full.png`, animations: 'disabled', caret: 'hide' });
  const box = await page.getByTestId(testID).boundingBox();
  const clip = { x: 0, y: Math.max(0, box.y - 24), width: VIEWPORT.width, height: box.height + 48 };
  await page.screenshot({ path: `${prefix}-zoom.png`, clip, animations: 'disabled', caret: 'hide' });
  // Same crop over a bright checkerboard slipped in directly behind the
  // bar (as its preceding sibling), so any square layer, shadow box or blur
  // rectangle around the pills shows up instead of blending into black.
  await page.evaluate((id) => {
    const bar = document.querySelector(`[data-testid="${id}"]`);
    const probe = document.createElement('div');
    probe.setAttribute('data-probe', '1');
    Object.assign(probe.style, {
      position: 'absolute', left: '0', right: '0', bottom: '0', height: '220px',
      backgroundColor: '#ffffff',
      backgroundImage: 'linear-gradient(45deg,#bbb 25%,transparent 25%,transparent 75%,#bbb 75%),linear-gradient(45deg,#bbb 25%,transparent 25%,transparent 75%,#bbb 75%)',
      backgroundSize: '16px 16px', backgroundPosition: '0 0, 8px 8px',
    });
    const z = getComputedStyle(bar).zIndex;
    probe.style.zIndex = z === 'auto' ? '0' : String(Number(z) - 1);
    if (z === 'auto' || z === '0') bar.style.zIndex = '1';
    bar.parentElement.insertBefore(probe, bar);
  }, testID);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${prefix}-zoom-checker.png`, clip, animations: 'disabled', caret: 'hide' });
  // Same again with the bar promoted to its own compositing layer, the
  // state it is in while sliding on/off screen (its translateY transform).
  await page.evaluate((id) => {
    const bar = document.querySelector(`[data-testid="${id}"]`);
    bar.style.willChange = 'transform';
    bar.style.transform = 'translateY(0.01px)';
  }, testID);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${prefix}-zoom-checker-composited.png`, clip, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(MOBILE_ROOT, prefix)}-{full,zoom,zoom-checker,zoom-checker-composited}.png`);
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const device = { viewport: VIEWPORT, scale: 4, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

  try {
    const seller = await openContext(browser, { device, role: 'seller', origin, images });
    await openScreen(seller.page, seller.activity, origin, 'seller', '/');
    await seller.page.waitForSelector('[data-testid="seller-global-tab-bar"]', { timeout: 30_000 });
    await waitForImages(seller.page);
    await seller.page.waitForTimeout(800);
    await capture(seller.page, 'seller-global-tab-bar', 'seller', 1);
    await seller.context.close();

    const buyer = await openContext(browser, { device, role: 'buyer', origin, images });
    await openScreen(buyer.page, buyer.activity, origin, 'buyer', '/discover');
    await buyer.page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 30_000 });
    await waitForImages(buyer.page);
    await buyer.page.waitForTimeout(800);
    await capture(buyer.page, 'buyer-bottom-tab-bar', 'buyer', 2);
    await buyer.context.close();
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
