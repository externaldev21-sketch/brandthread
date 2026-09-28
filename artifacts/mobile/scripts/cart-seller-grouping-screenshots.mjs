#!/usr/bin/env node
/**
 * Item 101c — live check of the cart's per-seller grouping at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer
 * with a 3-line / 3-seller cart, fake API) and checks:
 *   - one section per seller, lines under their own seller's header, in the
 *     same seller order checkout's delivery groups use (groupCartBySeller)
 *   - the seller header opens that seller's store
 *   - a horizontal drag on a seller header does nothing (not swipeable)
 *   - when the 101a swipe / 101b stepper are present in the build (testIDs
 *     cart-row-* / cart-qty-*-increment), line swipe + stepper still work
 *
 *   node scripts/cart-seller-grouping-screenshots.mjs [--skip-build] [--out=<dir>]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { CART } from './store-screenshots/demo-data.mjs';

const outArg = process.argv.find((arg) => arg.startsWith('--out='));
const OUT = outArg ? path.resolve(outArg.slice(6)) : path.join(MOBILE_ROOT, 'docs/pr-review/cart-seller-grouping-101c');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function touchDrag(page, locator, dx) {
  const b = await locator.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 12, y, id: 1 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(600);
}

/** Largest translateX anywhere inside the locator (0 when nothing moved). */
async function maxShift(locator) {
  return locator.evaluate((el) => Math.max(0, ...[el, ...el.querySelectorAll('div')].map((d) => {
    const m = /translateX\((-?[\d.]+)px\)/.exec(d.style?.transform ?? '');
    return m ? Math.abs(Number(m[1])) : 0;
  })));
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)/cart');
      try { await page.locator('[data-testid^="cart-seller-header-"]').first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    await waitForImages(page);

    // Sections, in order, with their lines — vs the order groupCartBySeller
    // (the checkout's delivery-group source) produces for the same cart.
    const sections = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="cart-seller-"]')]
      .filter((el) => !el.getAttribute('data-testid').startsWith('cart-seller-header-'))
      .map((el) => ({
        sellerId: el.getAttribute('data-testid').slice('cart-seller-'.length),
        header: el.querySelector('[data-testid^="cart-seller-header-"]')?.innerText.split('\n').filter((t) => t.trim().length > 1)[0],
        lines: [...el.innerText.matchAll(/\n([^\n]+ — [^\n]+)\n/g)].map((m) => m[1]),
      })));
    const expectedOrder = [...new Set(CART.items.map((i) => i.sellerId))];
    console.log('  sections:', JSON.stringify(sections));
    console.log('  same seller order as checkout grouping:', JSON.stringify(sections.map((s) => s.sellerId)) === JSON.stringify(expectedOrder));
    await page.screenshot({ path: path.join(OUT, '01-sections-top.jpg'), type: 'jpeg', quality: 82 });
    await page.locator('[data-testid^="cart-seller-"]').nth(2).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(OUT, '02-sections-lower.jpg'), type: 'jpeg', quality: 82 });

    // Header is not swipeable.
    const header = page.locator('[data-testid^="cart-seller-header-"]').first();
    await header.scrollIntoViewIfNeeded();
    const section = page.locator('[data-testid^="cart-seller-"]').first();
    await touchDrag(page, header, -170);
    console.log('  header drag -> max shift in section:', await maxShift(section));

    // Optional: 101a swipe + 101b stepper, when present in this build.
    const hasSwipe = await page.locator('[data-testid^="cart-row-"]').count();
    const hasStepper = await page.locator('[data-testid$="-increment"]').count();
    if (hasStepper) {
      const qty = page.getByTestId('cart-qty-line_1');
      await page.getByTestId('cart-qty-line_1-increment').click();
      await page.waitForTimeout(600);
      console.log('  stepper + ->', (await qty.innerText()).trim(), '| row shift:', await maxShift(section));
      await page.getByTestId('cart-qty-line_1-decrement').click();
      await page.waitForTimeout(600);
    }
    if (hasSwipe) {
      await touchDrag(page, page.getByTestId('cart-row-line_1').getByText('Heavyweight Hoodie — Ember'), -170);
      console.log('  line swipe -> row shift:', await maxShift(page.getByTestId('cart-row-line_1')));
      await page.screenshot({ path: path.join(OUT, '03-line-swipe-with-grouping.jpg'), type: 'jpeg', quality: 82 });
      await page.getByTestId('cart-row-line_1').getByText('Heavyweight Hoodie — Ember').click();
      await page.waitForTimeout(600);
    }

    // Header opens the seller's store.
    await header.click();
    await page.waitForTimeout(1500);
    console.log('  header tap ->', page.url().replace(server.origin, ''));
    await waitForImages(page);
    await page.screenshot({ path: path.join(OUT, '04-header-opens-store.jpg'), type: 'jpeg', quality: 82 });
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
