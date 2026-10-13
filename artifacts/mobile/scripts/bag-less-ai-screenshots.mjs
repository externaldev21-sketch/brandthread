#!/usr/bin/env node
/**
 * Bag "less AI" pass (rows, seller free-shipping line, pinned total block,
 * empty state) on the store-screenshots harness: signed-in demo buyer,
 * seeded two-seller cart, fake API (Field Office has a $200 free-shipping
 * threshold; Northline has none).
 *
 *   node scripts/bag-less-ai-screenshots.mjs <buildDir> <outDir> <prefix> [width] [height]
 *
 * Captures the bag at rest, the seller headers, the bag after raising Field
 * Office's quantity past its threshold, and the empty bag; prints
 * measurements (thumbnail size, header lines, total block, Shop Threads
 * destination) as JSON.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/less-ai-bag'));
const PREFIX = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 393), height: Number(process.argv[6] ?? 852) };
mkdirSync(OUT, { recursive: true });

async function openBag(browser, images, origin, apiOptions, waitFor) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, apiOptions });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, origin, 'buyer', '/(buyer)/cart');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByText(waitFor).first().waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate(() => { history.pushState(history.state, '', '/cart?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate')); });
    }
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  return { context, page };
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = { viewport: VIEWPORT };
  try {
    const { context, page } = await openBag(browser, images, server.origin, {}, /^Cart \(\d+\)$/);
    const shot = async (name, clip) => {
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`), ...(clip ? { clip } : {}) });
      console.log(`  ✓ ${PREFIX}-${name}`);
    };
    await shot('01-bag');

    Object.assign(results, await page.evaluate(() => {
      const row = document.querySelector('[data-testid^="cart-row-"]');
      let box = row?.querySelector('img') ?? null;
      while (box && box !== row && (box.getBoundingClientRect().height === 0 || getComputedStyle(box).borderTopWidth === '0px')) box = box.parentElement;
      const img = box && box !== row ? box.getBoundingClientRect() : null;
      const block = document.querySelector('[data-testid="cart-total-block"]')?.getBoundingClientRect();
      return {
        thumbnail: img ? { w: Math.round(img.width), h: Math.round(img.height), ratio: +(img.width / img.height).toFixed(3) } : null,
        sellerHeaders: [...document.querySelectorAll('[data-testid^="cart-seller-header-"]')].map((el) => el.innerText.replace(/\n+/g, ' | ')),
        totalBlock: block ? { top: Math.round(block.top), bottom: Math.round(block.bottom), height: Math.round(block.height), text: document.querySelector('[data-testid="cart-total-block"]').innerText.replace(/\n+/g, ' | ') } : null,
        viewportH: innerHeight,
      };
    }));

    const firstRow = await page.locator('[data-testid^="cart-row-"]').first().boundingBox();
    const firstHeader = await page.locator('[data-testid^="cart-seller-header-"]').first().boundingBox();
    if (firstHeader && firstRow) {
      await shot('02-header-and-row', { x: 0, y: Math.max(0, firstHeader.y - 8), width: VIEWPORT.width, height: Math.min(firstRow.y + firstRow.height - firstHeader.y + 16, 400) });
    }

    // Scroll to the second seller (Field Office, $200 threshold).
    const fieldHeader = page.locator('[data-testid="cart-seller-header-user_field"]');
    if (await fieldHeader.count()) {
      // RN-web's ScrollView ignores Playwright's scrollIntoViewIfNeeded here;
      // scroll the element itself to the top of the list.
      await page.evaluate(() => document.querySelector('[data-testid="cart-seller-header-user_field"]')?.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(600);
      await shot('03-second-seller');
      // Raise the Trail Runner to 2 → $330 ≥ $200: the line flips to "Free shipping".
      const inc = page.locator('[data-testid="cart-qty-line_3-increment"]');
      if (await inc.count()) {
        await inc.click();
        await page.waitForTimeout(1500);
        await shot('04-second-seller-free-shipping');
        results.sellerHeadersAfterQty = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="cart-seller-header-"]')].map((el) => el.innerText.replace(/\n+/g, ' | ')));
      }
    }
    await context.close();

    const empty = await openBag(browser, images, server.origin, { emptyCart: true }, /cart is empty/i);
    await empty.page.waitForTimeout(300);
    await empty.page.screenshot({ path: path.join(OUT, `${PREFIX}-05-empty.png`) });
    console.log(`  ✓ ${PREFIX}-05-empty`);
    results.emptyText = await empty.page.evaluate(() => (document.querySelector('[data-testid="cart-empty"]') ?? document.body).innerText.replace(/\n+/g, ' | ').slice(0, 300));
    const shop = empty.page.getByText('Shop Threads').first();
    if (await shop.count()) {
      await shop.click();
      await empty.page.waitForTimeout(2500);
      results.shopThreadsUrl = new URL(empty.page.url()).pathname;
    }
    await empty.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
