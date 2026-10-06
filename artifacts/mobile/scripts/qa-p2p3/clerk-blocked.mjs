import { chromium } from 'playwright';
const [origin, out] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('**/*', (route) => {
  const u = new URL(route.request().url());
  if (u.origin === origin) return route.continue();
  return route.abort();
});
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 120000 });
let text = '';
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(500);
  text = await page.evaluate(() => document.body.innerText);
  if (/Taking longer|Couldn.t connect/i.test(text)) break;
}
console.log('after', ((Date.now() - t0) / 1000).toFixed(1), 's:', text.replace(/\n+/g, ' | ').slice(0, 200));
await page.screenshot({ path: out });
await browser.close();
