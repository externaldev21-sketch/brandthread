#!/usr/bin/env node
/**
 * Draws for limited drops: before (dev product page) and after (draw on the
 * product page, the SNKRS-style entry sheet, entered, results, and the
 * seller's Release toggle + draw log), at 393x852, with the store-screenshots
 * harness and fake /api/product-draws responses.
 *
 * The web build needs a Stripe publishable key for the payment rows to be
 * live; a stub `window.Stripe` stands in for Stripe.js (which the harness
 * keeps offline) and authorises like a real manual-capture intent would.
 *
 *   EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_screenshots node scripts/draw-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/draws/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/draws');
const BASELINE_DIR = '/home/user/baseline-web-build';
const PRODUCT = 'prod_nl_jacket_rust';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: UA };
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const MIN = 60_000;

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

const STRIPE_STUB = () => {
  const element = { mount() {}, unmount() {}, destroy() {}, on() { return element; }, off() {}, update() {}, focus() {}, blur() {}, clear() {} };
  const elements = { create: () => element, getElement: () => null, update() {}, fetchUpdates: async () => ({}), submit: async () => ({}) };
  window.Stripe = Object.assign(() => ({
    elements: () => elements,
    _registerWrapper() {},
    registerAppInfo() {},
    createToken: async () => ({}),
    createPaymentMethod: async () => ({}),
    confirmCardSetup: async () => ({}),
    paymentRequest: () => ({ canMakePayment: async () => null, on() {}, update() {}, show() {} }),
    confirmPayment: async () => ({ paymentIntent: { status: 'requires_capture' } }),
    confirmCardPayment: async () => ({ paymentIntent: { status: 'requires_capture' } }),
  }), { version: 3 });
};

function drawState(phase) {
  const opensAt = new Date(DEMO_NOW - 20 * MIN).toISOString();
  const closesAt = new Date(DEMO_NOW + 40 * MIN).toISOString();
  return {
    productId: PRODUCT, status: phase === 'won' || phase === 'lost' ? 'drawn' : 'open',
    opensAt, closesAt, seedHash: 'c1f0…', drawnAt: phase === 'won' || phase === 'lost' ? new Date(DEMO_NOW).toISOString() : null,
  };
}

async function setup(browser, images, origin, role, { phase = 'open', drawsFlag = true } = {}) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role, origin, images });
  await context.addInitScript(STRIPE_STUB);
  let entryStatus = phase === 'entered' ? 'entered' : phase === 'won' ? 'won' : phase === 'lost' ? 'lost' : null;
  const entry = () => (entryStatus ? {
    id: 'entry_1', status: entryStatus, variantId: 'var_m', variantLabel: 'M', amountCents: 23_870, notifyResult: true, decidedAt: null,
  } : null);
  const is = (url, re) => re.test(url.pathname);
  await context.route((url) => is(url, /\/api(\/v1)?\/product-draws\//), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname;
    if (p.endsWith('/entry/quote')) return route.fulfill(json(origin, { subtotalCents: 22_000, shippingCents: 0, taxCents: 1_870, totalCents: 23_870, variantLabel: 'M' }));
    if (p.endsWith('/entry/confirm')) { entryStatus = 'entered'; return route.fulfill(json(origin, { status: 'entered' })); }
    if (p.endsWith('/entry') && req.method() === 'POST') return route.fulfill(json(origin, { entryId: 'entry_1', clientSecret: 'pi_draw_secret_test', amountCents: 23_870, status: 'pending' }));
    if (p.endsWith('/entry') && req.method() === 'DELETE') { entryStatus = null; return route.fulfill(json(origin, { status: 'withdrawn' })); }
    if (p.endsWith('/entry')) return route.fulfill(json(origin, { entry: entry() }));
    if (p.endsWith('/audit')) {
      const at = (m) => new Date(DEMO_NOW + m * MIN).toISOString();
      return route.fulfill(json(origin, [
        { id: 'e1', kind: 'created', entryId: null, actor: 'seller', detail: {}, createdAt: at(-1440) },
        { id: 'e2', kind: 'closed', entryId: null, actor: null, detail: { entries: 1184 }, createdAt: at(-60) },
        { id: 'e3', kind: 'winner', entryId: 'x', actor: null, detail: { rank: 1 }, createdAt: at(-60) },
        { id: 'e4', kind: 'charge_failed', entryId: 'y', actor: null, detail: {}, createdAt: at(-60) },
        { id: 'e5', kind: 'lost', entryId: null, actor: null, detail: { count: 1159 }, createdAt: at(-59) },
        { id: 'e6', kind: 'drawn', entryId: null, actor: null, detail: { won: 24 }, createdAt: at(-59) },
      ]));
    }
    return route.fulfill(json(origin, { draw: drawState(phase), serverNow: new Date(DEMO_NOW).toISOString() }));
  });
  await context.route((url) => is(url, /\/api(\/v1)?\/buyer\/addresses$/), (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, [
    { id: 'addr_1', recipientName: 'Jordan Reyes', street: '148 Mercer Street', line2: 'Apt 4', city: 'New York', state: 'NY', postalCode: '10012', country: 'US', phone: '+1 503 555 0100', isDefault: true },
  ])));
  await context.route((url) => is(url, /\/api(\/v1)?\/buyer\/payment-methods$/), (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, {
    paymentMethods: [{ id: 'pm_visa', brand: 'visa', last4: '4242', isDefault: true }],
  })));
  await context.route((url) => is(url, /\/api(\/v1)?\/config\/features$/), (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, {
    flags: { productDraws: drawsFlag, threadCash: true }, updatedAt: null,
  })));
  await context.route((url) => is(url, /\/api(\/v1)?\/product-launches$/), (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, [
    { productId: PRODUCT, name: 'Field Shell Jacket — Rust', imageUrl: null, status: 'active', launchAt: new Date(DEMO_NOW + 26 * 60 * MIN).toISOString(), launchedAt: null, notifyFollowers: false, alertCount: 312 },
  ])));
  return { context, page, activity };
}

async function open(page, activity, origin, role, target, testId) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, role, target);
    if (role === 'seller') {
      // The seller shell settles on its home tab after sign-in; navigate again once it has.
      await page.waitForTimeout(4000);
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=seller`);
    }
    try { await page.getByTestId(testId).first().waitFor({ timeout: 30_000 }); break; } catch (e) {
      await page.screenshot({ path: path.join(WORK_DIR, 'draws-fail.png') });
      if (attempt >= 3) throw e;
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(700);
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}-393x852.png`) });

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const o = server.origin;
  try {
    if (label === 'before') {
      const { context, page, activity } = await setup(browser, images, o, 'buyer');
      await open(page, activity, o, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`, 'product-add-to-cart');
      await shot(page, 'before-product');
      await context.close();
      return;
    }
    if (only !== 'seller') {
      const { context, page, activity } = await setup(browser, images, o, 'buyer', { phase: 'open' });
      await open(page, activity, o, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`, 'product-draw-button');
      await shot(page, 'after-product-draw-open');
      await open(page, activity, o, 'buyer', `/draw-entry?productId=${PRODUCT}`, 'draw-row-size');
      await page.getByTestId('draw-row-size').first().click();
      await page.waitForTimeout(500);
      await shot(page, 'after-entry-size');
      await page.getByText('M', { exact: true }).first().click();
      await page.waitForTimeout(1200);
      await shot(page, 'after-entry-ready');
      await page.getByTestId('draw-enter').first().click();
      await page.getByTestId('draw-withdraw').first().waitFor({ timeout: 15_000 });
      await page.waitForTimeout(500);
      await shot(page, 'after-entry-entered');
      await context.close();
    }
    if (only !== 'seller') {
      const { context, page, activity } = await setup(browser, images, o, 'buyer', { phase: 'entered' });
      await open(page, activity, o, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`, 'product-draw-button');
      await shot(page, 'after-product-entered');
      await context.close();
    }
    for (const phase of only === 'seller' ? [] : ['won', 'lost']) {
      const { context, page, activity } = await setup(browser, images, o, 'buyer', { phase });
      await open(page, activity, o, 'buyer', `/draw-result?productId=${PRODUCT}`, 'draw-result-title');
      await shot(page, `after-result-${phase}`);
      await context.close();
    }
    {
      // The seller preview (?bt_preview=seller) is offline by design (lib/devPreview.ts), so the
      // seller's launch editor is rendered under the signed-in demo session, where the fake API answers.
      const { context, page, activity } = await setup(browser, images, o, 'buyer', { phase: 'won' });
      await open(page, activity, o, 'buyer', `/product-launches?productId=${PRODUCT}`, 'launch-release');
      await page.getByText('Draw', { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(400);
      await shot(page, 'after-seller-release');
      await page.getByTestId('draw-log').first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await shot(page, 'after-seller-draw-log');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after' && only !== 'seller') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
