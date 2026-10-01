#!/usr/bin/env node
/**
 * Payout schedule + payout detail screenshots at 393x852 (seller role,
 * store-screenshots harness; a stateful fake of GET/PATCH
 * /api/finance/payout-schedule and GET /api/finance/payouts[/:id]).
 *
 *   node scripts/payouts-screenshots.mjs [--skip-build] [--before] [--out <dir>] [--build <dir>]
 *
 * --before captures only the two touched existing surfaces (payout history
 * and the Bank account tab) so they can be compared against a dev build.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = path.resolve(opt('--out', path.join(MOBILE_ROOT, '../../docs/pr-assets/payouts')));
const BUILD = path.resolve(opt('--build', DEFAULT_BUILD_DIR));
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
mkdirSync(path.join(OUT, 'zoom'), { recursive: true });

const line = (amount) => ({ amount, formatted: `${amount < 0 ? '-' : ''}$${(Math.abs(amount) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` });
const card = { id: 'card_1', brand: 'Visa', last4: '4242', funding: 'debit' };
const instantInfo = (eligible) => ({
  eligible, reason: eligible ? null : 'not_instant_capable', destination: eligible ? card : null,
  feeBps: 100, minFeeCents: 50,
  maxAmount: { amount: 182_409, formatted: '$1,824.09' },
  quote: { amount: 182_409, fee: 1_824, feeFormatted: '$18.24', total: 184_233, withinBalance: true },
});

const payoutsList = [
  { id: 'po_paid00001', arrivalDate: '2026-09-28T12:00:00Z', formatted: '$1,016.10', status: 'paid', destination: { last4: '6789' } },
  { id: 'po_transit01', arrivalDate: '2026-10-02T12:00:00Z', formatted: '$412.30', status: 'in_transit', destination: { last4: '6789' } },
  { id: 'po_failed001', arrivalDate: '2026-09-20T12:00:00Z', formatted: '$220.00', status: 'failed', destination: { last4: '6789' } },
];
const baseBreakdown = {
  lines: {
    sales: line(124_000), platformFee: line(-6_200), stripeFee: line(-3_890), refunds: line(-9_800),
    disputes: line(0), holds: line(-2_500), adjustments: line(0),
  },
  net: line(101_610), reconciled: true, remainder: line(0), transactionCount: 9, truncated: false,
};
const payoutBase = {
  amount: 101_610, formatted: '$1,016.10', method: 'standard', automatic: true,
  created: '2026-09-25T12:00:00Z', arrivalDate: '2026-09-28T12:00:00Z', failureMessage: null,
  destination: { last4: '6789', brand: 'Chase' }, instantFee: null,
};
const details = {
  po_paid00001: { connected: true, payout: { ...payoutBase, id: 'po_paid00001', status: 'paid' }, breakdown: baseBreakdown },
  po_transit01: { connected: true, payout: { ...payoutBase, id: 'po_transit01', status: 'in_transit', arrivalDate: '2026-10-02T12:00:00Z' }, breakdown: baseBreakdown },
  po_failed001: {
    connected: true,
    payout: { ...payoutBase, id: 'po_failed001', status: 'failed', failureMessage: 'The bank account could not receive this payout.' },
    breakdown: baseBreakdown,
  },
  po_instant001: {
    connected: true,
    payout: { ...payoutBase, id: 'po_instant001', status: 'paid', automatic: false, method: 'instant', amount: 99_000, formatted: '$990.00', instantFee: line(990), destination: { last4: '4242', brand: 'Visa' } },
    breakdown: null,
  },
};

async function installApi(context, state) {
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const json = (body, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/finance/payout-schedule') {
      if (req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() ?? '{}');
        state.schedule = { interval: body.interval, weeklyAnchor: body.weeklyAnchor ?? null, delayDays: 2 };
        state.patches.push(body);
        return json({ changed: true, schedule: state.schedule });
      }
      if (!state.connected) {
        return json({ connected: false, providerConfigured: true, payoutsEnabled: false, schedule: null, instant: { ...instantInfo(false), reason: 'not_connected' }, nextPayoutEstimate: null });
      }
      return json({
        connected: true, providerConfigured: true, payoutsEnabled: true, schedule: state.schedule, instant: instantInfo(state.instant),
        nextPayoutEstimate: state.schedule.interval === 'manual'
          ? { kind: 'manual', date: null, amount: 184_250, formatted: '$1,842.50' }
          : { kind: 'scheduled', date: state.schedule.interval === 'weekly' ? '2026-10-02T12:00:00.000Z' : '2026-10-01T12:00:00.000Z', amount: 184_250, formatted: '$1,842.50' },
      });
    }
    if (p === '/api/finance/balance') {
      return json({
        available: line(184_250), pending: line(62_740), connected: true, payoutsEnabled: true, bankConnected: true,
        processingCashout: null, nextPayout: null,
        nextPayoutEstimate: { kind: 'scheduled', date: '2026-10-01T12:00:00.000Z', amount: 184_250, formatted: '$1,842.50' },
        held: { amount: 0, formatted: '$0.00', count: 0, nextReleaseAt: null, mode: 'hold', enforced: false },
      });
    }
    if (p === '/api/finance/payouts' && req.method() === 'GET') return json({ payouts: state.payoutsEmpty ? [] : payoutsList, hasMore: false, connected: true });
    const one = p.match(/^\/api\/finance\/payouts\/([^/]+)$/);
    if (one) return details[one[1]] ? json(details[one[1]]) : json({ error: 'Payout not found' }, 404);
    if (p === '/api/seller/connect/status') {
      return json({ connected: true, stripeAccountId: 'acct_demo', chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true, status: 'active', verified: true, bankLast4: '6789', providerConfigured: true, payoutSchedule: { interval: state.schedule.interval, delayDays: 2, weeklyAnchor: state.schedule.weeklyAnchor, monthlyAnchor: null } });
    }
    return route.fallback();
  });
}

async function open(browser, images, origin, target, stateOver = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  const state = { connected: true, instant: true, payoutsEmpty: false, patches: [], schedule: { interval: 'daily', weeklyAnchor: null, delayDays: 2 }, ...stateOver };
  await installApi(context, state);
  // The app remounts once after sign-in; retry the client-side navigation
  // until the target screen (its header title) is actually showing.
  const title = target.startsWith('/payout-schedule') ? 'Payout schedule' : target.startsWith('/payout-detail') ? 'Payout' : 'Payouts';
  for (let attempt = 0; ; attempt += 1) {
    await openScreen(page, activity, origin, 'seller', target);
    await waitForQuietNetwork(activity).catch(() => {});
    await page.waitForTimeout(1200);
    const shown = await page.getByText(title, { exact: true }).first().isVisible().catch(() => false);
    if (shown || attempt >= 3) break;
  }
  return { context, page, state };
}

const fitIssues = [];

/**
 * Text-fit and alignment check for the current screen: flags any text
 * element whose content overflows its box (scrollWidth > clientWidth),
 * truncates with an ellipsis, is clipped by the viewport, or sticks out of
 * its parent horizontally.
 */
