#!/usr/bin/env node
/**
 * Verification screenshots for the first-run tips system (PR 1): one real
 * example of each of the 4 variants, captured at 393x852, plus a console
 * check of the must-have rules from the PR (auth-flow exclusion, the
 * plain-preview suppression, and the &tips=1 force-show override).
 *
 * Dev's rule: the plain signed-out/dev web preview (?bt_preview=...) never
 * shows tips at all, even on a "fresh" demo account — only ?bt_preview=...
 * &tips=1 forces them to show, for his own testing. So every screenshot
 * below is captured with &tips=1.
 *
 *   node scripts/first-run-tips-screenshots.mjs
 *   node scripts/first-run-tips-screenshots.mjs --skip-build
 *
 * Output: docs/pr-review/first-run-tips-system/393/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, 'docs', 'pr-review', 'first-run-tips-system', '393');
const VIEWPORT = { width: 393, height: 852 };

/** Expo Router's client-side pushState navigation is occasionally missed by
 *  the app on the very first attempt; retry until the pathname actually
 *  changed (same pattern as scripts/upload-progress-pill-screenshots.mjs). */
async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

async function shot(page, name) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const file = path.join(OUTPUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  let failed = false;
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

    // ── 1) fullscreen — Design Studio ──────────────────────────────────────
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/ai-studio?tips=1');
      await page.waitForTimeout(900);
      await shot(page, '01-fullscreen-design-studio');
    }

    // ── 2) anchored — Mockup to Model ──────────────────────────────────────
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/design-mockup-to-model?tips=1');
      await page.waitForTimeout(900);
      await shot(page, '02-anchored-mockup-to-model');
    }

    // ── 3) gesture — Seller inbox ───────────────────────────────────────────
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/seller-inbox?tips=1');
      await page.waitForTimeout(900);
      await shot(page, '03-gesture-seller-inbox');
    }

    // ── 4) spotlight — Buyer product detail ─────────────────────────────────
    {
      const { page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'buyer', '/buyer-product-detail?productId=prod_nl_hoodie_ember&tips=1');
      await page.waitForTimeout(1100);
      await shot(page, '04-spotlight-buyer-product-detail');
    }

    // ── Rule checks (console-verified, not screenshots) ─────────────────────
    console.log('\nRule checks:');

    // a) Plain preview (no &tips=1) NEVER shows a tip, even on an otherwise
    //    fresh demo account.
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/seller-inbox');
      await page.waitForTimeout(900);
      const shown = await page.locator('text=Swipe a conversation').count();
      console.log(`  plain preview (no &tips=1) never shows a tip: ${shown === 0 ? 'PASS' : 'FAIL'}`);
      if (shown !== 0) failed = true;
    }

    // b) &tips=1 forces the same screen to show its tip.
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/seller-inbox?tips=1');
      await page.waitForTimeout(900);
      const shown = await page.locator('text=Swipe a conversation').count();
      console.log(`  &tips=1 forces the tip to show: ${shown > 0 ? 'PASS' : 'FAIL'}`);
      if (shown === 0) failed = true;
    }

    // c) &tips=1 re-shows a tip already dismissed earlier in the same session
    //    (force-show ignores "already seen" state entirely).
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/seller-inbox?tips=1');
      await page.waitForTimeout(900);
      await page.evaluate(() => document.body.click()); // dismiss (tap anywhere)
      await page.waitForTimeout(300);
      await openScreenReliably(page, activity, origin, 'seller', '/seller-inbox?tips=1');
      await page.waitForTimeout(900);
      const shown = await page.locator('text=Swipe a conversation').count();
      console.log(`  &tips=1 re-shows an already-dismissed tip: ${shown > 0 ? 'PASS' : 'FAIL'}`);
      if (shown === 0) failed = true;
    }

    // d) Auth-flow routes never show a tip, even with &tips=1.
    {
      const { page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
      await openScreenReliably(page, activity, origin, 'seller', '/sign-in?tips=1');
      await page.waitForTimeout(900);
      const anyTip = await page.locator('[testID^="first-run-tip-"]').count();
      console.log(`  auth-flow route (sign-in) never shows a tip, even with &tips=1: ${anyTip === 0 ? 'PASS' : 'FAIL'}`);
      if (anyTip !== 0) failed = true;
    }
  } finally {
    await browser.close();
    close();
  }
  if (failed) {
    console.error('\nOne or more rule checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll screenshots captured and rule checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
