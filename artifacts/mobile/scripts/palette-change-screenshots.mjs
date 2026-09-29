#!/usr/bin/env node
/**
 * Before/after verification for the black/white/silver palette change:
 * captures the seller and buyer screens Dev named, in the default preview
 * state and with the in-app `&demo=1` opt-in, at 393x852.
 *
 *   node scripts/palette-change-screenshots.mjs
 *   node scripts/palette-change-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/palette-change/393x852/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'palette-change');
const WORK_DIR = path.join(MOBILE_ROOT, '.store-screenshots');
const VIEWPORT = { width: 393, height: 852 };

async function shot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
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

const TARGETS = [
  { name: 'seller-dashboard', role: 'seller', route: '/' },
  { name: 'seller-products', role: 'seller', route: '/products' },
  { name: 'seller-orders', role: 'seller', route: '/orders' },
  { name: 'seller-profile', role: 'seller', route: '/profile' },
  { name: 'seller-studio', role: 'seller', route: '/studio' },
  { name: 'seller-add-product', role: 'seller', route: '/add-product' },
  { name: 'buyer-feed', role: 'buyer', route: '/feed' },
  { name: 'buyer-profile', role: 'buyer', route: '/profile' },
  { name: 'buyer-checkout', role: 'buyer', route: '/checkout' },
  { name: 'buyer-inbox', role: 'buyer', route: '/inbox' },
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
  const outDir = path.join(OUTPUT_ROOT, '393x852');
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  let index = 0;

  try {
    for (const target of TARGETS) {
      for (const demo of [false, true]) {
        const suffix = demo ? '-demo1' : '-fresh';
        const route = demo ? `${target.route}${target.route.includes('?') ? '&' : '?'}demo=1` : target.route;
        const { context, page, activity } = await openContext(browser, { device, role: target.role, origin, images });
        page.on('pageerror', (err) => console.log(`    (page error on ${target.name}${suffix}: ${err.message.split('\n')[0]})`));
        try {
          await openScreenReliably(page, activity, origin, target.role, route);
          await page.waitForTimeout(400);
          await waitForImages(page);
          await shot(page, outDir, ++index, `${target.name}${suffix}`);
        } catch (err) {
          console.log(`    (skipped ${target.name}${suffix}: ${err.message.split('\n')[0]})`);
        }
        await context.close();
      }
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
