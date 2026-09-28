#!/usr/bin/env node
/**
 * Preview buy flow: the owner's exact reported route, end to end, on a local
 * replica of the live Replit preview.
 *
 * The replica is the DEV bundle (`expo start --web`, __DEV__ on, which is
 * what Replit serves) at ?bt_preview=buyer, 390×844. Every non-public API
 * call answers 401, as it does for the preview with no account.
 *
 * Steps, with a screenshot at each:
 *   1. Discover → Just Dropped → Sculpted Wool Coat
 *      (/thread-product-detail?productId=preview-product-01)
 *   2. The page, top to bottom. Checks the page order, exactly one
 *      purchase-protection card, "You might also like" filled, and the
 *      report links last.
 *   3. Pick a size (a sold-out size stays disabled).
 *   4. Add to cart. Captures the photo mid-flight and the bag badge 0 → 1.
 *   5. The added sheet → View bag → the cart.
 *   6. Cart → Checkout, then every card: contact, shipping address (manual
 *      entry; address suggestions answer 401, so they show #298's error
 *      state), delivery, payment with the no-charge note, total.
 *   7. Place order → the order-success screen → View order.
 *   8. Buy now straight from the product page → checkout → success.
 *
 * Usage: start the dev server with the harness env (see harness.mjs
 * buildPreviewWeb), then
 *   node scripts/store-screenshots/preview-buy-flow-verify.mjs [origin] [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8099';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/preview-buy-flow'));
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

async function newPreviewPage(browser, images) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  const calls = [];
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !/^\/api(\/v1)?\/public\//.test(url.pathname), (route) => {
    const req = route.request();
    const h = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    calls.push(`${req.method()} ${new URL(req.url()).pathname.replace(/^\/api\/v1/, '/api')}`);
    return route.fulfill({ status: 401, headers: h, contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  // The live preview has no real catalog: the public product lists come back
  // empty, so Discover's rails fall back to the seeded preview catalog (that's
  // where "Just Dropped → Sculpted Wool Coat" comes from). Mirror that here
  // instead of the harness's demo catalog.
  await context.route((url) => url.origin === 'https://api.brandthread.test' && /^\/api(\/v1)?\/public\/products(\/high-demand)?\/?$/.test(url.pathname), (route) => {
    const req = route.request();
    const h = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    return route.fulfill({ status: 200, headers: h, contentType: 'application/json', body: '[]' });
  });
  // Stripe must never be reached from a preview order.
  const stripe = [];
  page.on('request', (r) => { if (/stripe\.com|checkout\/session/.test(r.url())) stripe.push(r.url()); });
  page.on('popup', (p) => stripe.push(`popup ${p.url()}`));
  page.setDefaultNavigationTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { context, page, activity, calls, stripe };
}

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};
  const shotFor = (page) => async (name, full = false) => {
    await page.waitForTimeout(350);
    if (full) {
      const extra = await page.evaluate(() => {
        const sc = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible').sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (sc) sc.scrollTop = 0;
        return sc ? sc.scrollHeight - sc.clientHeight : 0;
      });
      await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      await page.setViewportSize(VIEWPORT);
      await page.waitForTimeout(300);
    } else {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
    console.log(`  ✓ ${name}`);
  };
  // The live preview is signed out, so checkout shows "Add address"; the
  // harness session may have one saved, which shows "Edit" instead. Either
  // way this opens the same address sheet.
  const openAddressSheet = async (page) => {
    const add = page.getByTestId('checkout-add-address');
    if (await add.count()) await add.click();
    else await page.getByTestId('checkout-shipping').getByText('Edit', { exact: true }).first().click();
    await page.getByText('Use this address').waitFor();
  };
  const go = (page, route) => page.evaluate((r) => { history.pushState(null, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);
  const openProduct = async (page, activity, shot, viaDiscover) => {
    await openScreen(page, activity, ORIGIN, 'buyer', '/?bt_preview=buyer');
    await page.waitForTimeout(8000);
    await page.getByText('Tap to keep watching').click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(500);
    if (viaDiscover) {
      // The Discover tab (compass) in the tab bar, as a person would.
      const tab = page.locator('a[href="/discover"], [aria-label="Discover"], [aria-label*="Discover" i]').first();
      if (await tab.count()) await tab.click(); else await go(page, '/discover?bt_preview=buyer');
      const tile = page.locator('[aria-label^="Sculpted Wool Coat by"]').first();
      try {
        await page.getByText('Just Dropped').first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1500);
        await tile.scrollIntoViewIfNeeded();
        // Let the tab switch finish before the screenshot.
        await page.waitForTimeout(3500);
        await shot('01-discover-just-dropped');
        await tile.click();
        results.reachedViaDiscover = true;
      } catch {
        results.reachedViaDiscover = false;
        await page.screenshot({ path: path.join(OUT, 'debug-discover.png') });
        await go(page, '/thread-product-detail?productId=preview-product-01&bt_preview=buyer');
      }
    } else {
      await go(page, '/thread-product-detail?productId=preview-product-01&bt_preview=buyer');
    }
    try {
      await page.getByTestId('product-add-to-cart').waitFor({ timeout: 60_000 });
    } catch (error) {
      await page.screenshot({ path: path.join(OUT, 'debug-product-timeout.png') });
      console.log('URL at timeout:', page.url());
      console.log((await page.locator('body').innerText()).slice(0, 1500));
      throw error;
    }
    await page.waitForTimeout(1500);
  };

  // ── A. Product page → Add to cart → cart → checkout → success ─────────────
  {
    const { context, page, activity, calls, stripe } = await newPreviewPage(browser, images);
    const shot = shotFor(page);
    await openProduct(page, activity, shot, true);
    results.url = new URL(page.url()).pathname + new URL(page.url()).search;
    await shot('02-product-top');
    await shot('03-product-full-page', true);
    const bodyText = await page.locator('body').innerText();
    results.previewOnlyPill = /Preview only/i.test(bodyText);
    results.productNotFound = /Product not found/.test(bodyText);
    results.protectionCount = (bodyText.match(/Purchase protection|Buyer protection/gi) ?? []).length;
    const order = ['Sculpted Wool Coat', '$480.00', 'Size', 'Atelier Noire', 'About this piece', 'Returns', 'You might also like', 'Report listing'];
    const lower = bodyText.toLowerCase(); // section headers are uppercased by CSS
    results.sectionOrder = order.map((label) => ({ label, at: lower.indexOf(label.toLowerCase()) }));
    results.orderOk = results.sectionOrder.every((row, i, all) => row.at >= 0 && (i === 0 || row.at > all[i - 1].at));

    // Sizes: XS is sold out (disabled), pick M.
    const xs = page.getByTestId('option-opt_size-size_XS');
    results.xsDisabled = await xs.getAttribute('aria-disabled').catch(() => null);
    await page.getByTestId('option-opt_size-size_M').click();
    await page.waitForTimeout(500);
    await page.getByTestId('option-opt_size-size_M').scrollIntoViewIfNeeded();
    await shot('04-size-selected');

    // Add to cart: the flight + the badge.
    results.badgeBefore = await page.getByTestId('product-cart-badge').count();
    await page.getByTestId('product-add-to-cart').click();
    await page.getByTestId('cart-fly-item').waitFor({ timeout: 5_000 }).then(() => { results.flightSeen = true; }).catch(() => { results.flightSeen = false; });
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(OUT, '05-add-to-cart-in-flight.png') });
    console.log('  ✓ 05-add-to-cart-in-flight');
    await page.getByText('Added to your bag').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(900);
    results.badgeAfter = await page.getByTestId('product-cart-badge').innerText().catch(() => null);
    await shot('06-added-sheet-and-badge');
    await page.getByRole('button', { name: 'View bag' }).click();
    await page.getByRole('button', { name: 'Checkout' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await shot('07-cart');

    await page.getByRole('button', { name: 'Checkout' }).click();
    await page.getByTestId('checkout-place-order').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await shot('08-checkout-top');
    await page.getByTestId('checkout-email').fill('jordan@example.com');
    await page.getByTestId('checkout-phone').fill('(212) 555-0142');
    await page.getByTestId('checkout-phone').blur();
    await openAddressSheet(page);
    await page.getByLabel('First name').fill('Jordan');
    await page.getByLabel('Last name').fill('Reyes');
    await page.getByLabel('Shipping address search').fill('');
    await page.getByLabel('Shipping address search').pressSequentially('148 Mercer', { delay: 40 });
    await page.waitForTimeout(1500);
    results.addressSearchState = (await page.locator('body').innerText()).match(/Suggestions aren.t loading|Address search is unavailable|No matching addresses/i)?.[0] ?? null;
    await shot('09-address-sheet-manual');
    await page.getByLabel('Shipping address search').fill('148 Mercer Street');
    await page.getByLabel(/Apartment/).last().fill('').catch(() => {});
    await page.getByLabel('City', { exact: true }).last().fill('New York');
    await page.getByLabel('State', { exact: true }).last().fill('NY');
    await page.getByLabel('ZIP code', { exact: true }).last().fill('10012');
    await page.getByTestId('checkout-use-address').click();
    await page.waitForTimeout(800);
    await shot('10-checkout-filled-full', true);
    await page.getByTestId('checkout-payment').scrollIntoViewIfNeeded();
    await shot('11-checkout-payment-no-charge-note');
    results.totalLabel = await page.getByTestId('checkout-place-order').innerText();
    await page.getByTestId('checkout-place-order').click();
    await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1200);
    await shot('12-order-success');
    await shot('12b-order-success-full', true);
    results.successText = (await page.locator('body').innerText()).match(/BT-\d{5}/)?.[0] ?? null;
    await page.getByTestId('checkout-track-order').click().catch(() => {});
    await page.waitForURL(/buyer-order-detail|order-detail/, { timeout: 30_000 }).then(() => { results.viewOrderOpened = true; }).catch(() => { results.viewOrderOpened = false; });
    await page.waitForTimeout(1500);
    await shot('13-view-order');
    results.stripeRequests = stripe;
    results.checkoutApiCalls = calls.filter((c) => /checkout|cart\/validate|payment-status/.test(c));
    await context.close();
  }

  // ── B. Buy now straight from the product page ───────────────────────────
  {
    const { context, page, activity, stripe } = await newPreviewPage(browser, images);
    const shot = shotFor(page);
    await openProduct(page, activity, shot, false);
    await page.getByTestId('option-opt_size-size_L').click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Buy now' }).click();
    await page.getByTestId('checkout-place-order').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await shot('14-buy-now-checkout');
    await page.getByTestId('checkout-email').fill('jordan@example.com');
    await page.getByTestId('checkout-phone').fill('(212) 555-0142');
    await page.getByTestId('checkout-phone').blur();
    await openAddressSheet(page);
    await page.getByLabel('First name').fill('Jordan');
    await page.getByLabel('Last name').fill('Reyes');
    await page.getByLabel('Shipping address search').fill('148 Mercer Street');
    await page.getByLabel(/Apartment/).last().fill('').catch(() => {});
    await page.getByLabel('City', { exact: true }).last().fill('New York');
    await page.getByLabel('State', { exact: true }).last().fill('NY');
    await page.getByLabel('ZIP code', { exact: true }).last().fill('10012');
    await page.getByTestId('checkout-use-address').click();
    await page.waitForTimeout(600);
    await page.getByTestId('checkout-place-order').click();
    await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await shot('15-buy-now-success');
    results.buyNowStripe = stripe;
    await context.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
