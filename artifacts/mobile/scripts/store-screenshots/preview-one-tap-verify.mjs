#!/usr/bin/env node
/**
 * Preview follow-ups after #309's live test, on the dev-bundle replica of the
 * live preview (?bt_preview=buyer, 390×844, every non-public API → 401, empty
 * public catalog so Discover falls back to the seeded preview products):
 *
 *   1. One-tap preview checkout: product → size → Add to cart → bag →
 *      Checkout opens with the preview buyer's contact, address and
 *      delivery already filled, and Place order enabled with NO typing →
 *      one tap → the order-success check draws.
 *   2. The product page's stock line is monochrome: "In stock" grey,
 *      "Only 2 left in stock" white + bold, and the "2 left" by the stepper
 *      white + semibold. No green dot, no orange.
 *   3. The bag's Remove actions are grey (row, and Edit → Remove).
 *
 * Usage: node scripts/store-screenshots/preview-one-tap-verify.mjs <origin> [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

const ORIGIN = process.argv[2] ?? 'http://localhost:8111';
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/preview-one-tap-checkout'));
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

async function previewPage(browser, images) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: ORIGIN, images });
  // Like the live preview: no saved checkout from an earlier session.
  await context.addInitScript((key) => {
    if (sessionStorage.getItem('bt:one-tap-cleared')) return;
    localStorage.removeItem(key);
    sessionStorage.setItem('bt:one-tap-cleared', '1');
  }, `bt:checkout:${BUYER_USER.id}:v1`);
  const cors = (req) => ({
    'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  const calls = [];
  await context.route((url) => url.origin === 'https://api.brandthread.test' && !/^\/api(\/v1)?\/public\//.test(url.pathname), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req) });
    calls.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.fulfill({ status: 401, headers: cors(req), contentType: 'application/json', body: '{"error":"Unauthorized"}' });
  });
  await context.route((url) => url.origin === 'https://api.brandthread.test' && /^\/api(\/v1)?\/public\/products(\/high-demand)?\/?$/.test(url.pathname), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req) });
    return route.fulfill({ status: 200, headers: cors(req), contentType: 'application/json', body: '[]' });
  });
  const stripe = [];
  page.on('request', (r) => { if (/stripe\.com|checkout\/session/.test(r.url())) stripe.push(r.url()); });
  page.setDefaultNavigationTimeout(240_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { context, page, activity, calls, stripe };
}

async function run() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const results = {};
  const { context, page, activity, calls, stripe } = await previewPage(browser, images);
  const shot = async (name, clip) => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });
    console.log(`  ✓ ${name}`);
  };
  const go = (route) => page.evaluate((r) => { history.pushState(null, '', r); dispatchEvent(new PopStateEvent('popstate')); }, route);

  // The product page, as the live test reached it.
  await openScreen(page, activity, ORIGIN, 'buyer', '/?bt_preview=buyer');
  await page.waitForTimeout(8000);
  await page.getByText('Tap to keep watching').click({ timeout: 5_000 }).catch(() => {});
  for (let attempt = 0; attempt < 4; attempt++) {
    await go('/thread-product-detail?productId=preview-product-01&bt_preview=buyer');
    try {
      await page.getByTestId('product-add-to-cart').waitFor({ timeout: 20_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  await page.waitForTimeout(1500);

  // 2. Stock line: L has 2 left (low), M has 12 (plain in stock).
  const stockStyle = () => page.getByTestId('product-stock-line').evaluate((row) => {
    const dot = row.children[0];
    const text = row.querySelector('div[dir], div:last-child') ?? row.children[1];
    const cs = getComputedStyle(text);
    return { text: row.innerText.trim(), dot: getComputedStyle(dot).backgroundColor, color: cs.color, weight: cs.fontWeight, family: cs.fontFamily };
  });
  await page.getByTestId('option-opt_size-size_L').click();
  await page.waitForTimeout(500);
  await page.getByTestId('product-stock-line').scrollIntoViewIfNeeded();
  results.lowStock = await stockStyle();
  results.qtyHint = await page.getByText(/^\d+ left$/).first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { text: el.innerText, color: cs.color, family: cs.fontFamily };
  }).catch(() => null);
  await page.evaluate(() => window.scrollBy(0, 0));
  await shot('01-stock-only-2-left-white-bold');
  await page.getByTestId('option-opt_size-size_M').click();
  await page.waitForTimeout(500);
  results.inStock = await stockStyle();
  await shot('02-stock-in-stock-grey');

  // 1. Add to cart → bag.
  await page.getByTestId('product-add-to-cart').click();
  await page.getByText('Added to your bag').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'View bag' }).click();
  await page.getByRole('button', { name: 'Checkout' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1200);
  // 3. Remove is grey.
  results.rowRemove = await page.getByText('Remove', { exact: true }).first().evaluate((el) => getComputedStyle(el).color);
  await shot('03-bag-remove-grey');
  await page.getByText('Edit', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(700);
  const bulk = page.getByRole('button', { name: 'Remove' }).last();
  results.bulkRemove = await bulk.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const label = [...el.querySelectorAll('*')].find((n) => n.textContent === 'Remove' && n.children.length === 0);
    return { bg, color: label ? getComputedStyle(label).color : null };
  }).catch(() => null);
  await shot('04-bag-edit-remove-grey');
  await page.getByText('Done', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // 1. Checkout: filled, enabled, no typing.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByTestId('checkout-place-order').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  results.placeOrderEnabled = await page.getByTestId('checkout-place-order').isEnabled();
  results.placeOrderLabel = (await page.getByTestId('checkout-place-order').innerText()).trim();
  results.email = await page.getByTestId('checkout-email').inputValue();
  results.phone = await page.getByTestId('checkout-phone').inputValue();
  results.shipping = (await page.getByTestId('checkout-shipping').innerText()).replace(/\s+/g, ' ').trim();
  results.nextStepHint = await page.getByTestId('checkout-next-step').count();
  await shot('05-checkout-prefilled-place-order-enabled');
  await page.getByTestId('checkout-delivery').scrollIntoViewIfNeeded();
  await shot('06-checkout-delivery-and-payment');

  // One tap.
  await page.getByTestId('checkout-place-order').click();
  await page.getByTestId('checkout-confirmation').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(250);
  await shot('07-success-check-drawing');
  await page.waitForTimeout(1500);
  await shot('08-order-success-checkmark');
  results.orderNumber = (await page.locator('body').innerText()).match(/BT-\d{5}/)?.[0] ?? null;
  results.stripeRequests = stripe;
  results.checkoutApiCalls = calls.filter((c) => /checkout|cart\/validate|payment-status/.test(c));
  await context.close();
  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
