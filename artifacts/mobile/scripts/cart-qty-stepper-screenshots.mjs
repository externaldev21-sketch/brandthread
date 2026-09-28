#!/usr/bin/env node
/**
 * Item 101b — live check of the cart quantity stepper at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer
 * with a 3-line / 3-seller cart, fake API) and records, per step, the line's
 * quantity, the line price, the group subtotal, the sticky total and the
 * quantities sent to POST /api/buyer/cart/sync:
 *   - + on a line (qty 1 → 2 → 3), totals update live and sync
 *   - + disabled at the line's stock cap (maxQuantity 3)
 *   - − back down to 1, where − becomes a trash
 *   - trash at qty 1 → line removed with the same Undo toast as Remove; Undo
 *
 *   node scripts/cart-qty-stepper-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/cart-qty-stepper-101b/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/cart-qty-stepper-101b');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const LINE = 'line_2'; // Field Shell Jacket — Rust, maxQuantity 3

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82, caret: 'hide' });
  console.log(`  ✓ ${name}`);
}

async function state(page, syncs) {
  return page.evaluate((line) => {
    const qty = document.querySelector(`[data-testid="cart-qty-${line}"]`);
    const text = document.body.innerText;
    const group = /Group subtotal: (\$[\d,.]+)/.exec(text)?.[1];
    const total = /\n(?:Total|\d+ selected)\n(\$[\d,.]+)/.exec(text)?.[1];
    const dec = document.querySelector(`[data-testid="cart-qty-${line}-decrement"]`);
    const inc = document.querySelector(`[data-testid="cart-qty-${line}-increment"]`);
    return {
      qty: qty ? Number(qty.innerText.replace(/\D+/g, '')) : null,
      decLabel: dec?.getAttribute('aria-label'),
      incDisabled: inc?.getAttribute('aria-disabled') === 'true' || inc?.hasAttribute('disabled'),
      firstGroupSubtotal: group,
      stickyTotal: total,
    };
  }, LINE).then((s) => ({ ...s, lastSync: syncs.at(-1) }));
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
    const syncs = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/buyer/cart/sync')) {
        const body = JSON.parse(request.postData() ?? '{}');
        syncs.push(Object.fromEntries((body.items ?? []).map((i) => [i.id, i.quantity])));
      }
    });
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)/cart');
      try { await page.getByTestId(`cart-qty-${LINE}`).waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.getByTestId(`cart-qty-${LINE}`).scrollIntoViewIfNeeded();
    console.log('  start:', JSON.stringify(await state(page, syncs)));
    await shot(page, '01-qty1-minus-is-trash');

    const inc = page.getByTestId(`cart-qty-${LINE}-increment`);
    const dec = page.getByTestId(`cart-qty-${LINE}-decrement`);
    await inc.click();
    await page.waitForTimeout(700);
    console.log('  +1:', JSON.stringify(await state(page, syncs)));
    await shot(page, '02-qty2-totals-updated');
    await inc.click();
    await page.waitForTimeout(700);
    console.log('  +1 (cap):', JSON.stringify(await state(page, syncs)));
    await shot(page, '03-qty3-at-stock-cap-plus-disabled');

    await dec.click();
    await page.waitForTimeout(700);
    await dec.click();
    await page.waitForTimeout(700);
    console.log('  back to 1:', JSON.stringify(await state(page, syncs)));

    await dec.click();
    await page.waitForTimeout(900);
    const removed = await page.getByTestId(`cart-qty-${LINE}`).count() === 0;
    console.log('  trash at 1 -> removed:', removed, '| lastSync:', JSON.stringify(syncs.at(-1)));
    await shot(page, '04-trash-at-1-removed-undo-toast');
    await page.getByText(/^Undo$/i).first().click();
    await page.waitForTimeout(900);
    console.log('  undo:', JSON.stringify(await state(page, syncs)));
    await page.getByTestId(`cart-qty-${LINE}`).scrollIntoViewIfNeeded();
    await shot(page, '05-undo-restores');
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
