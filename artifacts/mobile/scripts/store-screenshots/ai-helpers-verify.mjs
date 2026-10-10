/**
 * AI helpers screens at 393x852 with the AI endpoints answered by a local stub
 * (the real provider is never called). Run: node scripts/store-screenshots/ai-helpers-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { clerkStubScript } from './clerk-stub.mjs';
import { DEMO_NOW, DEMO_TIME_ZONE, SELLER_USER, localStorageSeed, respond } from './demo-data.mjs';
import { fitReport } from '../text-fit-check-ai-helpers.mjs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, serveBuild } from './harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/ai-helpers');
mkdirSync(OUT, { recursive: true });
const DEMO_API = 'https://api.brandthread.test';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const calls = [];
const STUB = {
  '/api/ai/credits': { balance: 42, tools: [
    { tool: 'ai_caption', label: 'Caption', cost: 1 }, { tool: 'ai_product_description', label: 'Product description', cost: 2 }, { tool: 'ai_size_chart', label: 'Size chart', cost: 2 }] },
  '/api/ai-helpers/caption': { captions: ['Fresh drop, same energy.', 'Built for the block. Limited run.', 'New fit, who dis.'], hashtags: ['#streetwear', '#newdrop', '#ootd', '#limitedrun'] },
  '/api/ai-helpers/product-description': { title: 'Black boxy tee', description: 'A heavyweight black tee with a boxy cut and a small chest print.', bullets: ['Boxy cut', 'Solid black', 'Small chest print'] },
  '/api/ai-helpers/size-chart': { unit: 'cm', note: 'Relaxed fit.', rows: [], sizeChart: { columns: ['Chest', 'Length'], unit: 'cm', notes: 'Relaxed fit.',
    rows: [['XS', '92', '67'], ['S', '96', '68.5'], ['M', '100', '70'], ['L', '104', '71.5'], ['XL', '108', '73']].map(([size, ...values]) => ({ size, values })) } },
};

buildPreviewWeb();
const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
const browser = await launchBrowser();
try {
  const context = await browser.newContext({ viewport: DEVICE.viewport, deviceScaleFactor: DEVICE.scale, isMobile: true, hasTouch: true,
    userAgent: DEVICE.userAgent, locale: 'en-US', timezoneId: DEMO_TIME_ZONE, colorScheme: 'dark', reducedMotion: 'reduce' });
  await context.clock.install({ time: DEMO_NOW });
  await context.addInitScript(clerkStubScript(SELLER_USER));
  await context.addInitScript((seed) => { if (sessionStorage.getItem('bt:screenshot-seeded')) return;
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); sessionStorage.setItem('bt:screenshot-seeded', '1'); }, localStorageSeed('seller', {}));
  await context.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    if (url.origin !== DEMO_API) return route.abort();
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const sp = url.pathname.replace('/api/v1/', '/api/');
    if (STUB[sp]) { calls.push(`${req.method()} ${url.pathname} ${req.postData() ?? ''}`); return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(STUB[sp]) }); }
    const body = respond({ method: req.method(), path: url.pathname, query: url.searchParams, role: 'seller', options: {} });
    if (body === undefined) return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{}' });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  const go = async (target) => {
    await page.goto(`${origin}${target}${target.includes('?') ? '&' : '?'}bt_preview=seller`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await page.waitForTimeout(800);
  };
  let failures = 0;
  // add-product is existing UI (reported for information only); the new screens must be clean.
  const shot = async (name) => { const n = (await fitReport(page, name)).length; if (!name.includes('add-product')) failures += n; await page.screenshot({ path: path.join(OUT, name) }); };

  await go('/ai-helper?mode=caption&postId=11111111-1111-4111-8111-111111111111&draft=New%20hoodie%20drop');
  await page.getByText(/Generate/).first().waitFor();
  await shot('01-caption-input.png');
  await page.getByText(/Generate/).first().click();
  await page.getByText('Built for the block. Limited run.').waitFor();
  await page.getByText('Built for the block. Limited run.').click();
  await shot('02-caption-results.png');

  await go('/ai-helper?mode=description&productId=22222222-2222-4222-8222-222222222222&name=Boxy%20tee');
  await page.getByText(/Generate/).first().click();
  await page.getByText('Black boxy tee').waitFor();
  await shot('03-description-results.png');

  await go('/ai-helper?mode=size-chart&productId=22222222-2222-4222-8222-222222222222');
  const inputs = page.locator('input');
  await inputs.nth(0).fill('100'); await inputs.nth(1).fill('82'); await inputs.nth(2).fill('70');
  await inputs.nth(3).fill('4'); await inputs.nth(4).fill('4'); await inputs.nth(5).fill('1.5');
  await shot('04-size-chart-input.png');
  await page.getByText(/Generate/).first().click();
  await page.getByText('Relaxed fit.').first().waitFor();
  await page.getByText('Relaxed fit.').first().scrollIntoViewIfNeeded();
  await shot('05-size-chart-results.png');
  await go('/add-product?editId=prod_nl_hoodie_ember');
  await page.getByTestId('add-product-ai-description').scrollIntoViewIfNeeded().catch(() => {});
  await shot('06-add-product-ai-description-row.png');
  await page.getByText('Size chart', { exact: true }).first().click().catch(() => {});
  await page.getByTestId('add-product-ai-size-chart').scrollIntoViewIfNeeded().catch(() => {});
  await shot('07-add-product-ai-size-chart-row.png');
  console.log(calls.join('\n'));
  if (failures) process.exitCode = 1;
} catch (e) { console.log(calls.join('\n')); throw e; } finally { await browser.close(); await close(); }
