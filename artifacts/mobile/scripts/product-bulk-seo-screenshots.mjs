#!/usr/bin/env node
/**
 * 393x852 screenshots for the bulk product actions + product SEO PR. The two
 * new API areas are answered by a small in-script fake (playwright routes
 * registered after the harness's own, so they win); everything else uses the
 * shared demo data.
 *
 *   node scripts/product-bulk-seo-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { reportTextFit } from './lib/textFitCheck.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/product-bulk-seo');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
const API = 'https://api.brandthread.test';

const catalog = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Heavyweight Hoodie', status: 'active', variantCount: 4, minPriceCents: 8500, maxPriceCents: 8500 },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Boxy Tee', status: 'active', variantCount: 3, minPriceCents: 3800, maxPriceCents: 4200 },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Wool Overcoat', status: 'draft', variantCount: 2, minPriceCents: 24000, maxPriceCents: 24000 },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Canvas Tote', status: 'active', variantCount: 1, minPriceCents: 2400, maxPriceCents: 2400 },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Linen Shirt', status: 'archived', variantCount: 3, minPriceCents: 6800, maxPriceCents: 6800 },
].map((p) => ({ ...p, image: null, totalStock: 12, moderationLocked: false }));

function roundPrice(c, r) {
  if (r === 'none') return Math.max(1, c);
  const d = Math.max(1, Math.round(c / 100));
  return r === 'end_99' ? d * 100 - 1 : d * 100;
}
function newPrice(c, ch, r) {
  let n;
  if (ch.mode === 'set') n = ch.value;
  else if (ch.mode === 'amount') n = ch.direction === 'increase' ? c + ch.value : c - ch.value;
  else n = Math.round((c * (ch.direction === 'increase' ? 10000 + ch.value : 10000 - ch.value)) / 10000);
  return roundPrice(Math.max(1, n), r);
}

const seoDetail = {
  productId: catalog[0].id, productName: 'Heavyweight Hoodie',
  seo: { seoTitle: 'Heavyweight Hoodie – 450gsm boxy fit', seoDescription: 'Boxy, garment-dyed fleece hoodie cut from 450gsm cotton. Made in small runs and shipped in 3 days.', urlHandle: 'heavyweight-hoodie', noIndex: false, socialImageUrl: null },
  resolved: { title: 'Heavyweight Hoodie – Nova Studio', description: '', handle: 'heavyweight-hoodie', noIndex: false, image: null },
  suggestedHandle: 'heavyweight-hoodie', storeName: 'Nova Studio', limits: { title: 70, description: 160, handle: 80 },
};

async function installFakeApi(context, origin) {
  await context.route((u) => u.origin === API && /^\/api\/(v1\/)?product-(bulk|seo)\//.test(u.pathname), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin !== API) return route.fallback();
    const cors = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const p = url.pathname;
    const pp = p.replace('/api/v1/', '/api/');
    if (pp === '/api/product-bulk/products') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const st = url.searchParams.get('status');
      const items = catalog.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!st || c.status === st));
      return json({ total: items.length, items });
    }
    if (pp === '/api/product-bulk/price') {
      const b = req.postDataJSON();
      const items = b.productIds.map((id) => {
        const c = catalog.find((x) => x.id === id);
        const before = [c.minPriceCents, c.maxPriceCents];
        const after = before.map((v) => newPrice(v, b.change, b.rounding ?? 'none'));
        return {
          productId: id, name: c.name, status: c.status, image: null, skipped: null, changed: true,
          beforeMin: before[0], beforeMax: before[1], afterMin: after[0], afterMax: after[1],
          variants: Array.from({ length: c.variantCount }, (_, i) => ({ variantId: `${id}-${i}`, sku: `S${i}`, before: before[0], after: after[0] })),
        };
      });
      return json({
        preview: b.preview === true,
        summary: { products: items.length, changedProducts: items.length, skippedProducts: 0, variants: items.reduce((n, i) => n + i.variants.length, 0) },
        items,
      });
    }
    if (pp.startsWith('/api/product-seo/')) return json(seoDetail);
    return route.fallback();
  });
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const go = (page, target) => page.evaluate((url) => {
    history.pushState(history.state, '', url);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, target);
  const shot = async (page, name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log(`  ok ${name}`); await reportTextFit(page, name, { strict: false }); };
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    page.on('request', (r) => { if (r.url().includes('product-')) console.log('  req', r.method(), r.url()); });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await installFakeApi(context, origin);
    await openScreen(page, activity, origin, 'seller', '/products-bulk-edit');
    await page.waitForTimeout(7000);
    await go(page, '/products-bulk-edit?bt_preview=seller');
    await page.waitForTimeout(2500);
    await shot(page, '01-bulk-list-empty-selection');
    await page.getByText('Heavyweight Hoodie').first().click();
    await page.getByText('Boxy Tee').first().click();
    await page.getByText('Canvas Tote').first().click();
    await shot(page, '02-bulk-list-selected');
    await page.screenshot({ path: path.join(OUT, '02b-zoom-action-bar.png'), clip: { x: 0, y: 640, width: 393, height: 120 } });
    await page.screenshot({ path: path.join(OUT, '02c-zoom-status-chips.png'), clip: { x: 0, y: 110, width: 393, height: 120 } });
    await page.getByRole('button', { name: 'Edit prices' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('textbox', { name: 'Amount' }).fill('15');
    await page.getByText('Ends in .99').click();
    await page.waitForTimeout(1200);
    await shot(page, '03-price-sheet-preview');
    await page.screenshot({ path: path.join(OUT, '03b-zoom-price-controls.png'), clip: { x: 0, y: 130, width: 393, height: 330 } });
    await page.getByText('Apply to 3 products').click();
    await page.waitForTimeout(1200);
    await shot(page, '04-price-result');
    await page.getByText('Done', { exact: true }).click();
    for (let i = 0; i < 5; i += 1) {
      await go(page, '/product-seo?productId=' + catalog[0].id + '&bt_preview=seller');
      await page.waitForTimeout(2500);
      if (await page.getByText('Page title').first().isVisible().catch(() => false)) break;
    }
    await shot(page, '05-product-seo');
    await page.screenshot({ path: path.join(OUT, '05b-zoom-header-preview.png'), clip: { x: 0, y: 50, width: 393, height: 290 } });
    await page.mouse.move(200, 400);
    await page.mouse.wheel(0, 900);
    await shot(page, '06-product-seo-scrolled');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
