/**
 * Screenshots for the SEO / acquisition pages served by server/serve.js.
 *
 *   SERVE_URL=http://localhost:8103 node scripts/seo-pages-screenshots.mjs
 *
 * Expects serve.js running against an API with seeded data. Writes PNGs to
 * screenshots/f1-acquisition/seo/ at 390x844.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.SERVE_URL || 'http://localhost:8103';
const OUT = path.resolve(process.cwd(), '../../screenshots/f1-acquisition/seo');
const PRODUCT = process.env.PRODUCT_ID || 'a0000000-0000-4000-8000-000000000004';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox'],
});
const viewport = { width: 390, height: 844 };

async function shot(name, url, { javaScriptEnabled = true, fullPage = false, wait = 0 } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, javaScriptEnabled });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${url}`, { waitUntil: javaScriptEnabled && !wait ? 'networkidle' : 'load' });
  if (wait) await page.waitForTimeout(wait);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log(name, JSON.stringify(text));
  await ctx.close();
}

await shot('ours-new-this-week', '/new');
await shot('ours-new-this-week-full', '/new', { fullPage: true });
// Product page as a crawler without JS sees it (the <noscript> body).
await shot('ours-product-noscript', `/store/product/${PRODUCT}`, { javaScriptEnabled: false });
// Same URL with JS: the noscript body never renders; the app boots as before.
await shot('ours-product-js-booted', `/store/product/${PRODUCT}`, { wait: 6000 });
await browser.close();
