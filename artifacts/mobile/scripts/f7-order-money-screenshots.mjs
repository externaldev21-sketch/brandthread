#!/usr/bin/env node
/**
 * F7 order-money (items 111, 112) screenshots at 393x852 from an exported
 * web build:
 *   node scripts/f7-order-money-screenshots.mjs <buildDir> <before|after> [outDir]
 * Fakes GET /api/orders/:id (stored fee columns), the public fee schedule and
 * GET /api/finance/payouts/:id on top of the harness's demo API.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const [buildDirArg, label = 'after', outArg] = process.argv.slice(2);
const OUT = path.resolve(outArg ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/f7/order-money'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

const ORDER_ID = 'ord_fee_demo';
const ORDER = {
  id: ORDER_ID, ownerId: 'user_northline', buyerId: null, customerId: null, customer: null,
  guestEmail: 'maya@example.com',
  shippingAddress: { name: 'Maya Chen', street: '129 Ember Court', city: 'Portland', state: 'OR', zip: '97205', country: 'US' },
  orderNumber: 'BT-10482', status: 'processing',
  totalCents: 9_000, subtotalCents: 9_500, shippingCents: 500, discountAmountCents: 1_000, taxCents: 0,
  fundsState: 'settled_direct', chargeModel: 'destination',
  platformFeeCents: 475, processingFeeCents: 291, processingFeeChargedCents: 291, sellerNetCents: 8_234,
  refundedCents: 0, platformFeeRefundedCents: 0, threadCashAppliedCents: 1_000,
  paidAt: '2026-09-29T15:00:00.000Z', createdAt: '2026-09-29T15:00:00.000Z', updatedAt: '2026-09-29T16:00:00.000Z',
  items: [{ id: 'oi_1', productId: '', productName: 'Field jacket', variantLabel: 'M', quantity: 1, priceCents: 9_500 }],
};
const FEE_SCHEDULE = { platformFeeBps: 500, processing: { bps: 290, fixedCents: 30 } };
const m = (amount) => ({ amount, formatted: `${amount < 0 ? '-' : ''}$${(Math.abs(amount) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` });
const PAYOUT = {
  connected: true,
  payout: {
    id: 'po_1Q2w3E4r5T6y', amount: 101_610, currency: 'usd', formatted: '$1,016.10', status: 'paid', method: 'standard', automatic: true,
    arrivalDate: '2026-09-28T12:00:00.000Z', created: '2026-09-25T12:00:00.000Z', failureCode: null, failureMessage: null,
    destination: { last4: '6789', brand: 'Chase' }, instantFee: null,
  },
  breakdown: {
    lines: { sales: m(124_000), platformFee: m(-6_200), stripeFee: m(-3_890), refunds: m(-9_800), disputes: m(0), holds: m(-2_500), adjustments: m(0) },
    net: m(101_610), reconciled: true, remainder: m(0), transactionCount: 9, truncated: false,
  },
};

async function json(context, pattern, body) {
  await context.route(pattern, (route) => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context,x-api-version', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });
  });
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(path.resolve(buildDirArg));
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    await json(context, new RegExp(`/orders/${ORDER_ID}(\\?|$)`), ORDER);
    await json(context, /\/public\/fee-schedule/, FEE_SCHEDULE);
    await json(context, /\/finance\/payouts\/po_[A-Za-z0-9]+(\?|$)/, PAYOUT);

    // Order detail, Payment tab.
    await page.goto(`${origin}/order-detail?id=${ORDER_ID}&tab=payment`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(800);
    await page.click('text=Payment').catch(() => {});
    await waitForQuietNetwork(activity, 600, 10_000);
    await page.waitForTimeout(600);
    const anchor = await page.$('text=Payment Breakdown');
    await anchor?.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${label}-order-payment.png`) });
    const toggle = await page.$('[data-testid="order-fees-toggle"]');
    if (toggle) {
      await toggle.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${label}-order-payment-expanded.png`) });
    }
    console.log(`${label}: fees toggle present = ${Boolean(toggle)}`);

    await context.close();

    // Payout detail (fresh context, same entry path as scripts/payouts-screenshots.mjs).
    {
      const { context: c2, page: p2, activity: a2 } = await openContext(browser, { device, role: 'seller', origin, images });
      await json(c2, /\/finance\/payouts\/po_[A-Za-z0-9]+(\?|$)/, PAYOUT);
      await json(c2, /\/team\/context/, { role: 'owner', storeOwnerId: 'user_northline', teamMembershipId: null });
      await p2.goto(`${origin}/payout-detail?id=po_1Q2w3E4r5T6y`);
      await p2.waitForSelector('[data-testid="payout-detail-amount"]', { timeout: 20_000 }).catch(() => {});
      await waitForQuietNetwork(a2, 600, 10_000);
      await p2.waitForTimeout(600);
      await p2.screenshot({ path: path.join(OUT, `${label}-payout-detail.png`) });
      console.log(`${label}: download button present = ${Boolean(await p2.$('[data-testid="payout-detail-download-pdf"]'))}`);
      const btn = await p2.$('[data-testid="payout-detail-download-pdf"]');
      const breakdown = await p2.$('[data-testid="payout-detail-breakdown"]');
      if (btn || breakdown) {
        await (btn ?? breakdown).evaluate((el) => el.scrollIntoView({ block: 'end' }));
        await p2.waitForTimeout(400);
        await p2.screenshot({ path: path.join(OUT, `${label}-payout-detail-bottom.png`) });
      }
      await c2.close();
    }
  } finally {
    await browser.close();
    close();
  }
}
main().catch((err) => { console.error(err); process.exit(1); });
