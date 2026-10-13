/**
 * Item 10 verification: a signed-out web visitor opens a product link,
 * taps Buy, and reaches guest checkout — no install, no account.
 *
 *   APP_URL=http://localhost:8103 PRODUCT_ID=... node scripts/guest-instant-checkout-screenshots.mjs
 *
 * Writes PNGs to screenshots/f1-acquisition/seo/ at 390x844 and logs the
 * browser console / failed requests so a stuck boot is visible.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.APP_URL || 'http://localhost:8103';
const PRODUCT = process.env.PRODUCT_ID || 'a0000000-0000-4000-8000-000000000001';
const OUT = path.resolve(process.cwd(), '../../screenshots/f1-acquisition/seo');
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const failures = [];
page.on('response', (r) => { if (r.url().includes('/api/')) failures.push(`api ${r.status()} ${r.url().slice(0, 140)}`); });
page.on('requestfailed', (r) => failures.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`));
page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text().slice(0, 160)}`); });

await page.goto(`${BASE}/store/product/${PRODUCT}`, { waitUntil: 'load', timeout: 300000 });
await page.waitForTimeout(Number(process.env.BOOT_WAIT_MS || 45000));
await page.screenshot({ path: path.join(OUT, 'ours-guest-product.png') });
console.log('product text:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)));

const buy = page.getByText(/^(Buy now|Buy|Add to bag|Add to cart)$/i).first();
if (await buy.count()) {
  await buy.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUT, 'ours-guest-after-buy.png') });
  console.log('after buy url:', page.url());
  console.log('after buy text:', JSON.stringify((await page.evaluate(() => document.body.innerText)).slice(0, 300)));
} else {
  console.log('no buy button found');
}
console.log('failures:', failures.filter((f) => !/clerk/i.test(f)).slice(0, 15).join('\n'));
await browser.close();
