#!/usr/bin/env node
/**
 * Discount codes + multi-store checkout promo sections, live at 393x852 on the
 * store-screenshots harness (fake API).
 *
 *   node scripts/discount-codes-screenshots.mjs <buildDir> <outDir> <before|after>
 *
 * Seller: Store settings (Discounts row), Discounts screen, the code form
 * (first order only, collections, minimum items). Buyer: multi-store checkout
 * with one promo section per store, an applied code, and a rejection message.
 * "before" captures only the screens that exist on dev for comparison.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { BUYER_USER, checkoutSession } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;

const CODES = [
  { id: 'dc1', code: 'WELCOME15', type: 'percentage', value: '15', minOrderCents: 0, appliesTo: 'entire_store', productIds: [], collectionIds: [], firstOrderOnly: true, minQuantity: 0, maxUses: null, usesCount: 12, oneUsePerCustomer: true, startsAt: null, expiresAt: null, active: true, status: 'active', createdAt: '2026-09-01T00:00:00Z' },
  { id: 'dc2', code: 'OUTERWEAR20', type: 'percentage', value: '20', minOrderCents: 10000, appliesTo: 'collections', productIds: [], collectionIds: ['col1'], firstOrderOnly: false, minQuantity: 2, maxUses: 100, usesCount: 4, oneUsePerCustomer: false, startsAt: null, expiresAt: null, active: true, status: 'active', createdAt: '2026-09-10T00:00:00Z' },
];
const COLLECTIONS = [{ id: 'col1', title: 'Outerwear' }, { id: 'col2', title: 'Essentials' }];

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ok ${name}`);
}

/** Flags text that does not fit its box: clipped (scrollWidth > clientWidth), ellipsised, or sticking out of its parent. */
async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const clipped = el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'visible' && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll';
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const p = el.parentElement?.getBoundingClientRect();
      const outOfParent = p && (r.right > p.right + 1 || r.left < p.left - 1) && p.width > 0 && getComputedStyle(el.parentElement).overflowX === 'visible' && r.width < vw;
      const offScreen = r.right > vw + 1 || r.left < -1;
      if (clipped || ellipsis || outOfParent || offScreen) out.push({ text: text.slice(0, 40), clipped, ellipsis, outOfParent: !!outOfParent, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
  return issues;
}

async function gotoWithRetry(page, path, readyText) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await readyText().waitFor({ timeout: 12_000 });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, path);
    }
  }
}

async function sellerFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/discount-codes') return json(route, CODES);
    if (p === '/api/discount-codes/collections') return json(route, COLLECTIONS);
    return route.fallback();
  });
  await openScreen(page, activity, origin, 'seller', '/store-settings');
  await gotoWithRetry(page, '/store-settings?bt_preview=seller', () => page.getByText('CHECKOUT & ACCOUNTS'));
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.getByText('Analytics', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot(page, `${MODE}-01-store-settings-checkout`);
  await overflowCheck(page, 'store-settings');
  if (MODE === 'before') { await context.close(); return; }

  await page.getByText('Discounts', { exact: true }).last().click();
  await page.waitForTimeout(2500);
  await waitForQuietNetwork(activity, 900, 15_000);
  await shot(page, `${MODE}-02-discounts-list`);
  await overflowCheck(page, 'discounts-list');

  await page.getByLabel('New discount').click();
  await page.waitForTimeout(1200);
  await shot(page, `${MODE}-03-form-top`);
  await overflowCheck(page, 'form-top');
  await page.getByText('Collections', { exact: true }).first().click();
  await page.waitForTimeout(600);
  await page.getByText('Outerwear', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByText('Applies to', { exact: true }).first().scrollIntoViewIfNeeded();
  await shot(page, `${MODE}-04-form-collections`);
  await overflowCheck(page, 'form-collections');
  await page.getByText('First order only', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot(page, `${MODE}-05-form-first-order-min-items`);
  await overflowCheck(page, 'form-usage');
  await context.close();
}

async function discountsBefore(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/discount-codes') return json(route, CODES.map(c => ({ ...c, appliesTo: 'entire_store' })));
    return route.fallback();
  });
  await openScreen(page, activity, origin, 'seller', '/discounts');
  await gotoWithRetry(page, '/discounts?bt_preview=seller', () => page.getByLabel('New discount'));
  await page.getByLabel('New discount').click();
  await page.waitForTimeout(1200);
  await page.getByText('Applies to', { exact: true }).first().scrollIntoViewIfNeeded();
  await shot(page, 'before-02-form-applies-to');
  await page.getByText('One use per customer', { exact: true }).first().scrollIntoViewIfNeeded();
  await shot(page, 'before-03-form-usage');
  await context.close();
}

