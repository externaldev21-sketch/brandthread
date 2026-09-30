#!/usr/bin/env node
/**
 * Seller statements screens at 393x852 on the preview web build
 * (store-screenshots harness, signed-in demo seller, stateful fake API that
 * speaks the real /api/finance/statements shapes).
 *
 *   node scripts/statements-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/statements/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/statements');
const API = 'https://api.brandthread.test';
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const MONTHS = [
  { month: '2026-09', label: 'September 2026', netCents: 184250, payoutsCents: -120000, grossSalesCents: 214000, transactionCount: 41 },
  { month: '2026-08', label: 'August 2026', netCents: 162980, payoutsCents: -158400, grossSalesCents: 190500, transactionCount: 37 },
  { month: '2026-07', label: 'July 2026', netCents: 97415, payoutsCents: -97415, grossSalesCents: 113900, transactionCount: 22 },
];
const detail = (row) => {
  const g = row.grossSalesCents;
  const platform = -Math.round(g * 0.05), stripe = -Math.round(g * 0.03), refunds = -Math.round(g * 0.02);
  const net = g + platform + stripe + refunds;
  return {
    period: { month: row.month, start: `${row.month}-01T00:00:00.000Z`, end: `${row.month}-28T23:59:59.999Z`, label: row.label },
    currency: 'usd',
    totals: { grossSalesCents: g, refundsCents: refunds, disputesCents: 0, platformFeesCents: platform, stripeFeesCents: stripe, adjustmentsCents: 0, payoutsCents: row.payoutsCents, netCents: net, balanceChangeCents: net + row.payoutsCents },
    counts: { sales: row.transactionCount, refunds: 2, disputes: 0, payouts: 2, lines: row.transactionCount + 4 },
  };
};

async function open(browser, images, origin, target, ready, months) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/finance/statements') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ connected: true, months }) });
    const one = p.match(/^\/api\/finance\/statements\/(\d{4}-\d{2})$/);
    if (one) {
      const row = MONTHS.find((m) => m.month === one[1]);
      return route.fulfill({ status: row ? 200 : 404, headers, contentType: 'application/json', body: JSON.stringify(row ? detail(row) : { error: 'none' }) });
    }
    return route.fallback();
  });
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'seller', target);
    try { await ready(page).waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity).catch(() => {});
  await page.waitForTimeout(700);
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
    {
      const { context, page } = await open(browser, images, server.origin, '/statements', (p) => p.getByTestId('statement-month-2026-09'), MONTHS);
      await shot(page, '01-statements-list');
      await page.getByTestId('statement-month-2026-08').click();
      await page.getByTestId('statement-download-pdf').waitFor({ timeout: 15_000 });
      await shot(page, '02-statement-month-detail');
      await context.close();
    }
    {
      // Touches existing UI: the new row under Finance > Documents.
      const { context, page } = await open(browser, images, server.origin, '/finance', (p) => p.getByText('Monthly Statements (PDF / CSV)'), MONTHS);
      await page.getByText('Monthly Statements (PDF / CSV)').scrollIntoViewIfNeeded();
      await shot(page, '05-finance-documents-row-after');
      await page.getByText('Monthly Statements (PDF / CSV)').click();
      await page.getByTestId('statement-month-2026-09').waitFor({ timeout: 15_000 });
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, server.origin, '/statements', (p) => p.getByText('No statements yet'), []);
      await shot(page, '03-statements-empty');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
