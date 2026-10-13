#!/usr/bin/env node
/**
 * "Gift this" at checkout (lululemon "Adding a gift message"): before (dev
 * baseline build) vs after (this branch) at 390x844 and 393x852, using the
 * store-screenshots harness (signed-in demo buyer / seller, fake API).
 *
 *   node scripts/gift-note-screenshots.mjs [--skip-build] [--baseline <web build>] [--baseline-src <dev mobile dir>]
 *
 * Shots:
 *   1. checkout with the gift row (unchecked)
 *   2. Add a Gift Message, filled in
 *   3. checkout with the row checked ("This is a gift")
 *   4. seller order detail showing the gift
 *   5. packing slip HTML as a gift receipt (no prices), rendered with page.setContent
 *
 * Output: docs/pr-assets/gift-note/<before|after>-<shot>-<width>.png
 * No real server, account or payment provider is involved.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW, IMAGE_HOST, checkoutSession } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/gift-note');
const API = 'https://api.brandthread.test';
const argBaseline = process.argv.indexOf('--baseline');
const BASELINE_DIR = argBaseline > 0 ? process.argv[argBaseline + 1] : '/home/user/baseline-web-build';
// Dev source tree for the "before" packing slip (lib/packingSlip.ts on dev).
const argBaselineSrc = process.argv.indexOf('--baseline-src');
const BASELINE_SRC = argBaselineSrc > 0 ? process.argv[argBaselineSrc + 1] : null;
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 393, height: 852 }];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHECKOUT_KEY = `bt:checkout:${BUYER_USER.id}:v1`;
const ORDER_ID = '6f1c2b8e-4b7a-4c1e-9a55-2d7f3c9e1a42';
const now = new Date(DEMO_NOW).getTime();
const iso = (ms) => new Date(ms).toISOString();
const GIFT = { to: 'Sam Lee', from: 'Jordan Reyes', message: 'Happy birthday, Sam. Wear it on the next hike. See you soon.' };

const SAVED_ADDRESSES = [
  { id: 'addr_home', label: 'Home', recipientName: 'Sam Lee', street: '148 Mercer Street', line2: 'Apt 4', city: 'New York', state: 'NY', postalCode: '10012', country: 'US', phone: '+1 (503) 555-0142', isDefault: true },
];

function buyNowSession() {
  const base = checkoutSession();
  const group = { ...base.deliveryGroups[0], items: [base.deliveryGroups[0].items[0]] };
  group.availableMethods = [
    { id: group.selectedMethodId, carrier: 'Seller shipping', service: 'Standard', priceCents: 1200, estimatedDays: 5, estimatedDelivery: 'Arrives in 4–6 business days', trackingIncluded: true, isRecommended: true },
  ];
  const subtotalCents = group.items[0].priceCents;
  return {
    ...base,
    deliveryGroups: [group],
    isBuyNow: true,
    acknowledgments: [],
    shippingAddress: { ...base.shippingAddress, id: 'addr_home' },
    summary: { ...base.summary, subtotalCents, shippingTotalCents: 1200, totalCents: subtotalCents + 1200 },
  };
}

const sellerOrder = (gift) => ({
  id: ORDER_ID, orderNumber: 'BT-00042', ownerId: 'seller', buyerId: BUYER_USER.id, status: 'processing',
  totalCents: 16000, subtotalCents: 14800, shippingCents: 1200, paidAt: iso(now - 3 * 60 * 60_000),
  shippingAddress: { name: 'Sam Lee', street: '148 Mercer Street', line2: 'Apt 4', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
  createdAt: iso(now - 3 * 60 * 60_000), updatedAt: iso(now - 3 * 60 * 60_000),
  customer: { id: BUYER_USER.id, name: 'Jordan Reyes', email: 'jordan@example.com' },
  items: [{ id: 'i1', productName: 'Ember Heavyweight Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg` }],
  shopifyFulfillment: null, risk: null,
  ...(gift ? { isGift: true, giftTo: GIFT.to, giftFrom: GIFT.from, giftMessage: GIFT.message, gift: GIFT } : { isGift: false, gift: null }),
});

function corsHeaders(req) {
  return {
    'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

async function newPage(browser, images, origin, role, viewport) {
  const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await context.route(`${API}/**`, (route) => {
    const req = route.request();
    const headers = corsHeaders(req);
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const send = (body) => route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/buyer/addresses' && req.method() === 'GET') return send(SAVED_ADDRESSES);
    if (p === '/api/buyer/payment-methods') return send({ paymentMethods: [] });
    if (p === '/api/buyer/cart/validate') return send({ isValid: true, issues: [] });
    if (p === `/api/orders/${ORDER_ID}`) return send(sellerOrder(true));
    if (p === '/api/returns' || p.startsWith('/api/returns')) return send([]);
    return route.fallback();
  });
  return { context, page, activity };
}

async function openCheckout(page, activity, origin) {
  const session = buyNowSession();
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/buyer-checkout?source=buynow', {
      beforeNavigate: () => page.evaluate(([key, value]) => localStorage.setItem(key, value), [CHECKOUT_KEY, JSON.stringify(session)]),
    });
    try { await page.getByText('Order total').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 4) throw e; }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(800);
}

/** Puts the end of the shipping section (and the gift row, when present) mid-screen. */
async function scrollToShippingEnd(page) {
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="checkout-gift-option"]')
      ?? document.querySelector('[data-testid="checkout-payment"]');
    target?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(500);
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  ok ${name}`);
}

async function captureApp(browser, images, origin, phase) {
  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    // 1–3: checkout row, gift screen, checked row.
    {
      const { context, page, activity } = await newPage(browser, images, origin, 'buyer', viewport);
      await openCheckout(page, activity, origin);
      await scrollToShippingEnd(page);
      await shot(page, `${phase}-1-checkout-row-${w}`);
      if (phase === 'after') {
        await page.getByTestId('checkout-gift-row').click();
        await page.getByText('Add a Gift Message').first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600);
        await page.getByTestId('gift-message-to').fill(GIFT.to);
        const from = page.getByTestId('gift-message-from');
        if (!(await from.inputValue())) await from.fill(GIFT.from);
        await page.getByTestId('gift-message-text').fill(GIFT.message);
        await page.locator('textarea, input').first().blur().catch(() => {});
        await shot(page, `${phase}-2-gift-message-${w}`);
        await page.getByTestId('gift-message-save').click();
        await page.getByText('This is a gift').first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(600);
        await scrollToShippingEnd(page);
        await shot(page, `${phase}-3-checkout-row-checked-${w}`);
      }
      await context.close();
    }
    // 4: seller order detail.
    {
      const { context, page, activity } = await newPage(browser, images, origin, 'seller', viewport);
      for (let attempt = 0; ; attempt++) {
        await openScreen(page, activity, origin, 'seller', `/order-detail?id=${ORDER_ID}`);
        try { await page.getByText('BT-00042').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity).catch(() => {});
      await waitForImages(page).catch(() => {});
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        const gift = document.querySelector('[data-testid="order-gift-note"]');
        if (gift) gift.scrollIntoView({ block: 'center' });
        else window.scrollTo(0, 0);
      });
      await shot(page, `${phase}-4-seller-order-detail-${w}`);
      await context.close();
    }
  }
}

/** Transpiles lib/packingSlip.ts (+ lib/money.ts) from `root` into importable ESM with expo stubbed. */
async function loadPackingSlip(root, tag) {
  const dir = path.join(WORK_DIR, `gift-note-slip-${tag}`);
  mkdirSync(dir, { recursive: true });
  const compile = (file) => ts.transpileModule(readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(path.join(dir, 'stub.mjs'), 'export const printToFileAsync = async () => ({}); export const isAvailableAsync = async () => false; export const shareAsync = async () => {};\n');
  writeFileSync(path.join(dir, 'money.mjs'), compile('lib/money.ts'));
  const slip = compile('lib/packingSlip.ts')
    .replace(/from ['"]expo-print['"]/, "from './stub.mjs'")
    .replace(/from ['"]expo-sharing['"]/, "from './stub.mjs'")
    .replace(/from ['"]@\/lib\/money['"]/, "from './money.mjs'");
  writeFileSync(path.join(dir, 'packingSlip.mjs'), slip);
  return import(pathToFileURL(path.join(dir, 'packingSlip.mjs')).href + `?t=${Date.now()}`);
}

function slipOrder(gift) {
  return {
    orderNumber: 'BT-00042',
    sellerName: 'Northline',
    customer: { shippingAddress: { name: 'Sam Lee', line1: '148 Mercer Street', line2: 'Apt 4', city: 'New York', state: 'NY', zip: '10012', country: 'US' } },
    lineItems: [
      { id: 'li1', productName: 'Ember Heavyweight Hoodie', variant: 'Charcoal / M', quantity: 1, unitPriceCents: 14800 },
      { id: 'li2', productName: 'Wool Beanie', variant: '', quantity: 1, unitPriceCents: 3200 },
    ],
    notes: [],
    ...(gift ? { gift: GIFT } : {}),
  };
}

async function capturePackingSlip(browser, phase, root) {
  const { buildPackingSlipHtml } = await loadPackingSlip(root, phase);
  const html = buildPackingSlipHtml(slipOrder(true));
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, userAgent: UA });
    const page = await context.newPage();
    await page.setContent(html);
    await shot(page, `${phase}-5-packing-slip-${viewport.width}`);
    await context.close();
  }
  const prices = /\$\d/.test(html);
  console.log(`  ${phase} packing slip shows prices: ${prices}`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`No baseline build at ${BASELINE_DIR}`);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const [phase, dir] of [['before', BASELINE_DIR], ['after', DEFAULT_BUILD_DIR]]) {
      console.log(`${phase}: ${dir}`);
      const server = await serveBuild(dir);
      try {
        await captureApp(browser, images, server.origin, phase);
      } finally {
        await server.close?.();
      }
    }
    if (BASELINE_SRC) await capturePackingSlip(browser, 'before', BASELINE_SRC);
    await capturePackingSlip(browser, 'after', MOBILE_ROOT);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
