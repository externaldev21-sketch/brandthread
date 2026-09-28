#!/usr/bin/env node
/**
 * Live verification for the navigation-smoothness audit (Dev's top-priority
 * item): seller Dashboard/Products/Orders/Order-detail instant-load via the
 * new warmSellerTabs + order-detail stale-while-revalidate cache seeding,
 * and buyer Cart's expo-image switch. Captures each screen right after
 * navigating to it (no artificial wait for a spinner to clear) — if the
 * cache-seeding/prefetch work is doing its job, real content should already
 * be visible in that first frame instead of a loading state.
 *
 *   node scripts/nav-smoothness-audit-screenshots.mjs
 *   node scripts/nav-smoothness-audit-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/nav-smoothness-audit/<viewport>/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'nav-smoothness-audit');
const WORK_DIR = path.join(MOBILE_ROOT, '.store-screenshots');
const VIEWPORT = { width: 390, height: 844 };

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
    // ── Seller: Dashboard, Products, Orders — should show real data
    // immediately (warmSellerTabs), not a loading skeleton/spinner. ──
    const seller = await openContext(browser, { device, role: 'seller', origin, images });
    seller.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));

    await openScreenReliably(seller.page, seller.activity, origin, 'seller', '/');
    await seller.page.waitForSelector('[data-testid="seller-global-tab-bar"]', { timeout: 20_000 });
    await seller.page.waitForTimeout(300); // let warmSellerTabs' fire-and-forget calls settle
    await waitForImages(seller.page);
    await shot(seller.page, outDir, ++index, 'seller-dashboard');

    await seller.page.getByTestId('seller-tab-products').click();
    await seller.page.waitForTimeout(200);
    await waitForImages(seller.page);
    await shot(seller.page, outDir, ++index, 'seller-products');

    await seller.page.getByTestId('seller-tab-orders').click();
    await seller.page.waitForTimeout(200);
    await waitForImages(seller.page);
    await shot(seller.page, outDir, ++index, 'seller-orders');

    // Tap the first order row — order-detail.tsx should paint from the
    // cache orders.tsx just seeded, not a blocking spinner.
    const firstOrder = seller.page.getByRole('button', { name: /^Order / } ).first();
    if (await firstOrder.count()) {
      await firstOrder.click();
      await seller.page.waitForTimeout(50); // capture the very first frame, before any refetch could resolve
      await shot(seller.page, outDir, ++index, 'order-detail-first-frame');
      await seller.page.waitForTimeout(400);
      await shot(seller.page, outDir, ++index, 'order-detail-settled');
    } else {
      console.log('    (no order rows found in demo data — skipping order-detail capture)');
    }
    await seller.context.close();

    // ── Buyer: Cart — expo-image (CachedImage) for product thumb + seller avatar ──
    const buyer = await openContext(browser, { device, role: 'buyer', origin, images });
    buyer.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
    await openScreenReliably(buyer.page, buyer.activity, origin, 'buyer', '/cart');
    await waitForImages(buyer.page);
    await shot(buyer.page, outDir, ++index, 'buyer-cart');
    await buyer.context.close();
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
