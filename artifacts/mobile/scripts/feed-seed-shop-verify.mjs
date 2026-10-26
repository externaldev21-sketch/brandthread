#!/usr/bin/env node
/**
 * Hands-on check of the demo feed's "Shop button on top of the video" path at
 * 390x844, on the dev preview with demo data (`?bt_preview=buyer&demo=1`, the
 * FASHION_PREVIEW_POSTS seed): for each demo video it taps the Shop chip,
 * waits for the product sheet, picks a size and taps Add to bag, then opens
 * the bag and taps through to checkout. Screenshots go to .store-screenshots/feed-seed-shop/.
 *
 * Drives a running `expo start --web` dev server (demo data needs __DEV__),
 * started with the harness's demo env (scripts/store-screenshots/harness.mjs
 * buildPreviewWeb) plus EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_demo, so
 * checkout gets past "Checkout isn't live yet" (the run reports checkout live
 * through the fake API) and reaches Order review for the no-charge order:
 *
 *   APP_URL=http://localhost:8110 node scripts/feed-seed-shop-verify.mjs [--posts=8]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  WORK_DIR, launchBrowser, openContext, openScreen,
} from './store-screenshots/harness.mjs';

const OUT = path.join(WORK_DIR, 'feed-seed-shop');
const postsArg = process.argv.find((a) => a.startsWith('--posts='));
const POSTS = postsArg ? Number(postsArg.slice(8)) : 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function run() {
  const origin = process.env.APP_URL?.replace(/\/+$/, '');
  if (!origin) throw new Error('Set APP_URL to a running `expo start --web` dev server (see the header).');
  mkdirSync(OUT, { recursive: true });
  // CHROMIUM_PATH: a preinstalled Chromium when the pinned Playwright's own build is absent.
  const browser = process.env.CHROMIUM_PATH
    ? await (await import('playwright')).chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
    : await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const results = [];
  try {
    const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, apiOptions: { emptyCart: true } });
    await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await context.route(/api\.brandthread\.test\/api\/(v1\/)?public\/checkout-config/, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
      body: JSON.stringify({ live: true, mode: 'test', applePay: false, googlePay: false, reason: null }),
    }));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openScreen(page, activity, origin, 'buyer', '/(buyer)', { extraQuery: '&demo=1' });
    await page.waitForTimeout(4000);
    const guide = page.getByTestId('feed-gesture-guide');
    if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400); }

    for (let i = 0; i < POSTS; i++) {
      const step = (name) => path.join(OUT, `${String(i + 1).padStart(2, '0')}-${name}.png`);
      await page.waitForTimeout(1500);
      const video = await page.evaluate(() => [...document.querySelectorAll('video')]
        .filter((v) => { const r = v.getBoundingClientRect(); return r.top >= -2 && r.top < 100 && r.height > 400; })
        .map((v) => ({ src: v.currentSrc.split('/').pop(), playing: !v.paused, w: v.videoWidth, h: v.videoHeight }))[0] ?? null);
      const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
      const hasPill = await pill.waitFor({ timeout: video ? 20_000 : 3_000 }).then(() => true, () => false);
      if (!hasPill) {
        await page.screenshot({ path: step('no-shop-chip') });
        // Only video posts must be shoppable; a photo/slideshow page is recorded and skipped.
        results.push({ post: i + 1, video, shopChip: false });
        if (video) throw new Error(`Video post ${i + 1} has no Shop chip`);
        await page.mouse.move(195, 600);
        await page.mouse.wheel(0, 844);
        await page.waitForTimeout(2200);
        continue;
      }
      const label = await pill.getAttribute('aria-label');
      await page.screenshot({ path: step('feed-video') });
      await pill.click();
      const sheet = page.getByTestId('shop-product-sheet');
      await sheet.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: step('product-sheet') });
      // Posts with 2 tags open on the product list first: tap into the first product.
      const add = sheet.getByLabel(/^(Add to bag|Add to cart)$/).first();
      const listStep = !(await add.isVisible().catch(() => false));
      if (listStep) {
        await sheet.getByText(label.replace(/^Shop /, '').split(',')[0], { exact: true }).first().click();
        await add.waitFor({ timeout: 8_000 });
        await page.waitForTimeout(800);
        await page.screenshot({ path: step('product-detail') });
      }
      const size = sheet.locator('[role="radio"]:not([aria-disabled="true"])');
      if (await size.count()) await size.first().click();
      await add.click({ timeout: 8_000 });
      const added = await sheet.getByLabel(/^View bag$/).first().waitFor({ timeout: 8_000 }).then(() => true, () => false);
      await page.waitForTimeout(600);
      await page.screenshot({ path: step('added-to-bag') });
      results.push({ post: i + 1, video, shopChip: label, listStep, added });
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached', timeout: 5_000 }).catch(async () => {
        await page.mouse.click(195, 60);
        await sheet.waitFor({ state: 'detached', timeout: 5_000 });
      });
      await page.waitForTimeout(500);
      // Next video: swipe the pager up one page.
      await page.mouse.move(195, 600);
      await page.mouse.wheel(0, 844);
      await page.waitForTimeout(2200);
    }
    // Bag -> checkout entry.
    const cart = page.locator('[aria-label^="Open bag"]').filter({ visible: true }).first();
    const bag = await cart.getAttribute('aria-label').catch(() => null);
    await cart.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'zz-bag.png') });
    const checkout = page.getByRole('button', { name: /check ?out/i }).filter({ visible: true }).first();
    await checkout.click({ timeout: 10_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, 'zz-checkout.png') });
    const checkoutUrl = new URL(page.url()).pathname;
    const review = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 120);
    console.log(JSON.stringify({ results, bag, checkoutUrl, review, pageErrors: errors.slice(0, 5) }, null, 1));
    await context.close();
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
