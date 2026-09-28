#!/usr/bin/env node
/**
 * Item 104 — live check of size chips + sold-out treatment at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer,
 * fake API). The product comes from GET /api/public/products/:id — for the
 * sold-out-mixed run the script serves the harness's own product row with
 * `stock: 0` on two sizes, so "sold out" flows through the app's real
 * stock → isAvailable mapping (services/cartService.ts adaptApiProduct), not
 * a UI flag. Checks, on the product page and in the feed's Shop sheet:
 *   - in-stock set: every size chip enabled, none struck
 *   - sold-out-mixed set: sold-out sizes disabled, struck through, announced
 *     "sold out"; tapping one does nothing; an in-stock size still selects
 *
 *   node scripts/variant-sold-out-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/variant-sold-out-104/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/variant-sold-out-104');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';
const SOLD_OUT = ['M', 'XL'];

async function open(browser, images, origin, { soldOut, target }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  if (soldOut) {
    await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}`), async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      // The harness's own product row for this id, with two sizes at stock 0.
      const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
      const body = {
        ...base,
        variants: base.variants.map((v) => (SOLD_OUT.includes(v.size) ? { ...v, stock: 0, inventoryQuantity: 0, available: false } : v)),
      };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(body),
      });
    });
  }
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', target);
    try { await page.getByRole('radio', { name: /^Size, / }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(500);
  return { context, page };
}

/** Each size chip as the buyer (and a screen reader) gets it. */
async function chips(page) {
  return page.evaluate(() => [...document.querySelectorAll('[role="radio"]')]
    .filter((el) => /^Size, /.test(el.getAttribute('aria-label') ?? '') && el.offsetParent !== null)
    .map((el) => {
      // The label is the last text leaf (a sold-out chip leads with the slash icon glyph).
      const text = [...el.querySelectorAll('div')].filter((d) => d.children.length === 0 && d.textContent.trim()).at(-1);
      return {
        label: el.getAttribute('aria-label'),
        disabled: el.getAttribute('aria-disabled') === 'true',
        struck: !!text && getComputedStyle(text).textDecorationLine.includes('line-through'),
      };
    }));
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const soldOut of [false, true]) {
      const tag = soldOut ? 'sold-out-mixed' : 'in-stock';
      const { context, page } = await open(browser, images, server.origin, { soldOut, target: `/buyer-product-detail?productId=${PRODUCT}` });
      const size = page.getByRole('radio', { name: /^Size, / }).first();
      await size.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      console.log(`  product page, ${tag}:`, JSON.stringify(await chips(page)));
      if (soldOut) {
        await page.getByRole('radio', { name: 'Size, M, sold out' }).click({ force: true });
        await page.waitForTimeout(300);
        const afterSoldOutTap = await page.getByRole('radio', { name: 'Size, M, sold out' }).evaluate((el) => el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected'));
        await page.getByRole('radio', { name: 'Size, L' }).click();
        await page.waitForTimeout(300);
        const afterInStockTap = await page.getByRole('radio', { name: 'Size, L' }).evaluate((el) => el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected'));
        console.log('    tap sold-out M → selected:', afterSoldOutTap, '| tap in-stock L → selected:', afterInStockTap);
      }
      await page.screenshot({ path: path.join(OUT, `product-page-${tag}.jpg`), type: 'jpeg', quality: 82 });
      await context.close();
    }
    // The feed's Shop sheet (unchanged by this PR) with the same sold-out-mixed
    // product — for comparison: it already strikes sold-out sizes (dashed chip).
    {
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
      await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}`), (route) => {
        if (route.request().method() === 'OPTIONS') return route.fallback();
        const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
        return route.fulfill({
          status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' },
          body: JSON.stringify({ ...base, variants: base.variants.map((v) => (SOLD_OUT.includes(v.size) ? { ...v, stock: 0, inventoryQuantity: 0, available: false } : v)) }),
        });
      });
      for (let attempt = 0; ; attempt++) {
        await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
        try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity);
      const guide = page.getByTestId('feed-gesture-guide');
      if (await guide.isVisible().catch(() => false)) {
        await guide.click({ position: { x: 10, y: 10 } });
        await page.waitForTimeout(400);
      }
      const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
      await pill.click({ timeout: 8_000 });
      await page.waitForTimeout(700);
      await pill.click({ timeout: 8_000 });
      await page.getByTestId('shop-product-sheet').waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1200);
      const sheetChips = await page.getByTestId('shop-product-sheet').evaluate((el) => [...el.querySelectorAll('[role="radio"]')]
        .map((c) => ({ label: c.getAttribute('aria-label'), disabled: c.getAttribute('aria-disabled') === 'true' })));
      console.log('  shop sheet (unchanged), sold-out-mixed:', JSON.stringify(sheetChips));
      await page.getByTestId('shop-product-sheet').getByRole('radio').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, 'shop-sheet-sold-out-mixed-unchanged.jpg'), type: 'jpeg', quality: 82 });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
