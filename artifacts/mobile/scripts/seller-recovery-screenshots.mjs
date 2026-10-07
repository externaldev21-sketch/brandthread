#!/usr/bin/env node
/**
 * Seller chargeback recovery + Thread Cash promo/withdrawable, at 390×844 on
 * the store-screenshots harness (signed-in demo seller, fake API). The
 * finance / thread-cash endpoints answer with the exact JSON shapes the new
 * server routes return (GET /api/finance/balance|summary|recoveries,
 * GET /api/thread-cash).
 *
 *   node scripts/seller-recovery-screenshots.mjs [--build] [buildDir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const args = process.argv.slice(2);
const BUILD_DIR = path.resolve(args.find((a) => !a.startsWith('--')) ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/seller-recovery');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 390, height: 844 };

const OWED = 4210;
const AVAILABLE = 0;
const now = Date.parse('2026-10-06T16:00:00Z');
const iso = (daysAgo) => new Date(now - daysAgo * 86_400_000).toISOString();

const balance = {
  available: { amount: AVAILABLE, currency: 'usd', formatted: '$0.00' },
  pending: { amount: 1850, currency: 'usd', formatted: '$18.50' },
  nextPayout: null,
  connected: true,
  payoutsEnabled: true,
  bankConnected: true,
  processingCashout: null,
  recoveryOwedCents: OWED,
  payoutsPaused: true,
  balanceAfterRecovery: { amount: AVAILABLE - OWED, currency: 'usd', formatted: '−$42.10' },
};
const money = (amount) => ({ amount, formatted: `$${(amount / 100).toFixed(2)}` });
const summary = {
  currency: 'usd', connected: true, stripeError: false,
  recoveryOwedCents: OWED, payoutsPaused: true, balanceAfterRecovery: { amount: -OWED, formatted: '−$42.10' },
  held: { ...money(12840), drops: [] },
  releasing: { ...money(0), count: 0 },
  available: money(AVAILABLE),
  pending: money(1850),
  paidOut: { ...money(186420), toBank: money(171200) },
  owed: money(0),
  credit: money(0),
  lifetime: { grossSales: money(214300), refunded: money(6800), platformFees: money(10715), processingFees: money(6531) },
  activity: [
    { id: 'a1', kind: 'chargeback_lost', description: null, orderId: 'o1', dropId: null, occurredAt: iso(1), sellerEffectCents: -7310 },
    { id: 'a2', kind: 'recovery_release_netted', description: null, orderId: 'o2', dropId: null, occurredAt: iso(0), sellerEffectCents: 0 },
  ],
};
const recoveries = {
  recoveryOwedCents: OWED,
  payoutsPaused: true,
  recoveries: [
    {
      id: 'rec_1', orderId: 'ord_1042', orderNumber: '1042', disputeId: 'dsp_1', stripeDisputeId: 'dp_1042',
      disputeReason: 'product_not_received', amountCents: 5810, feeCents: 1500, heldCancelledCents: 0,
      recoveredCents: 3100, forgivenCents: 0, outstandingCents: OWED, status: 'open', createdAt: iso(3), recoveredAt: null,
      applications: [
        { id: 'app_1', source: 'transfer_reversal', amountCents: 1800, stripeRef: 'trr_1', orderId: 'ord_1042', orderNumber: '1042', createdAt: iso(3) },
        { id: 'app_2', source: 'release_netting', amountCents: 1300, stripeRef: 'rel_1', orderId: 'ord_1057', orderNumber: '1057', createdAt: iso(1) },
      ],
    },
    {
      id: 'rec_0', orderId: 'ord_0991', orderNumber: '991', disputeId: 'dsp_0', stripeDisputeId: 'dp_0991',
      disputeReason: 'fraudulent', amountCents: 2400, feeCents: 1500, heldCancelledCents: 0,
      recoveredCents: 3900, forgivenCents: 0, outstandingCents: 0, status: 'recovered', createdAt: iso(40), recoveredAt: iso(38),
      applications: [
        { id: 'app_0', source: 'transfer_reversal', amountCents: 3900, stripeRef: 'trr_0', orderId: 'ord_0991', orderNumber: '991', createdAt: iso(40) },
      ],
    },
  ],
};
const threadCash = {
  balanceCents: 4260, cashableCents: 1200, promoCents: 3060, paidCents: 1200, openRedemptions: [],
  config: { dailyAmountCents: 10, streakBonusCents: 100, streakBonusDays: 7, graceHours: 20, expiryDays: 180, maxRedemptionPerOrderCents: 2000 },
  streak: { currentStreak: 0, longestStreak: 0, lastCheckInDate: null, timezone: 'UTC', alreadyCheckedInToday: false, dayInCycle: 0 },
};

async function run() {
  if (args.includes('--build') || !existsSync(path.join(BUILD_DIR, 'index.html'))) buildPreviewWeb(BUILD_DIR);
  const server = await serveBuild(BUILD_DIR);
  const ORIGIN = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true };

  async function open(target, waitText, { paused = true } = {}) {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: ORIGIN, images });
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      const json = (body) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(body),
        headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
      });
      if (p === '/api/finance/balance') return json(paused ? balance : { ...balance, payoutsPaused: false, recoveryOwedCents: 0, balanceAfterRecovery: { amount: 0, currency: 'usd', formatted: '$0.00' } });
      if (p === '/api/finance/summary') return json(summary);
      if (p === '/api/finance/recoveries') return json(recoveries);
      if (p === '/api/thread-cash') return json(threadCash);
      return route.fallback();
    });
    page.setDefaultNavigationTimeout(240_000);
    await openScreen(page, activity, ORIGIN, 'seller', target);
    // The app remounts navigation once after the demo sign-in settles; push
    // the target again if that swallowed the first navigation.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.getByText(waitText).first().waitFor({ timeout: 12_000 });
        break;
      } catch (error) {
        if (attempt === 5) {
          await page.screenshot({ path: path.join(MOBILE_ROOT, '.store-screenshots', 'debug-failure.png') });
          throw error;
        }
        await page.evaluate((url) => {
          history.pushState(history.state, '', url);
          dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        }, `${target}?bt_preview=seller`);
      }
    }
    await waitForQuietNetwork(activity, 900, 20_000);
    await page.waitForTimeout(1200);
    return { context, page };
  }
  const shot = async (page, name) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log(`  ✓ ${name}`);
  };

  {
    const { context, page } = await open('/finance', 'Payouts paused');
    await shot(page, '01-finance-negative-balance-payouts-paused');
    await context.close();
  }
  {
    const { context, page } = await open('/recoveries', 'CHARGEBACKS');
    await shot(page, '02-recoveries');
    await page.mouse.move(195, 500);
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(600);
    await shot(page, '03-recoveries-scrolled');
    await context.close();
  }
  {
    const { context, page } = await open('/payouts', 'Withdrawable');
    await shot(page, '04-payouts-paused-thread-cash-promo-vs-withdrawable');
    await context.close();
  }
  {
    const { context, page } = await open('/payouts', 'Withdrawable', { paused: false });
    await shot(page, '05-payouts-thread-cash-promo-vs-withdrawable');
    await page.getByTestId('seller-thread-cash-cash-out-button').click();
    await page.getByTestId('cash-out-sheet').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(900);
    await shot(page, '06-cash-out-sheet-withdrawable');
    await context.close();
  }
  await browser.close();
  server.close();
}

run().catch((error) => { console.error(error); process.exit(1); });
