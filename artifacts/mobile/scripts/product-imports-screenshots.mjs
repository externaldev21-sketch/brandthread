#!/usr/bin/env node
/**
 * 393x852 screenshots for the product imports PR. Drives the preview web export
 * as the demo seller. The /api/product-import/* responses come from the real
 * server's shapes (see FIXTURE below), injected for this run only.
 *
 *   node scripts/product-imports-screenshots.mjs [--skip-build] [--prefix=after|before] [--etsy]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { reportTextFit } from './lib/textFitCheck.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/product-imports');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const prefix = (process.argv.find((a) => a.startsWith('--prefix=')) ?? '--prefix=after').split('=')[1];
const etsyOn = process.argv.includes('--etsy');
const shopifyCsv = readFileSync(path.resolve(MOBILE_ROOT, '../api-server/src/lib/productImport/__tests__/fixtures/shopify_export.csv'), 'utf8');

const FIXTURE = {
  providers: { csv: true, shopify: { publicUrl: true, oauth: false, connected: false, shopDomain: null },
    etsy: etsyOn ? { enabled: true, connected: true, shopName: 'Scarf Shop' } : { enabled: false, connected: false, reason: "Etsy import isn't enabled on this server." } },
  runs: { runs: [{ id: 'r1', source: 'shopify_csv', filename: 'products_export_1.csv', createdAt: '2026-09-17T10:00:00Z', created: 3, updated: 0, unchanged: 0, failed: 1, skipped: 0 }] },
  preview: {
    layout: 'shopify', layoutLabel: 'Shopify export', source: 'shopify_csv', delimiter: ',', rowCount: 6,
    counts: { products: 3, variants: 5, create: 3, update: 0, unchanged: 0, errors: 1, warnings: 2 },
    capacity: { limit: 10, used: 4, remaining: 6, newProducts: 3, wouldExceed: false },
    issues: [
      { severity: 'error', line: 7, product: 'Mystery Item', field: 'Variant Price', message: 'Price "abc" is not a valid amount; variant skipped.' },
      { severity: 'warning', line: 5, product: 'Sock Set', field: 'Variant Inventory Qty', message: 'Quantity -3 is negative; set to 0.' },
      { severity: 'warning', line: 2, product: 'Boxy Tee', field: 'sku', message: 'SKU BOXY-S-BLK is already used by another product; it will be saved with a short suffix.' },
    ],
    issuesTruncated: false,
    sample: [
      { name: 'Boxy Tee', category: 'tops', imageCount: 2, firstImage: null, action: 'create', variantCount: 3, priceFromCents: 4800 },
      { name: 'Cargo Pant', category: 'bottoms', imageCount: 1, firstImage: null, action: 'create', variantCount: 1, priceFromCents: 112050 },
      { name: 'Sock Set', category: 'accessories', imageCount: 0, firstImage: null, action: 'create', variantCount: 1, priceFromCents: 1800 },
    ],
    ignoredColumns: ['Variant Barcode'],
    notes: ["Compare-at prices aren't imported.", 'Products are imported as drafts. Publish when ready.'],
  },
  commit: {
    runId: 'r2', source: 'shopify_csv', planLimitReached: false,
    counts: { created: 3, updated: 0, unchanged: 0, failed: 0, skipped: 0, invalid: 1 },
    results: [{ name: 'Boxy Tee', action: 'created', notes: ['SKU BOXY-S-BLK is already used by another product; saved as BOXY-S-BLK-3F9A2C.'] }],
    issues: [{ severity: 'error', line: 7, product: 'Mystery Item', field: 'Variant Price', message: 'Price "abc" is not a valid amount; variant skipped.' }],
  },
};

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${prefix}-${name}.png`) });
  await reportTextFit(page, `${prefix}-${name}`, { strict: false });
  console.log(`  ok ${prefix}-${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' };
    await context.route('https://api.brandthread.test/**/product-import/**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const p = new URL(req.url()).pathname;
      const body = p.endsWith('/providers') ? FIXTURE.providers : p.endsWith('/runs') ? FIXTURE.runs
        : p.endsWith('/preview') ? FIXTURE.preview : p.endsWith('/commit') ? FIXTURE.commit : {};
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await openScreen(page, activity, origin, 'seller', '/product-import');
    await page.waitForTimeout(6000);
    // The app remounts its navigation tree once after the stubbed auth settles; retry until the screen is up.
    for (let i = 0; i < 6; i += 1) {
      if (await page.getByText('Import Products').first().isVisible().catch(() => false)) break;
      await page.evaluate(() => {
        history.pushState(history.state, '', '/product-import?bt_preview=seller');
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      });
      await page.waitForTimeout(2500);
    }
    await shot(page, '01-chooser');
    if (prefix === 'before') { await context.close(); return; }
    await page.getByText('CSV File').first().click();
    await page.waitForTimeout(800);
    await shot(page, '02-csv-expanded');
    const first = await page.getByText('Choose CSV file').first().boundingBox();
    const last = await page.getByText('Download template').first().boundingBox();
    if (first && last) {
      await page.screenshot({ path: path.join(OUT, `${prefix}-02z-csv-buttons-zoom.png`), clip: { x: 0, y: first.y - 24, width: 393, height: last.y - first.y + last.height + 48 } });
    }
    await page.getByText('Paste CSV', { exact: true }).first().click();
    await page.waitForTimeout(800);
    await page.locator('textarea').first().fill(shopifyCsv);
    await shot(page, '03-paste');
    await page.getByText('Review import', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    await shot(page, '04-preview');
    await page.getByText(/^Import 3 products/).first().click();
    await page.waitForTimeout(1500);
    await shot(page, '05-result');
    await context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