async function buyerFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const base = checkoutSession();
  await context.addInitScript(([key, value]) => {
    if (sessionStorage.getItem('bt:dc-seeded')) return;
    localStorage.setItem(key, value);
    sessionStorage.setItem('bt:dc-seeded', '1');
  }, [CHECKOUT_KEY, JSON.stringify({ ...base, acknowledgments: [] })]);
  await context.route('https://js.stripe.com/**', route => route.abort());
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/config/features') return json(route, { flags: { threadCash: true, threadCashCheckoutDiscount: false, hostedCheckoutFallback: true }, updatedAt: null });
    if (p === '/api/discount-codes/validate') {
      const code = url.searchParams.get('code');
      if (code === 'WELCOME15') {
        return json(route, { error: 'FIRST_ORDER_ONLY', message: 'This code is only valid on your first order with this shop.' }, 400);
      }
      const subtotal = Number(url.searchParams.get('subtotalCents'));
      return json(route, { id: 'dc9', code, type: 'percentage', value: '10', appliedAmountCents: Math.round(subtotal * 0.1), freeShipping: false, description: '10% off' });
    }
    return route.fallback();
  });
  await openScreen(page, activity, origin, 'buyer', '/buyer-checkout');
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByTestId('checkout-scroll').waitFor({ timeout: 12_000 });
      break;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, '/buyer-checkout?bt_preview=buyer');
    }
  }
  await waitForQuietNetwork(activity, 900, 15_000);
  await waitForImages(page);
  await page.waitForTimeout(1500);
  const scroll = page.getByTestId('checkout-scroll');
  const promoIds = await page.locator('[data-testid^="checkout-promo-"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
  console.log('promo sections:', promoIds);
  if (promoIds.length === 0) await shot(page, 'debug-buyer');
  const first = page.locator('[data-testid^="checkout-promo-"]').first();
  await first.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, 'after-06-checkout-promo-per-store');
  await overflowCheck(page, 'checkout-promo');
  // Rejection on the first store.
  await page.getByTestId('checkout-promo-input').first().fill('WELCOME15');
  await page.getByTestId('checkout-promo-apply').first().click();
  await page.waitForTimeout(1500);
  await shot(page, 'after-07-checkout-promo-rejected-first-order');
  // Valid code on the second store.
  await page.getByTestId('checkout-promo-input').nth(1).fill('SAVE10');
  await page.getByTestId('checkout-promo-apply').nth(1).click();
  await page.waitForTimeout(2000);
  await shot(page, 'after-08-checkout-promo-applied-second-store');
  await page.getByTestId('checkout-order-summary').scrollIntoViewIfNeeded();
  await scroll.evaluate(el => { el.scrollTop += 0; });
  await page.waitForTimeout(500);
  await shot(page, 'after-09-checkout-summary-per-store');
  await overflowCheck(page, 'checkout-summary');
  console.log('summary:', (await page.getByTestId('checkout-price-breakdown').innerText()).replace(/\s+/g, ' '));
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await sellerFlow(browser, images, server.origin);
    if (MODE === 'before') await discountsBefore(browser, images, server.origin);
    else await buyerFlow(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
