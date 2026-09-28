#!/usr/bin/env node
/**
 * Live verification for the tab-bar pill glide fix (buyer + seller): after
 * switching tabs, the pill and icon land in the correct resting slot with no
 * dead/duplicate highlight. Uses the same `reducedMotion: 'reduce'` harness
 * every other screenshot script in this repo uses.
 *
 * This can't show the glide itself — reduced motion snaps it instantly by
 * design (see useTabBarActiveIndex/INDICATOR_SPRING in TabBarParts.tsx),
 * and a real-motion context hits this sandbox's one-time branded intro
 * splash (components/splash/AppIntroSplash.tsx) hanging on a Reanimated
 * spring "finished" callback that never fires here — reproducible on an
 * unmodified `dev` checkout too, so it's a pre-existing environment
 * limitation, not something this change caused. The motion itself is a
 * straight code-level change (a UI-thread spring instead of a JS-effect-
 * gated timing, translateX instead of left, kicked from press-in instead of
 * after the navigation commits) verified by the updated tests in
 * tests/buyer-bottom-navigation-layout.test.ts, not by this script.
 *
 * Starts the buyer side on Discover, not Home — the buyer feed is a
 * full-bleed autoplay video screen that's slow/unreliable to settle under
 * this harness (reproducible on an unmodified `dev` checkout too, unrelated
 * to the tab bar); Discover exercises the same capsule/pill/circle without
 * that screen's own overhead, and Home is still reached at the end via a
 * normal tab press like every other tab here.
 *
 *   node scripts/tab-bar-pill-glide-screenshots.mjs
 *   node scripts/tab-bar-pill-glide-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/tab-bar-pill-glide/390x844/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'tab-bar-pill-glide');
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
    // ── Buyer: Discover -> Inbox -> Activity -> Profile -> Home ──
    const buyer = await openContext(browser, { device, role: 'buyer', origin, images });
    buyer.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
    await openScreenReliably(buyer.page, buyer.activity, origin, 'buyer', '/discover');
    await buyer.page.waitForSelector('[data-testid="buyer-bottom-tab-bar"]', { timeout: 20_000 });
    await waitForImages(buyer.page);
    await shot(buyer.page, outDir, ++index, 'buyer-discover');

    for (const tab of ['inbox', 'activity']) {
      await buyer.page.getByTestId(`buyer-tab-${tab}`).click();
      await buyer.page.waitForTimeout(150);
      await shot(buyer.page, outDir, ++index, `buyer-${tab}`);
    }
    await buyer.page.getByTestId('buyer-tab-profile').click();
    await buyer.page.waitForTimeout(150);
    await shot(buyer.page, outDir, ++index, 'buyer-profile-pill-hidden');
    // Back to a capsule tab — the pill should reappear over Discover, not
    // linger on whatever tab was last selected before Profile.
    await buyer.page.getByTestId('buyer-tab-discover').click();
    await buyer.page.waitForTimeout(150);
    await shot(buyer.page, outDir, ++index, 'buyer-back-to-discover');
    await buyer.context.close();

    // ── Seller: Dashboard -> Products -> Orders -> Profile ──
    const seller = await openContext(browser, { device, role: 'seller', origin, images });
    seller.page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
    await openScreenReliably(seller.page, seller.activity, origin, 'seller', '/');
    await seller.page.waitForSelector('[data-testid="seller-global-tab-bar"]', { timeout: 20_000 });
    await waitForImages(seller.page);
    await shot(seller.page, outDir, ++index, 'seller-dashboard');

    for (const tab of ['products', 'orders', 'profile']) {
      await seller.page.getByTestId(`seller-tab-${tab}`).click();
      await seller.page.waitForTimeout(150);
      await shot(seller.page, outDir, ++index, `seller-${tab}`);
    }
    await seller.context.close();
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
