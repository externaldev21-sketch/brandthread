#!/usr/bin/env node
/**
 * Cart line item layout (Dev's spec), live at 390×844 on the store-screenshots
 * harness: signed-in demo buyer, seeded multi-seller cart, fake API.
 *
 * Captures the bag at rest and scrolled, then measures:
 *  - the image's size and aspect ratio;
 *  - the Remove text's color;
 *  - the height of every line control's tap target;
 *  - that no "Buy" control is left on any line;
 *  - the "Checkout from {Seller}" buttons.
 * Taps one seller's checkout and records which items the created checkout
 * holds.
 *
 *   node scripts/cart-line-item-screenshots.mjs <origin> <outDir> [prefix]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER } from './store-screenshots/demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/cart-line-item-layout'));
const PREFIX = process.argv[4] ?? 'after';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };
const API = 'https://api.brandthread.test';

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' };
    if (p === '/api/buyer/cart/validate') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"isValid":true,"issues":[]}' });
    if (/^\/api\/buyer\/sellers\/[^/]+\/payment-status$|payment-status/.test(p)) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"ready":true}' });
    return route.fallback();
  });
  page.setDefaultNavigationTimeout(240_000);
  await openScreen(page, activity, ORIGIN, 'buyer', '/(buyer)/cart');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByText(/^Cart \(\d+\)$/).first().waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate(() => { history.pushState(history.state, '', '/cart?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate')); });
    }
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) });
    console.log(`  ✓ ${PREFIX}-${name}`);
  };
  await shot('01-bag-top');

  const results = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid^="cart-row-"]')];
    const firstRow = rows[0];
    const img = firstRow?.querySelector('img');
    const imgBox = img ? img.parentElement.getBoundingClientRect() : null;
    const buttons = [...(firstRow?.querySelectorAll('[role="button"],[role="checkbox"],button') ?? [])]
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => ({ label: el.getAttribute('aria-label'), h: Math.round(el.getBoundingClientRect().height), w: Math.round(el.getBoundingClientRect().width) }));
    const removeText = [...(firstRow?.querySelectorAll('div,span') ?? [])].find((el) => el.textContent === 'Remove' && el.children.length === 0);
    return {
      rows: rows.length,
      image: imgBox ? { w: Math.round(imgBox.width), h: Math.round(imgBox.height), ratio: +(imgBox.width / imgBox.height).toFixed(3) } : null,
      removeColor: removeText ? getComputedStyle(removeText).color : null,
      removeFontSize: removeText ? getComputedStyle(removeText).fontSize : null,
      lineButtons: buttons,
      buyOnAnyLine: rows.some((row) => [...row.querySelectorAll('*')].some((el) => el.textContent === 'Buy' && el.children.length === 0)),
      groupCheckouts: [...document.querySelectorAll('[data-testid^="cart-group-checkout-"]')].map((el) => el.innerText.trim()),
    };
  });

  const first = page.locator('[data-testid^="cart-row-"]').first();
  const box = await first.boundingBox();
  if (box) {
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-02-line-item-closeup.png`), clip: { x: 0, y: Math.max(0, box.y - 8), width: VIEWPORT.width, height: Math.min(box.height + 16, 420) } });
    console.log(`  ✓ ${PREFIX}-02-line-item-closeup`);
  }
  const groupBtn = page.locator('[data-testid^="cart-group-checkout-"]').first();
  if (await groupBtn.count()) {
    await groupBtn.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot('03-group-subtotal-checkout-from-seller');
    await groupBtn.click();
    await page.waitForTimeout(2500);
    results.afterGroupCheckoutUrl = new URL(page.url()).pathname;
    results.checkoutItems = await page.evaluate((key) => {
      const s = JSON.parse(localStorage.getItem(key) ?? 'null');
      return s ? s.deliveryGroups.map((g) => ({ seller: g.sellerName, items: g.items.map((i) => i.productName) })) : null;
    }, `bt:checkout:${BUYER_USER.id}:v1`);
    await shot('04-checkout-for-that-seller');
  } else {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(600);
    await shot('03-bag-scrolled');
  }
  await context.close();
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
