#!/usr/bin/env node
/**
 * 393x852 screenshots for the pre-order / launch / notify-me PR. Drives the
 * preview web build with the store-screenshots harness; the new endpoints are
 * answered by this script (the shared demo-data module is left untouched).
 *
 *   node scripts/product-launches-notify-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { reportTextFit } from './lib/textFitCheck.mjs';
import { DEMO_NOW, PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/product-launches-notify');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';
const DAY = 86400000;

const json = (origin, body) => ({
  status: 200,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

function mockApi(context, origin, state) {
  return context.route((url) => /^\/api(?:\/v1)?\/(product-launches|preorder-terms|waitlist\/seller|products$)/.test(url.pathname), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const pathname = new URL(req.url()).pathname.replace(/^\/api\/v1/, "/api");
    const m = req.method();
    if (pathname.startsWith('/api/product-launches')) {
      if (pathname.endsWith('/alert')) {
        if (m === 'POST') state.subscribed = true;
        if (m === 'DELETE') state.subscribed = false;
        return route.fulfill(json(origin, { subscribed: state.subscribed }));
      }
      if (pathname === '/api/product-launches') {
        return route.fulfill(json(origin, state.launches ?? []));
      }
      return route.fulfill(json(origin, {
        launching: !!state.launchAt,
        launchAt: state.launchAt ?? null,
        serverNow: new Date(DEMO_NOW).toISOString(),
      }));
    }
    if (pathname.startsWith('/api/preorder-terms')) {
      if (!state.terms) return route.fulfill({ status: 404, contentType: 'application/json', headers: { 'access-control-allow-origin': origin }, body: '{"error":"Not found"}' });
      return route.fulfill(json(origin, state.terms));
    }
    if (pathname === '/api/waitlist/seller') return route.fulfill(json(origin, state.waitlist ?? []));
    if (pathname === '/api/products') return route.fulfill(json(origin, state.products ?? []));
    return route.fallback();
  });
}

async function open(browser, images, origin, role, target, state, { preOrder = false, ready } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  page.on('request', (r) => { if (process.env.DEBUG_REQ && /product-launches|preorder/.test(r.url())) console.log('  [req]', r.method(), r.url()); });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  if (preOrder) {
    await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}`), async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
      return route.fulfill(json(origin, {
        ...base,
        isPreOrder: true,
        preOrderClosingDate: new Date(DEMO_NOW + 12 * DAY).toISOString(),
        preOrderEstShipDate: new Date(DEMO_NOW + 50 * DAY).toISOString(),
      }));
    });
  }
  await mockApi(context, origin, state);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, role, target);
    if (!ready) break;
    try { await ready(page).first().waitFor({ timeout: 12_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(900);
  return { context, page };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('  ok', name); await reportTextFit(page, name); };
  const zoom = async (locator, name) => { await locator.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('  ok', name); };
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
    const pdp = `/buyer-product-detail?productId=${PRODUCT}`;
    const launchAt = new Date(DEMO_NOW + 3 * DAY + 4 * 3600000 + 25 * 60000).toISOString();

    // Buyer: countdown, Notify me off then on.
    {
      const state = { launchAt, subscribed: false };
      const { context, page } = await open(browser, images, server.origin, 'buyer', pdp, state, { ready: (p) => p.getByTestId('launch-countdown') });
      await page.getByTestId('launch-countdown').waitFor({ timeout: 15_000 }).catch(async (e) => { await shot(page, 'debug'); throw e; });
      await page.getByTestId('launch-countdown').scrollIntoViewIfNeeded();
      await page.mouse.move(196, 500);
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(400);
      await shot(page, '01-pdp-countdown-notify-off');
      await zoom(page.getByTestId('launch-countdown'), 'zoom-countdown-notify-off');
      await page.getByTestId('launch-notify-me').click();
      await page.waitForTimeout(700);
      await shot(page, '02-pdp-countdown-notify-on');
      await zoom(page.getByTestId('launch-countdown'), 'zoom-countdown-notify-on');
      await context.close();
    }

    // Buyer: pre-order ship-by block.
    {
      const state = {
        terms: {
          shipBy: new Date(DEMO_NOW + 50 * DAY).toISOString(),
          daysLeft: 50,
          closingDate: new Date(DEMO_NOW + 12 * DAY).toISOString(),
          refundWindowDays: 60,
          refundCopy: `If it hasn't shipped by ${new Date(DEMO_NOW + 50 * DAY).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} you're refunded automatically.`,
          note: 'Made to order in Porto.',
        },
      };
      const { context, page } = await open(browser, images, server.origin, 'buyer', pdp, state, { preOrder: true, ready: (p) => p.getByTestId('preorder-ship-by') });
      await page.getByTestId('preorder-ship-by').waitFor({ timeout: 15_000 });
      await page.getByTestId('preorder-ship-by').scrollIntoViewIfNeeded();
      await shot(page, '03-preorder-ship-by');
      await zoom(page.getByTestId('preorder-ship-by'), 'zoom-preorder-ship-by');
      await context.close();
    }

    // Seller: launches list + editor.
    {
      const state = {
        products: [
          { id: 'p-1', name: 'Rust Field Jacket', status: 'active', images: [], variants: [] },
          { id: 'p-2', name: 'Canvas Tote', status: 'active', images: [], variants: [] },
        ],
        launches: [
          { productId: 'p-1', name: 'Rust Field Jacket', imageUrl: null, status: 'active', launchAt, launchedAt: null, notifyFollowers: true, alertCount: 128 },
          { productId: 'p-3', name: 'Wool Overshirt', imageUrl: null, status: 'active', launchAt: new Date(DEMO_NOW + 9 * DAY).toISOString(), launchedAt: null, notifyFollowers: false, alertCount: 1 },
          { productId: 'p-4', name: 'Linen Shorts', imageUrl: null, status: 'active', launchAt: new Date(DEMO_NOW - 2 * DAY).toISOString(), launchedAt: new Date(DEMO_NOW - 2 * DAY).toISOString(), notifyFollowers: true, alertCount: 54 },
        ],
      };
      const { context, page } = await open(browser, images, server.origin, 'seller', '/product-launches', state, { ready: (p) => p.getByText('Rust Field Jacket') });
      await page.getByText('Rust Field Jacket').first().waitFor({ timeout: 15_000 });
      await shot(page, '04-seller-launches-list');
      await zoom(page.getByText('Rust Field Jacket').first().locator('xpath=ancestor::*[@role="button" or @tabindex="0"][1]'), 'zoom-launch-row').catch(() => {});
      await page.getByText('Rust Field Jacket').first().click();
      await page.getByText('Notify my followers').waitFor({ timeout: 10_000 });
      await shot(page, '05-seller-launch-edit');
      await context.close();
    }

    // Seller: waitlist demand.
    {
      const state = {
        waitlist: [
          { productId: 'p-1', variantId: 'v-1', productName: 'Rust Field Jacket', variantLabel: 'M / Rust', count: 14, notifiedCount: 0 },
          { productId: 'p-1', variantId: 'v-2', productName: 'Rust Field Jacket', variantLabel: 'XL / Rust', count: 6, notifiedCount: 2 },
          { productId: 'p-2', variantId: 'v-3', productName: 'Canvas Tote', variantLabel: 'One size / Natural', count: 3, notifiedCount: 3 },
        ],
      };
      const { context, page } = await open(browser, images, server.origin, 'seller', '/waitlist-demand', state, { ready: (p) => p.getByText('Notify now') });
      await page.getByText('Notify now').first().waitFor({ timeout: 15_000 }).catch(async (e) => { await shot(page, 'debug'); throw e; });
      await shot(page, '06-seller-waitlist-demand');
      await zoom(page.getByText('Rust Field Jacket').first().locator('xpath=ancestor::*[2]'), 'zoom-waitlist-row').catch(() => {});
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
