#!/usr/bin/env node
/**
 * Seller money + ops round 2: renders every changed screen at 390x844 in the
 * seller web preview (fresh and &demo=1) and a few interactions (time zone
 * picker, shipping zone sheet, copy-code toast).
 *
 *   node scripts/store-screenshots/seller-ops-round2-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { respond } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/seller-ops-round2'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };

const SCREENS = [
  ['finance', '/finance'],
  ['payouts', '/payouts'],
  ['payout-detail', '/payout-detail?id=po_demo_1'],
  ['payout-schedule', '/payout-schedule'],
  ['payout-setup', '/payout-setup'],
  ['billing', '/billing'],
  ['plans', '/plans'],
  ['subscription', '/subscription'],
  ['taxes-duties', '/taxes-duties'],
  ['team', '/team'],
  ['store-settings', '/store-settings'],
  ['seller-data-export', '/seller-data-export'],
  ['shipping', '/shipping'],
  ['discounts', '/discounts'],
  ['gift-cards-manage', '/gift-cards-manage'],
  ['manufacturer-hub-production', '/manufacturer-hub?tab=production'],
  ['manufacturer-compare', '/manufacturer-compare'],
  ['manufacturer-onboard', '/manufacturer-onboard'],
  ['invite-manufacturer', '/invite-manufacturer'],
  ['request-sample', '/request-sample'],
  ['product-bundle-edit', '/product-bundle-edit'],
  ['integrations', '/integrations'],
  ['shopify-fulfillment', '/integrations/shopify-fulfillment'],
];

async function shot(browser, images, origin, name, target, demo, act) {
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  const file = `${name}${demo ? '-demo' : ''}`;
  // The demo seller has no age band, so the payout screens would stop at the
  // date-of-birth gate (lib/ageGate.ts). Report an adult account.
  await page.route(/\/auth\/me(\?|$)/, (route) => route.fulfill({
    json: { ...respond({ method: 'GET', path: '/auth/me', query: {}, role: 'seller' }), ageBand: '18_plus' },
  }));
  try {
    // The seller home can open its "Set up your store" sheet on first load;
    // close it before navigating so it doesn't sit over the target screen.
    const beforeNavigate = async () => {
      const later = page.getByText('Continue setup later').first();
      if (await later.isVisible().catch(() => false)) {
        await later.click();
        await page.waitForTimeout(600);
      }
    };
    const want = target.split('?')[0];
    for (let attempt = 0; attempt < 3; attempt++) {
      await openScreen(page, activity, origin, 'seller', target, { extraQuery: demo ? '&demo=1' : '', beforeNavigate });
      await waitForQuietNetwork(activity, 600, 10_000);
      await page.waitForTimeout(800);
      const onTarget = new URL(page.url()).pathname === want;
      const sheetUp = await page.getByText('Continue setup later').first().isVisible().catch(() => false);
      if (onTarget && !sheetUp) break;
    }
    await page.waitForTimeout(1500);
    await waitForImages(page, 6_000);
    if (act) await act(page);
    await page.screenshot({ path: path.join(OUT, `${file}.png`) });
    console.log(`Captured ${file}`);
  } catch (e) {
    console.error(`FAILED ${file}: ${e.message}`);
    await page.screenshot({ path: path.join(OUT, `${file}-FAILED.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function launchBrowser() {
  const { chromium } = await import('playwright');
  // PW_CHROMIUM lets a machine with a preinstalled Chromium (version-mismatched
  // with the pinned Playwright) point at it directly.
  return chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined);
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(process.env.BUILD_DIR ?? DEFAULT_BUILD_DIR);
  try {
    const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
    for (const [name, target] of SCREENS) {
      if (only && !only.test(name)) continue;
      await shot(browser, images, origin, name, target, false);
      await shot(browser, images, origin, name, target, true);
    }
    await shot(browser, images, origin, 'store-settings-timezone', '/store-settings', false, async (page) => {
      await page.getByText(/time zone/i).first().scrollIntoViewIfNeeded();
      await page.getByLabel(/time zone/i).first().click();
      await page.waitForTimeout(800);
      await page.getByPlaceholder(/search/i).last().fill('tok');
      await page.waitForTimeout(600);
    });
    await shot(browser, images, origin, 'shipping-zone-sheet', '/shipping', true, async (page) => {
      await page.getByText(/add zone|new zone/i).first().click();
      await page.waitForTimeout(800);
    });
    await shot(browser, images, origin, 'discounts-copy-toast', '/discounts', true, async (page) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      await page.getByText('WELCOME15').first().click();
      await page.waitForTimeout(800);
      await page.getByText('Copy code').first().click();
      await page.getByTestId('toast').waitFor({ timeout: 5_000 });
      await page.waitForTimeout(400);
    });
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
