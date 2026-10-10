#!/usr/bin/env node
/**
 * Guest checkout on the web at 393x852 (BT-255..258, BT-270/271): the
 * signed-out buyer preview (?bt_preview=buyer&demo=1) buys a seeded preview
 * product (Buy now) and lands on /buyer-checkout. The preview catalog is
 * dev-only, so this drives a running Expo web dev server:
 *
 *   pnpm exec expo start --web --port 8099      (in another shell)
 *   node scripts/guest-checkout-screenshots.mjs [outDir] [baseUrl]
 *
 * Only the dev server is reachable. The connectivity probe (/api/healthz)
 * and the public discount-code check are answered by stubs (a demo 10% code,
 * THREAD10); every other request is aborted and every /api/ call is listed,
 * so the run proves a signed-out web checkout never calls a checkout or
 * payment endpoint.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './store-screenshots/harness.mjs';

const out = path.resolve(process.argv[2] ?? '../../screenshots/revenue-p1/checkout');
const base = process.argv[3] ?? 'http://localhost:8099';
mkdirSync(out, { recursive: true });
const browser = await launchBrowser();
const apiCalls = [];

try {
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api\/v\d+\//, '/api/');
    if (p.includes('/api/')) apiCalls.push(`${route.request().method()} ${p}`);
    if (url.origin === new URL(base).origin) return route.continue();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    // The connectivity probe (lib/offlineState.ts): answer it so the page isn't shown offline.
    if (p === '/api/healthz') return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '{"status":"ok"}' });
    // Demo stub for the public code check, so a code can be shown applied (no real server).
    if (p === '/api/discount-codes/validate') {
      const subtotal = Number(url.searchParams.get('subtotalCents') ?? 0);
      return route.fulfill({
        status: 200, headers: cors, contentType: 'application/json',
        body: JSON.stringify({ code: 'THREAD10', type: 'percentage', value: 10, appliedAmountCents: Math.round(subtotal / 10), description: '10% off your order' }),
      });
    }
    return route.abort();
  });
  const scrollTo = async (testId, block = 'start') => {
    await page.getByTestId(testId).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
    await page.waitForTimeout(600);
  };
  await page.goto(`${base}/thread-product-detail?productId=preview-product-01&bt_preview=buyer&demo=1`, { timeout: 240_000 });
  await page.getByText('Sculpted Wool Coat').first().waitFor({ timeout: 60_000 });
  await page.getByText('Necessary only', { exact: true }).first().click({ timeout: 2000 }).catch(() => {});
  await page.getByText('M', { exact: true }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(800);
  await page.getByText(/^(Buy now|Buy it now|Buy)/i).first().click({ timeout: 10_000 });
  for (let i = 0; i < 60 && !page.url().includes('buyer-checkout'); i++) await page.waitForTimeout(500);
  await page.getByText(/^Pay /).first().waitFor({ timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(out, 'guest-checkout-web-top.png') });
  // Apply a store code (the demo stub above answers the check).
  await scrollTo('checkout-promo-input', 'center');
  await page.getByTestId('checkout-promo-input').first().fill('THREAD10');
  await page.getByTestId('checkout-promo-apply').first().click();
  await page.getByTestId('checkout-promo-applied').first().waitFor({ timeout: 15_000 });
  // Middle: the end of the shipping address, then the store's applied code.
  await scrollTo('checkout-promo-applied', 'center');
  await page.screenshot({ path: path.join(out, 'guest-checkout-web-middle.png') });
  // Bottom: scroll the page's scroller to the end (summary, discount line, Pay).
  await page.evaluate(() => {
    const scrollers = [...document.querySelectorAll('div')].filter((el) => el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible');
    const main = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (main) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'guest-checkout-web-summary.png') });
  console.log('url:', page.url());
  const paying = apiCalls.filter((call) => /checkout|payment-intent|thread-cash|loyalty/.test(call));
  console.log('checkout/payment API calls:', paying.length ? [...new Set(paying)].join(', ') : 'none');
  await context.close();
} finally {
  await browser.close();
}
