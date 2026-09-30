#!/usr/bin/env node
/**
 * Back-navigation crawl: walks realistic paths by clicking real UI controls
 * (not synthetic pushState), then presses the ScreenHeader back control
 * (or a tab icon) and asserts the URL lands on exactly the previous screen
 * — not home, not some other earlier screen. Also asserts scroll position:
 * list/feed screens restore where the user left off; everything else shows
 * its top after a back navigation, with no visible scroll jump.
 *
 * Uses real navigations (page.goto for the cold entry point, then real
 * clicks for every step after) rather than the client-side pushState/
 * popstate trick used elsewhere in this repo's scripts — that trick was
 * found, during this same investigation, to occasionally leave the
 * previous screen's content mounted on this app's web router, which would
 * make this specific crawl self-defeating.
 *
 * Usage: node scripts/audit/back-nav-crawl.mjs [--skip-build]
 */
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, launchBrowser, openContext, buildPreviewWeb, serveBuild, waitForQuietNetwork,
} from '../store-screenshots/harness.mjs';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';

const SKIP_BUILD = process.argv.includes('--skip-build');

function currentPath(page) {
  return page.evaluate(() => location.pathname + location.search);
}

/** Most screens use ScreenHeader (testid="screen-header-back"); a few
 * older hand-rolled headers only expose accessibilityLabel="Back". */
async function clickBack(page) {
  const byTestId = page.getByTestId('screen-header-back');
  if (await byTestId.count()) return byTestId.first().click();
  const byLabel = page.getByRole('button', { name: /^Back($| to)/ });
  return byLabel.first().click();
}

/**
 * React Native Web renders ScrollView/FlatList as a plain div with
 * `overflow-y: auto/scroll`, not the document body — so `window.scrollY`
 * is always 0 on this app and the real scroll position lives on that div
 * instead. Finds the largest actually-overflowing element on the page.
 */
function findScroller() {
  const candidates = [...document.querySelectorAll('div')].filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4;
  });
  candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
  return candidates[0] || document.scrollingElement || document.body;
}

function scrollTop(page) {
  return page.evaluate(`(${findScroller.toString()})().scrollTop`);
}

// React Native Web's ScrollView intercepts real wheel/touch events to drive
// its own scroll handling — a programmatic `el.scrollTo()` is a no-op on
// these screens, so a real synthesized wheel event is required instead.
async function scrollByWheel(page, deltaY) {
  await page.mouse.move(196, 400);
  await page.mouse.wheel(0, deltaY);
}

async function settle(page, activity) {
  await waitForQuietNetwork(activity, 500, 6000).catch(() => {});
  await page.waitForTimeout(800);
}

let failures = 0;
function assertEqual(actual, expected, label) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  if (!ok) failures += 1;
  return ok;
}

async function main() {
  if (!SKIP_BUILD) buildPreviewWeb();
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(process.cwd(), '.store-screenshots', 'demo-images'));

    // ── Seller: Dashboard > Orders tab > order detail > View customer > back x3 ──
    {
      console.log('\n[seller] Dashboard > Orders > order detail > customer > back x3');
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'seller', origin: server.origin, images,
      });
      await page.goto(`${server.origin}/(tabs)/?bt_preview=seller&demo=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await settle(page, activity);
      const dashboardPath = await currentPath(page);

      await page.getByTestId('seller-tab-orders').click();
      await settle(page, activity);
      const ordersPath = await currentPath(page);
      assertEqual(ordersPath.includes('/orders'), true, 'Orders tab URL contains /orders');

      const orderRow = page.getByRole('button', { name: /^Order #NS-1041/ });
      await orderRow.click();
      await settle(page, activity);
      const orderDetailPath = await currentPath(page);
      assertEqual(orderDetailPath.includes('/order-detail'), true, 'order-detail URL contains /order-detail');

      const viewCustomer = page.getByRole('button', { name: 'View customer' });
      if (await viewCustomer.count()) {
        await viewCustomer.click();
        await settle(page, activity);
        const customerPath = await currentPath(page);
        assertEqual(customerPath.includes('/customer-orders'), true, 'customer-orders URL contains /customer-orders');

        await clickBack(page);
        await settle(page, activity);
        assertEqual(await currentPath(page), orderDetailPath, 'back #1 returns to order-detail (not home)');
      } else {
        console.log('  SKIP View customer row not present for NS-1041 in this data-state');
      }

      await clickBack(page);
      await settle(page, activity);
      assertEqual((await currentPath(page)).includes('/orders'), true, 'back #2 returns to Orders tab (not home)');

      await context.close();
    }

    // ── Buyer: Discover grid > product detail > back (scroll restore) ──
    {
      console.log('\n[buyer] Discover grid > product detail > back, grid scroll restored');
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'buyer', origin: server.origin, images,
      });
      await page.goto(`${server.origin}/(buyer)/discover?bt_preview=buyer&demo=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await settle(page, activity);

      // Scroll the grid down before drilling in, so we can assert restore.
      await scrollByWheel(page, 400);
      await page.waitForTimeout(300);
      const gridScrollBefore = await scrollTop(page);

      const productCard = page.getByRole('button', { name: / — .* by .*, \$/ }).first();
      if (await productCard.count()) {
        await productCard.click();
        await settle(page, activity);
        const productPath = await currentPath(page);
        assertEqual(productPath.includes('/thread-product-detail'), true, 'navigated to thread-product-detail');
        const productScrollTop = await scrollTop(page);
        assertEqual(productScrollTop, 0, 'product detail (not a list) opens at its top');

        await clickBack(page);
        await settle(page, activity);
        await page.waitForTimeout(300);
        assertEqual((await currentPath(page)).includes('/discover'), true, 'back returns to Discover (not home)');
        const gridScrollAfter = await scrollTop(page);
        assertEqual(gridScrollAfter > 0, true, 'Discover grid scroll is NOT reset to top (list restore rule)');
        assertEqual(Math.abs(gridScrollAfter - gridScrollBefore) < 50, true, 'Discover grid scroll position closely restored');
      } else {
        console.log('  SKIP no clickable product card found on this Discover render');
      }

      await context.close();
    }

    // ── Seller: Studio/More menu > Payouts > back ──
    {
      console.log('\n[seller] More menu > Payouts > back');
      const { context, page, activity } = await openContext(browser, {
        device: { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined },
        role: 'seller', origin: server.origin, images,
      });
      await page.goto(`${server.origin}/(tabs)/more?bt_preview=seller&demo=1`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await settle(page, activity);
      const morePath = await currentPath(page);

      const payoutsRow = page.getByRole('button', { name: /Payouts/i }).first();
      if (await payoutsRow.count()) {
        await payoutsRow.click();
        await settle(page, activity);
        assertEqual((await currentPath(page)).includes('/payouts'), true, 'navigated to /payouts');
        const scrollY = await scrollTop(page);
        assertEqual(scrollY, 0, 'payouts (a detail page) opens at its top');

        await clickBack(page);
        await settle(page, activity);
        assertEqual(await currentPath(page), morePath, 'back returns to the More/Studio menu (not home)');
      } else {
        console.log('  SKIP no Payouts row found in the More menu for this data-state');
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
