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
 * Only the dev server is reachable: every other request is aborted and any
 * /api/ call is listed, so the run proves a signed-out web checkout never
 * calls the paying API.
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
    if (url.pathname.includes('/api/')) apiCalls.push(`${route.request().method()} ${url.pathname}`);
    if (url.origin === new URL(base).origin) return route.continue();
    return route.abort();
  });
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
  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'guest-checkout-web-middle.png') });
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, 'guest-checkout-web-summary.png') });
  console.log('url:', page.url());
  const paying = apiCalls.filter((call) => /checkout|payment-intent|thread-cash|loyalty/.test(call));
  console.log('checkout/payment API calls:', paying.length ? [...new Set(paying)].join(', ') : 'none');
  await context.close();
} finally {
  await browser.close();
}
