#!/usr/bin/env node
/**
 * F7 refund-credit (items 113, 114) screenshots at 393x852 from an exported
 * web build:
 *   node scripts/f7-refund-credit-screenshots.mjs <buildDir> <before|after> [outDir]
 * Fakes the buyer order, the return rows, GET /api/returns/refund-options,
 * the seller order and POST /api/orders/:id/refund on top of the harness's
 * demo API.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const [buildDirArg, label = 'after', outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/f7/refund-credit'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const ORDER_ID = '7d0b6a3e-1f6c-4b7e-9a51-2c1f0e9d4a10';
const items = [{ id: 'oi_hoodie', productId: '', productName: 'Ember Hoodie', variantLabel: 'Charcoal / M', quantity: 1, priceCents: 14_800 }];
const BUYER_ORDER = {
  id: ORDER_ID, orderNumber: 'BT-10517', ownerId: 'user_northline', sellerDisplayName: 'Northline Studio',
  status: 'delivered', stripePaymentIntentId: 'pi_demo', subtotalCents: 14_800, shippingCents: 1_200, totalCents: 16_000,
  items, createdAt: '2026-09-10T17:00:00.000Z', updatedAt: '2026-09-15T17:00:00.000Z',
  shippingAddress: { name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
};
const SELLER_ORDER = {
  ...BUYER_ORDER, buyerId: 'user_jordan', customerId: null, customer: null, guestEmail: null,
  fundsState: 'settled_direct', chargeModel: 'destination', refundedCents: 0, discountAmountCents: 0, taxCents: 0,
  platformFeeCents: 800, processingFeeCents: 494, sellerNetCents: 14_706, paidAt: '2026-09-10T17:00:00.000Z',
};
const returnRow = (over) => ({
  id: 'ret_demo', orderId: ORDER_ID, orderNumber: 'BT-10517', buyerId: 'user_jordan', sellerId: 'user_northline',
  buyerName: 'Jordan Reyes', sellerName: 'Northline Studio', reason: 'wrong_size', notes: 'Runs a size small. Tags still on.',
  evidenceUrls: [], requestedItems: [{ lineItemId: 'oi_hoodie', productName: 'Ember Hoodie', variantTitle: 'Charcoal / M', quantity: 1, unitPriceCents: 14_800 }],
  totalCents: 16_000, sellerResponse: null, refundAmountCents: null,
  createdAt: '2026-09-17T18:00:00.000Z', updatedAt: '2026-09-17T18:00:00.000Z', ...over,
});

async function json(context, pattern, body, method = 'GET') {
  await context.route(pattern, (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context,x-api-version',
      'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (req.method() !== method) return route.fallback();
    return route.fulfill({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', headers, body: JSON.stringify(typeof body === 'function' ? body(req) : body) });
  });
}

async function settle(page, activity) {
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 700, 12_000);
  await page.waitForTimeout(900);
}

async function scrollTo(page, text, block = 'start') {
  const el = await page.$(`text=${text}`);
  await el?.evaluate((node, b) => node.scrollIntoView({ block: b }), block);
  await page.waitForTimeout(400);
  return Boolean(el);
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(path.resolve(buildDirArg));
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) });
  try {
    // 1. Buyer: request a return (the refund method chooser).
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      await json(context, new RegExp(`/api(?:/v1)?/buyer/orders/${ORDER_ID}(\\?|$)`), BUYER_ORDER);
      await json(context, /\/api(?:\/v1)?\/returns\/buyer(\?|$)/, []);
      await json(context, /\/api(?:\/v1)?\/returns\/refund-options(\?|$)/, { methods: ['original', 'thread_cash', 'store_credit'] });
      await page.goto(`${origin}/buyer-return-request?orderId=${ORDER_ID}`);
      await settle(page, activity);
      await shot(page, 'return-request-top');
      const found = await scrollTo(page, 'How do you want your refund?') || await scrollTo(page, 'Refund to your original payment', 'center');
      await shot(page, 'return-request-refund');
      const tc = await page.$('[data-testid="refund-method-thread_cash"]');
      if (tc) {
        await tc.click();
        await page.waitForTimeout(300);
        await shot(page, 'return-request-thread-cash');
      }
      console.log(`${label}: return request refund section found=${found} chooser=${Boolean(tc)}`);
      await context.close();
    }

    // 2. Seller: the return to review (buyer asked for Thread Cash).
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
      await json(context, /\/api(?:\/v1)?\/returns\/ret_demo(\?|$)/, returnRow({ status: 'pending', resolutionRequested: 'thread_cash' }));
      await page.goto(`${origin}/return-detail?returnId=ret_demo`);
      await settle(page, activity);
      await shot(page, 'return-detail-seller');
      await scrollTo(page, 'View order', 'center');
      await shot(page, 'return-detail-seller-bottom');
      await context.close();
    }

    // 3. Buyer: the same return, refunded as store credit.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      await json(context, /\/api(?:\/v1)?\/returns\/ret_demo(\?|$)/, returnRow({
        status: 'refunded', resolutionRequested: 'store_credit', refundMethod: 'store_credit', refundAmountCents: 14_800,
        updatedAt: '2026-09-18T19:00:00.000Z',
      }));
      await page.goto(`${origin}/return-detail?returnId=ret_demo`);
      await settle(page, activity);
      await shot(page, 'return-detail-buyer-store-credit');
      await context.close();
    }

    // 4. Seller: Issue refund from order detail.
    {
      const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
      await json(context, new RegExp(`/api(?:/v1)?/orders/${ORDER_ID}(\\?|$)`), SELLER_ORDER);
      await json(context, new RegExp(`/api(?:/v1)?/orders/${ORDER_ID}/refund(\\?|$)`), (req) => {
        const body = JSON.parse(req.postData() ?? '{}');
        return { refundId: 'rf_demo', amountCents: body.amountCents, method: body.method, giftCardId: body.method === 'store_credit' ? 'gc_demo' : null, duplicate: false };
      }, 'POST');
      await page.goto(`${origin}/refund-detail?orderId=${ORDER_ID}`);
      await settle(page, activity);
      await shot(page, 'refund-detail-top');
      const method = await scrollTo(page, 'Refund method');
      await shot(page, 'refund-detail-method');
      const store = await page.$('[data-testid="seller-refund-method-store_credit"]');
      if (store) {
        await store.click();
        await page.waitForTimeout(300);
        await shot(page, 'refund-detail-store-credit');
      }
      await page.evaluate(() => {
        const scrollers = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 20 && getComputedStyle(d).overflowY !== 'visible');
        scrollers.forEach((d) => { d.scrollTop = d.scrollHeight; });
      });
      await page.waitForTimeout(500);
      await shot(page, 'refund-detail-bottom');
      console.log(`${label}: refund method section=${method} store option=${Boolean(store)}`);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
