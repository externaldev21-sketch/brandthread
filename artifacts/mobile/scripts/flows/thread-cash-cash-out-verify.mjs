#!/usr/bin/env node
/**
 * Seller Payouts → Cash out at 390×844 on the real web build (signed-in demo
 * seller, harness fake API with Thread Cash overrides). Asserts:
 *   1. The card and the sheet offer only the CASHABLE amount, not the whole
 *      balance (reward credit is spendable but never cashable).
 *   2. A cash-out whose response is lost is retried with the SAME
 *      idempotency key (the server replays one transfer, never pays twice).
 *   3. The server's THREAD_CASH_NOT_CASHABLE error is shown in the sheet.
 *
 *   node scripts/flows/thread-cash-cash-out-verify.mjs [--skip-build]
 * Output: docs/flows/screens/thread-cash/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from '../store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/flows/screens/thread-cash');
const device = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
mkdirSync(OUT, { recursive: true });
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
try {
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
  const cors = {
    'access-control-allow-origin': server.origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const json = (route, status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  const cashOutKeys = [];
  let cashOutMode = 'drop-then-ok';
  await context.route('https://api.brandthread.test/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/thread-cash' && request.method() === 'GET') {
      return json(route, 200, {
        balanceCents: 4260, cashableCents: 2500,
        config: { dailyAmountCents: 10, streakBonusCents: 100, streakBonusDays: 7, graceHours: 20, expiryDays: 180, maxRedemptionPerOrderCents: 2000 },
        streak: { currentStreak: 0, longestStreak: 0, lastCheckInDate: null, timezone: 'UTC', alreadyCheckedInToday: false, dayInCycle: 0 },
      });
    }
    if (p === '/api/thread-cash/cash-out' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      cashOutKeys.push(body.idempotencyKey);
      if (cashOutMode === 'not-cashable') {
        return json(route, 400, { error: 'You can cash out up to $25.00. Thread Cash rewards can be spent in the app but not cashed out.', code: 'THREAD_CASH_NOT_CASHABLE' });
      }
      if (cashOutMode === 'drop-then-ok' && cashOutKeys.length === 1) return route.abort('connectionreset');
      return json(route, 200, { ok: true, threadCashCents: body.threadCashCents, payoutCents: body.threadCashCents, feeCents: 0, transferId: 'tr_demo' });
    }
    return route.fallback();
  });

  await openScreen(page, activity, server.origin, 'seller', '/payouts');
  await page.waitForTimeout(1500);
  if (!page.url().includes('/payouts')) await page.goto(`${server.origin}/payouts?bt_preview=seller`);
  await page.getByTestId('seller-thread-cash-card').waitFor({ timeout: 20_000 });
  await waitForQuietNetwork(activity);
  const cardText = await page.getByTestId('seller-thread-cash-card').innerText();
  check('card quotes the cashable amount', cardText.includes('Cash out for $25.00'), JSON.stringify(cardText.replace(/\n/g, ' | ')));
  await page.screenshot({ path: path.join(OUT, 'payouts-thread-cash-card.png') });

  await page.getByTestId('seller-thread-cash-cash-out-button').click();
  await page.getByTestId('cash-out-sheet').waitFor();
  const available = await page.getByTestId('cash-out-balance').innerText();
  check('sheet offers only the cashable amount', available.includes('$25.00 available'), available);
  const prefill = await page.getByTestId('cash-out-amount-input').inputValue();
  check('sheet prefills the cashable amount', prefill === '25.00', prefill);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'cash-out-sheet.png') });

  await page.getByTestId('cash-out-amount-input').fill('30');
  const overButton = page.getByRole('button', { name: 'Cash out $30.00' });
  check('more than cashable cannot be submitted', await overButton.isDisabled());

  await page.getByTestId('cash-out-amount-input').fill('20');
  const confirm = page.getByRole('button', { name: 'Cash out $20.00' });
  await confirm.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'cash-out-lost-response.png') });
  await confirm.click();
  await page.waitForTimeout(800);
  check('retry after a lost response reuses the idempotency key',
    cashOutKeys.length === 2 && cashOutKeys[0] && cashOutKeys[0] === cashOutKeys[1], JSON.stringify(cashOutKeys));

  cashOutMode = 'not-cashable';
  await page.getByTestId('seller-thread-cash-cash-out-button').click();
  await page.getByTestId('cash-out-sheet').waitFor();
  await page.getByTestId('cash-out-amount-input').fill('10');
  await page.getByRole('button', { name: 'Cash out $10.00' }).click();
  await page.getByText('Thread Cash rewards can be spent in the app but not cashed out.').waitFor({ timeout: 5_000 }).then(
    () => check('server not-cashable error is shown in the sheet', true),
    () => check('server not-cashable error is shown in the sheet', false),
  );
  await page.screenshot({ path: path.join(OUT, 'cash-out-not-cashable-error.png') });
  await context.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
