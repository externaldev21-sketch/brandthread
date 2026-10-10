#!/usr/bin/env node
/**
 * Fee transparency — 393x852 screenshots of every insertion point, before
 * (fee schedule unavailable: the fee UI hides itself, i.e. today's screen) and
 * after (schedule served by the fake API, exactly the shape of
 * GET /api/public/fee-schedule), plus the new /fees screen.
 *
 *   node scripts/fee-transparency-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/fee-transparency/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST, SELLER_USER } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/fee-transparency');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const ORDER_ID = '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42';
const ITEM = { id: '0c0a7a39-6c1d-4c9e-b1f4-3a1d2a9e8b11', productId: 'prod_hoodie', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg` };
// Same shape the server returns from getFeeSchedule() (values are whatever fees.ts says; fixture for the screenshot only).
const SCHEDULE = { platformFeeBps: 500, processing: { bps: 290, fixedCents: 30 }, example: {} };
const sellerOrder = () => ({
  id: ORDER_ID, orderNumber: 'BT-00042', ownerId: SELLER_USER.id, buyerId: BUYER_USER.id, status: 'delivered',
  totalCents: 16000, subtotalCents: 14800, shippingCents: 1200, trackingNumber: '1Z999AA10123456784', carrier: 'UPS',
  trackingStatus: 'delivered', shippedAt: iso(now - 4 * DAY), paidAt: iso(now - 6 * DAY),
  shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
  customerName: 'Jordan Reyes', customerEmail: 'jordan@example.com',
  customer: { id: BUYER_USER.id, name: 'Jordan Reyes', email: 'jordan@example.com' },
  createdAt: iso(now - 6 * DAY), updatedAt: iso(now - 2 * DAY), items: [ITEM],
});

async function open(browser, images, origin, target, withSchedule, ready) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/public/fee-schedule') return withSchedule ? json(SCHEDULE) : json({ error: 'unavailable' }, 503);
    if (p === `/api/orders/${ORDER_ID}`) return json(sellerOrder());
    return route.fallback();
  });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'seller', target);
    try { await ready(page).waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(700);
  return { context, page };
}

// Text-fit & alignment: flags text that is clipped (scrollWidth > clientWidth), ellipsized,
// or drawn outside its parent / the 393px viewport.
const FIT_SELECTORS = ['[data-testid^="fee-breakdown"]', '[data-testid="fees-table"]', '[data-testid="seller-payouts-fees-link"]', '[data-testid="fees-price-input"]'];
const fitProblems = [];
async function fitCheck(page, name) {
  const found = await page.evaluate((selectors) => {
    const out = [];
    const roots = selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
    // Also the scroll content of the fees screen and the order totals rows.
    for (const root of roots) {
      const card = root.closest('[data-testid="fees-table"], [data-testid^="fee-breakdown"]') ?? root;
      const nodes = [card, ...card.querySelectorAll('*')];
      for (const el of nodes) {
        const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasText && el.tagName !== 'INPUT') continue;
        const r = el.getBoundingClientRect();
        const pr = (el.parentElement ?? el).getBoundingClientRect();
        const cs = getComputedStyle(el);
        const clipped = el.scrollWidth > el.clientWidth + 1 || cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth;
        const outside = r.left < pr.left - 1 || r.right > pr.right + 1 || r.right > window.innerWidth + 1 || r.left < -1;
        const tight = card !== el && r.width > 0 && (r.left - card.getBoundingClientRect().left < 12 || card.getBoundingClientRect().right - r.right < 12);
        if (clipped || outside || tight) out.push({ text: (el.textContent || el.placeholder || '').slice(0, 30), clipped, outside, tight, left: Math.round(r.left), right: Math.round(r.right) });
      }
    }
    return out;
  }, FIT_SELECTORS);
  for (const f of found) fitProblems.push({ shot: name, ...f });
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await fitCheck(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ok ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    // 1. Seller product create/edit: compact row under the price field.
    for (const withSchedule of [false, true]) {
      const tag = withSchedule ? 'after' : 'before';
      const { context, page } = await open(browser, images, origin, '/add-product', withSchedule, (p) => p.getByText('Price *').first());
      if (withSchedule) {
        await page.getByPlaceholder('0.00').first().fill('48.00');
        await page.waitForTimeout(400);
      }
      await page.getByText('Price *').first().scrollIntoViewIfNeeded();
      await shot(page, `add-product-${tag}-collapsed`);
      if (withSchedule) {
        await page.getByTestId('fee-breakdown-toggle').click();
        await page.waitForTimeout(400);
        await shot(page, 'add-product-after-expanded');
      }
      await context.close();
    }
    // 2. Seller order detail, Payment tab: a "Fees" row in the existing totals.
    for (const withSchedule of [false, true]) {
      const tag = withSchedule ? 'after' : 'before';
      const { context, page } = await open(browser, images, origin, `/order-detail?id=${ORDER_ID}&tab=payment`, withSchedule, (p) => p.getByText('Payment Breakdown').first());
      await shot(page, `order-detail-payment-${tag}`);
      await context.close();
    }
    // 3. Payouts > Settings tab: the new "Fees & payments" row; then the new screen.
    {
      const { context, page } = await open(browser, images, origin, '/payouts', true, (p) => p.getByText('Payouts').first());
      await page.getByTestId('seller-payouts-tab-settings').click();
      await page.getByTestId('seller-payouts-fees-link').waitFor({ timeout: 10_000 });
      await page.getByTestId('seller-payouts-fees-link').scrollIntoViewIfNeeded();
      await shot(page, 'payouts-settings-after');
      await page.getByTestId('seller-payouts-fees-link').click();
      await page.getByTestId('fees-table').waitFor({ timeout: 10_000 });
      await shot(page, 'fees-screen-empty');
      await page.getByTestId('fees-price-input').fill('48.00');
      await page.getByTestId('fees-calculator-result').waitFor({ timeout: 5_000 });
      await shot(page, 'fees-screen-calculator');
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, origin, '/payouts', false, (p) => p.getByText('Payouts').first());
      await page.getByTestId('seller-payouts-tab-settings').click();
      await page.getByText('Payout method').first().waitFor({ timeout: 10_000 });
      await page.getByText('Payout method').first().scrollIntoViewIfNeeded();
      await shot(page, 'payouts-settings-before');
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, origin, '/fees', false, (p) => p.getByTestId('fees-retry'));
      await shot(page, 'fees-screen-unavailable');
      await context.close();
    }
    if (fitProblems.length) { console.error('TEXT-FIT PROBLEMS', JSON.stringify(fitProblems, null, 1)); process.exitCode = 1; }
    else console.log('text-fit check: clean');
  } finally {
    await browser.close();
    server.close?.();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