async function checkFit(page, name) {
  const issues = await page.evaluate((viewportWidth) => {
    const out = [];
    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasOwnText) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = el.textContent.trim().slice(0, 40);
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1) out.push(`overflow "${label}" (${el.scrollWidth}>${el.clientWidth})`);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth) out.push(`ellipsis "${label}"`);
      if (r.left < -0.5 || r.right > viewportWidth + 0.5) out.push(`outside viewport "${label}"`);
      const p = el.parentElement;
      if (p) {
        const pr = p.getBoundingClientRect();
        if (r.left < pr.left - 1 || r.right > pr.right + 1) out.push(`outside parent "${label}"`);
      }
    }
    return [...new Set(out)];
  }, VIEWPORT.width);
  for (const issue of issues) fitIssues.push(`${name}: ${issue}`);
}

async function shot(page, name) {
  await page.waitForTimeout(350);
  await checkFit(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  captured ${name}`);
}

/** Zoomed element screenshot (3x) of one card or button group. */
async function zoom(page, testId, name) {
  const target = page.getByTestId(testId).first();
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await target.screenshot({ path: path.join(OUT, 'zoom', `${name}.png`), animations: 'disabled' });
  console.log(`  zoomed ${name}`);
}

async function main() {
  if (!flag('--skip-build')) buildPreviewWeb(BUILD);
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));

    // Touched existing surfaces.
    {
      const { context, page } = await open(browser, images, server.origin, '/payouts');
      await shot(page, flag('--before') ? 'before-payout-history' : 'after-payout-history');
      await page.getByText('Bank account', { exact: true }).first().click();
      await page.waitForTimeout(600);
      await shot(page, flag('--before') ? 'before-bank-account-tab' : 'after-bank-account-tab');
      await context.close();
    }
    if (flag('--before')) return;

    // Schedule screen: each option.
    {
      const { context, page, state } = await open(browser, images, server.origin, '/payout-schedule');
      await shot(page, '01-schedule-daily');
      await page.getByTestId('payout-schedule-weekly').click();
      await page.waitForTimeout(400);
      await shot(page, '02-schedule-weekly-day-picker');
      await zoom(page, 'payout-schedule-weekly', 'weekly-card-day-grid');
      await zoom(page, 'payout-schedule-instant', 'instant-card-fee-shown');
      await page.getByTestId('payout-schedule-day-monday').click();
      await page.getByTestId('payout-schedule-save').click();
      await page.waitForTimeout(900);
      await shot(page, '03-schedule-weekly-saved');
      console.log('  weekly PATCH body', JSON.stringify(state.patches));
      await page.getByTestId('payout-schedule-instant').click();
      await page.waitForTimeout(400);
      await shot(page, '04-schedule-instant-selected');
      await page.getByTestId('payout-schedule-save').click();
      await page.waitForTimeout(900);
      await shot(page, '05-schedule-instant-saved-cash-out');
      await zoom(page, 'payout-schedule-instant-quote', 'instant-quote-card');
      await zoom(page, 'payout-schedule-actions', 'button-group-cash-out-save');
      console.log('  PATCH bodies', JSON.stringify(state.patches));
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, server.origin, '/payout-schedule', { instant: false });
      await shot(page, '06-schedule-instant-unavailable');
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, server.origin, '/payout-schedule', { connected: false });
      await shot(page, '07-schedule-not-connected-empty');
      await context.close();
    }

    // Payout history -> detail.
    {
      const { context, page } = await open(browser, images, server.origin, '/payouts');
      await page.getByText('$1,016.10').first().click();
      await page.waitForTimeout(1200);
      await shot(page, '08-detail-paid');
      await zoom(page, 'payout-detail-breakdown', 'detail-breakdown-card');
      await context.close();
    }
    for (const [id, name] of [['po_transit01', '09-detail-in-transit'], ['po_failed001', '10-detail-failed'], ['po_instant001', '11-detail-instant-manual'], ['po_missing001', '12-detail-not-found']]) {
      const { context, page } = await open(browser, images, server.origin, `/payout-detail?id=${id}`);
      await shot(page, name);
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, server.origin, '/payouts', { payoutsEmpty: true });
      await shot(page, '13-payout-history-empty');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (fitIssues.length) {
    console.error(`TEXT-FIT ISSUES (${fitIssues.length}):\n${fitIssues.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Text-fit check: no issues.');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
