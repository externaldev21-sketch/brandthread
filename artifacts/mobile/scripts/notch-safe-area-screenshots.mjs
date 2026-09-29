#!/usr/bin/env node
/**
 * Before/after verification for the notch-safe-area sweep: 10 screens whose
 * header previously sat under the notch/Dynamic Island on web (insets.top
 * reads 0 there), now migrated onto the shared useHeaderTopInset() hook.
 *
 *   node scripts/notch-safe-area-screenshots.mjs
 *   node scripts/notch-safe-area-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/notch-safe-area-sweep/390x844/<NN-step>.png
 * (cropped to the top ~160px so the header's position vs. the simulated
 * notch is easy to read at a glance)
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'notch-safe-area-sweep');
const WORK_DIR = path.join(MOBILE_ROOT, '.store-screenshots');
const VIEWPORT = { width: 390, height: 844 };
// Top crop only — where the bug (and the fix) actually lives.
const HEADER_CLIP = { x: 0, y: 0, width: 390, height: 170 };

async function shot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', clip: HEADER_CLIP });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

// 10 offenders spanning every root cause fixed in this sweep: the
// AnalyticsHeader group, the WEB_SAFE_AREA_TOP=47 group, the long-tail
// hand-rolled `paddingTop: insets.top` group, the embedded/onboarding
// pattern, a modal presentation, and DiscoverSearchHeader.
const TARGETS = [
  { name: 'buyer-discover', role: 'buyer', route: '/discover' },
  { name: 'seller-orders', role: 'seller', route: '/orders' },
  { name: 'seller-analytics-sales', role: 'seller', route: '/analytics-sales' },
  { name: 'seller-inventory', role: 'seller', route: '/inventory' },
  { name: 'seller-app-theme', role: 'seller', route: '/app-theme' },
  { name: 'seller-admin-reports', role: 'seller', route: '/admin-reports' },
  { name: 'forgot-password', role: 'buyer', route: '/forgot-password' },
  { name: 'thread-explainer', role: 'buyer', route: '/thread-explainer' },
  { name: 'store-preview', role: 'seller', route: '/store-preview' },
  { name: 'buyer-report', role: 'buyer', route: '/buyer-report' },
];

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
  const outDir = path.join(OUTPUT_ROOT, '390x844');
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  let index = 0;

  try {
    for (const target of TARGETS) {
      const { context, page, activity } = await openContext(browser, { device, role: target.role, origin, images });
      page.on('pageerror', (err) => console.log(`    (page error on ${target.name}: ${err.message.split('\n')[0]})`));
      try {
        await openScreenReliably(page, activity, origin, target.role, target.route);
        await page.waitForTimeout(400);
        await waitForImages(page);
        await shot(page, outDir, ++index, target.name);
      } catch (err) {
        console.log(`    (skipped ${target.name}: ${err.message.split('\n')[0]})`);
      }
      await context.close();
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
