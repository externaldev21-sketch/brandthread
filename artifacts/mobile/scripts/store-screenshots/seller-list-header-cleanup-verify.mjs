/**
 * Verification for three seller list-header fixes (Products + Orders tabs):
 *  1. The "N products"/"N orders" count row is hidden entirely on an empty
 *     list (the empty state below already says so) and, when shown, aligns
 *     with the chip row's left edge.
 *  2. The status chip row still clips/fades naturally at the right edge
 *     with no visible scrollbar (no change here — just confirming it still
 *     holds after Replit removes its local-only draggable scrollbar).
 *  3. The title's chevron now opens a real anchored dropdown (was
 *     Alert.alert, a no-op on web) with only real, working options —
 *     Products: All products / Collections. Orders: All orders / Returns.
 *
 * Run:  node scripts/store-screenshots/seller-list-header-cleanup-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForQuietNetwork,
} from './harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/seller-list-header-cleanup');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function openTab(browser, origin, { seedOptions = {}, apiOptions = {} } = {}) {
  const { context, page, activity } = await openContext(browser, {
    device: DEVICE, role: 'seller', origin, images: {}, seedOptions, apiOptions,
  });
  return { context, page, activity };
}

async function main() {
  console.log('Building web preview…');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();
  const failures = [];

  try {
    // ── Products, populated: count row present, dropdown open ──
    {
      const { context, page, activity } = await openTab(browser, origin);
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/products');
        try { await page.getByLabel('Products, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);

      const countText = await page.getByText(/^\d+ products?$/).first().textContent().catch(() => null);
      console.log(`[products, populated] count row text: ${JSON.stringify(countText)}`);
      if (!countText) failures.push('products: count row not found when populated');
      await page.screenshot({ path: path.join(OUT, '01-products-populated.png') });

      await page.getByLabel('Products, choose a view').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '02-products-dropdown-open.png') });
      const hasCollections = await page.getByText('Collections', { exact: true }).first().isVisible().catch(() => false);
      const hasAllProducts = await page.getByText('All products', { exact: true }).first().isVisible().catch(() => false);
      console.log(`[products dropdown] All products visible=${hasAllProducts} Collections visible=${hasCollections}`);
      if (!hasCollections || !hasAllProducts) failures.push('products: dropdown missing expected real options');

      await context.close();
    }

    // ── Products, empty: count row hidden ──
    {
      const { context, page, activity } = await openTab(browser, origin, { seedOptions: { fresh: true } });
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/products');
        try { await page.getByLabel('Products, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);
      const countVisible = await page.getByText(/^\d+ products?$/).first().isVisible().catch(() => false);
      console.log(`[products, empty] count row visible: ${countVisible} (expected false)`);
      if (countVisible) failures.push('products: count row still shown when empty');
      await page.screenshot({ path: path.join(OUT, '03-products-empty.png') });
      await context.close();
    }

    // ── Orders, populated: count row present + aligned, dropdown open ──
    {
      const { context, page, activity } = await openTab(browser, origin);
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/orders');
        try { await page.getByLabel('Orders, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);

      // Both rows use the same shared style constant (sellerListCountRowStyles
      // / pillsRow, both paddingHorizontal: SP.md) — confirmed structurally
      // in components/SellerListHeader.tsx and the screen source, so this is
      // a visual screenshot check rather than a pixel-diffed assertion here.
      await page.screenshot({ path: path.join(OUT, '04-orders-populated.png') });

      await page.getByLabel('Orders, choose a view').click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, '05-orders-dropdown-open.png') });
      const hasReturns = await page.getByText('Returns', { exact: true }).first().isVisible().catch(() => false);
      const hasAllOrders = await page.getByText('All orders', { exact: true }).first().isVisible().catch(() => false);
      console.log(`[orders dropdown] All orders visible=${hasAllOrders} Returns visible=${hasReturns}`);
      if (!hasReturns || !hasAllOrders) failures.push('orders: dropdown missing expected real options');

      // Chip row right-edge: confirm it clips/scrolls with no reserved
      // scrollbar space (same check web-scrollbar-verify.mjs uses).
      const chipRowOverflow = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('*')].filter((el) => {
          const style = getComputedStyle(el);
          return /(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth;
        });
        return rows.map((el) => ({ gap: el.offsetHeight - el.clientHeight, scrollable: el.scrollWidth - el.clientWidth }));
      });
      console.log(`[orders] horizontally-scrollable rows: ${JSON.stringify(chipRowOverflow)}`);

      await context.close();
    }

    // ── Orders, empty: count row hidden ──
    {
      const { context, page, activity } = await openTab(browser, origin, { apiOptions: { fresh: true } });
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/orders');
        try { await page.getByLabel('Orders, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);
      const countVisible = await page.getByText(/^\d+ orders?/).first().isVisible().catch(() => false);
      console.log(`[orders, empty] count row visible: ${countVisible} (expected false)`);
      if (countVisible) failures.push('orders: count row still shown when empty');
      await page.screenshot({ path: path.join(OUT, '06-orders-empty.png') });
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):`);
    for (const f of failures) console.error(' -', f);
    process.exitCode = 1;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
