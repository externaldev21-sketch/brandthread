#!/usr/bin/env node
/**
 * Seller order risk badge (Stripe Radar flags) at 393x852 on the production
 * web build (store-screenshots harness, signed-in demo seller Northline).
 * The fake API answers GET /api/orders/:id with the exact shape the route
 * returns, including the new `risk` object. Nothing is seeded into the app.
 *
 *   node scripts/order-risk-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/radar/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/radar');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DAY = 86_400_000;
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const ORDER_ID = '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42';

const RISKS = {
  none: null,
  elevated: {
    level: 'elevated', score: 68, reviewed: false,
    flags: [
      { code: 'radar_elevated', label: 'Stripe rated this payment elevated risk', severity: 'medium' },
      { code: 'cvc_failed', label: 'Card security code did not match', severity: 'medium' },
      { code: 'country_mismatch', label: 'Billing country (CA) differs from shipping country (US)', severity: 'medium' },
      { code: 'first_time_buyer', label: 'First order from this buyer', severity: 'info' },
    ],
  },
  highest: {
    level: 'highest', score: 91, reviewed: false,
    flags: [
      { code: 'radar_highest', label: 'Stripe rated this payment highest risk', severity: 'high' },
      { code: 'stripe_review_open', label: 'Stripe has this payment under review', severity: 'medium' },
      { code: 'postal_code_failed', label: 'Billing postal code did not match the card', severity: 'medium' },
      { code: 'high_value', label: 'High-value order', severity: 'info' },
    ],
  },
};

const sellerOrder = (risk) => ({
  id: ORDER_ID, orderNumber: 'BT-00042', ownerId: 'seller', buyerId: BUYER_USER.id, status: 'pending',
  totalCents: 16000, subtotalCents: 14800, shippingCents: 1200, paidAt: iso(now - 3 * 60 * 60_000),
  shippingAddress: { name: 'Jordan Reyes', street: '1120 NW Everett Street', city: 'Portland', state: 'OR', zip: '97209', country: 'US' },
  createdAt: iso(now - 3 * 60 * 60_000), updatedAt: iso(now - 3 * 60 * 60_000),
  customer: { id: BUYER_USER.id, name: 'Jordan Reyes', email: 'jordan@example.com' },
  items: [{ id: 'i1', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg` }],
  shopifyFulfillment: null, risk,
});

async function open(browser, images, origin, risk) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === `/api/orders/${ORDER_ID}`) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(sellerOrder(risk)) });
    if (p === '/api/returns') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '[]' });
    return route.fallback();
  });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'seller', `/order-detail?id=${ORDER_ID}`);
    try { await page.getByText('BT-00042').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(800);
  return { context, page };
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ok ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const kind of ['none', 'elevated', 'highest']) {
      const { context, page } = await open(browser, images, server.origin, RISKS[kind]);
      const badge = await page.getByTestId('order-risk-badge').count();
      console.log(`  [${kind}] badge count: ${badge}`);
      await shot(page, `${kind === 'none' ? '01-before-no-risk' : kind === 'elevated' ? '02-badge-elevated' : '04-badge-highest'}`);
      if (badge) {
        await page.getByTestId('order-risk-badge').click();
        await page.getByTestId('order-risk-panel').waitFor({ timeout: 5_000 });
        await shot(page, kind === 'elevated' ? '03-explanation-elevated' : '05-explanation-highest');
      }
      await context.close();
    }
  } finally {
    server.close();
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
