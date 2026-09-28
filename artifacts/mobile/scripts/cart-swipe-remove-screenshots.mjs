#!/usr/bin/env node
/**
 * Item 101a — live check of cart swipe-to-remove at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer
 * with a 3-item / 3-seller cart, fake API) and, with a real pointer drag:
 *   - swipes a line left to reveal Save for later + Remove
 *   - taps Remove → the line leaves the cart, the Undo toast appears, and the
 *     cart is synced to POST /api/buyer/cart/sync without that line
 *   - taps Undo → the line comes back (and re-syncs)
 *   - swipes another line and taps Save → it moves to Saved for later
 *   - a short / vertical drag does NOT open the row (scroll still works)
 *
 *   node scripts/cart-swipe-remove-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/cart-swipe-remove-101a/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/cart-swipe-remove-101a');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

/**
 * A real touch drag across a row (CDP touch events — the same touchstart /
 * touchmove / touchend sequence a phone sends), starting on its product name.
 */
async function drag(page, lineId, dx, dy = 0) {
  const row = page.getByTestId(`cart-row-${lineId}`);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  const x = box.x + box.width * 0.7;
  const y = box.y + 30;
  const cdp = await page.context().newCDPSession(page);
  const point = (px, py) => [{ x: px, y: py, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) });
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x + (dx * i) / steps, y + (dy * i) / steps) });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(450);
}

async function lineIds(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-testid^="cart-row-"]')].map((el) => el.getAttribute('data-testid').slice(9)));
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const origin = server.origin;
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    const syncs = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/buyer/cart/sync')) {
        const body = JSON.parse(request.postData() ?? '{}');
        syncs.push({ items: (body.items ?? []).map((i) => i.id), saved: (body.savedItems ?? []).map((i) => i.id) });
      }
    });
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)/cart');
      try { await page.getByTestId('cart-row-line_1').waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await shot(page, '01-cart-at-rest');
    console.log('  lines at rest:', (await lineIds(page)).join(', '));

    // A short / mostly-vertical drag must not open the row.
    await drag(page, 'line_1', -20, 60);
    await shot(page, '02-vertical-drag-does-not-open');

    // Swipe line_1 left → Save + Remove revealed.
    await drag(page, 'line_1', -160);
    await shot(page, '03-swiped-reveals-save-remove');

    // Remove → gone, undo toast, synced.
    const before = syncs.length;
    await page.getByTestId('cart-row-line_1').getByRole('button', { name: /^Remove .* from cart$/ }).first().click();
    await page.waitForTimeout(900);
    await shot(page, '04-removed-undo-toast');
    const afterRemove = await lineIds(page);
    console.log('  after remove:', afterRemove.join(', '), '| sync:', JSON.stringify(syncs.slice(before)));
    if (afterRemove.includes('line_1')) throw new Error('line_1 was not removed');

    // Undo → back.
    await page.getByText(/^Undo$/i).first().click();
    await page.waitForTimeout(900);
    await shot(page, '05-undo-restores');
    const afterUndo = await lineIds(page);
    console.log('  after undo:', afterUndo.join(', '), '| last sync:', JSON.stringify(syncs.at(-1)));
    if (!afterUndo.includes('line_1')) throw new Error('undo did not restore line_1');

    // Swipe line_3 → Save for later.
    await drag(page, 'line_3', -160);
    await shot(page, '06-swiped-second-row');
    await page.getByTestId('cart-row-line_3').getByRole('button', { name: /^Save .* for later$/ }).first().click();
    await page.waitForTimeout(900);
    const afterSave = await lineIds(page);
    console.log('  after save:', afterSave.join(', '), '| last sync:', JSON.stringify(syncs.at(-1)));
    await page.getByText(/Saved for later/i).first().scrollIntoViewIfNeeded();
    await shot(page, '07-saved-for-later');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
