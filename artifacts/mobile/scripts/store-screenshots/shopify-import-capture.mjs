#!/usr/bin/env node
/**
 * Import from Shopify, hands-on at 390x844 with a brand-new demo seller:
 *
 *   00  Shopify app not configured yet → honest "almost ready" (no fake connect)
 *   01  dashboard setup card → "Import from Shopify" opens /shopify-import
 *   02  enter the store name → 03 Shopify consent (MOCKED page, see below)
 *   04  callback page → 05 live progress "23 of 61 products" → 06 done
 *   07  Products list with the imported photos → 08 one product's sizes and stock
 *
 * The Brandthread API is the harness's fake (demo-data.mjs) plus a stateful
 * Shopify fake below: `connect/start` hands back a myshopify.com authorize
 * URL, and that host is routed to a local MOCK of Shopify's consent screen
 * (clearly labelled as a mock in the page) whose Install button hits the fake
 * OAuth callback. The real OAuth/import server code is covered by
 * api-server/src/routes/__tests__/shopify-catalog-import.integration.test.ts.
 *
 *   node scripts/store-screenshots/shopify-import-capture.mjs <web-build-dir> <out-dir>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { IMAGE_HOST, SELLER_USER } from './demo-data.mjs';

const [buildDir, outDir] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: shopify-import-capture.mjs <web-build-dir> <out-dir>');
mkdirSync(outDir, { recursive: true });

const device = { viewport: { width: 390, height: 844 }, scale: 3, isMobile: true, userAgent: undefined };
const DEMO_API = 'https://api.brandthread.test';
const SHOP = 'northline-studio.myshopify.com';
const img = (n) => `${IMAGE_HOST}/demo/${n}.jpg`;

// ─── Seeded Shopify catalog: 61 products, each with Size × Color variants ───
const LINES = [
  ['Heavyweight Hoodie', 'Hoodie', 9800, ['hoodie-ember', 'hoodie-graphite', 'hoodie-moss', 'hoodie-midnight', 'hoodie-bone'], ['Ember', 'Graphite', 'Moss', 'Midnight', 'Bone'], ['S', 'M', 'L', 'XL']],
  ['Field Shell Jacket', 'Jacket', 22000, ['jacket-rust', 'jacket-onyx'], ['Rust', 'Onyx'], ['S', 'M', 'L', 'XL']],
  ['Utility Cargo Pant', 'Pants', 12800, ['cargo-rust'], ['Rust'], ['28', '30', '32', '34']],
  ['Trail Runner', 'Footwear', 14500, ['runner-rust', 'runner-stone'], ['Rust', 'Stone'], ['8', '9', '10', '11']],
];
// Rows in the shapes the real API returns for what the importer wrote
// (products + product_variants with size/color/price/stock, photos as stored copies).
const CATALOG = Array.from({ length: 61 }, (_, i) => {
  const [base, category, priceCents, images, colors, sizes] = LINES[i % LINES.length];
  const k = Math.floor(i / LINES.length) % images.length;
  const color = colors[k];
  const id = `00000000-0000-4000-8000-${String(7100 + i).padStart(12, '0')}`;
  const drop = Math.floor(i / (LINES.length * images.length)) + 1;
  const createdAt = new Date(Date.parse('2026-09-18T23:00:00Z') - i * 60_000).toISOString();
  return {
    id, ownerId: SELLER_USER.id, name: `${base} — ${color}${drop > 1 ? ` (Drop ${drop})` : ''}`,
    description: `${base} in ${color.toLowerCase()}. Heavyweight, made to be worn often.`,
    category: category.toLowerCase(), status: 'draft',
    images: [img(images[k]), img(images[(k + 1) % images.length])],
    tags: ['northline', ...sizes.map((s) => `option:${s}`), `option:${color}`],
    createdAt, updatedAt: createdAt,
    variants: sizes.map((size, v) => ({
      id: `${id.slice(0, -2)}${String(v).padStart(2, '0')}`, productId: id, size, color,
      sku: `NL-${7100 + i}-${size}`, priceCents, stock: (i * 7 + v * 5) % 23, lowStockThreshold: 5,
      createdAt, updatedAt: createdAt,
    })),
  };
});
const listRow = (p) => ({
  id: p.id, name: p.name, category: p.category, status: p.status, images: p.images, tags: p.tags,
  createdAt: p.createdAt, updatedAt: p.updatedAt, variantCount: p.variants.length,
  totalStock: p.variants.reduce((n, v) => n + v.stock, 0),
  lowStockCount: p.variants.filter((v) => v.stock <= v.lowStockThreshold).length,
  priceCents: Math.min(...p.variants.map((v) => v.priceCents)), minPriceCents: Math.min(...p.variants.map((v) => v.priceCents)),
});

// The real callback page (api-server/src/routes/shopify-oauth-callback.ts → resultPage).
const CALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brandthread</title></head>
<body style="margin:0;background:#fff;color:#0a0a0a;font-family:Inter,-apple-system,system-ui,sans-serif;text-align:center;padding:80px 24px;">
<h2 style="font-weight:700;margin:0 0 12px;">Shopify connected</h2>
<p style="color:#6b6b6b;line-height:1.5;margin:0 0 28px;">${SHOP} is connected. Head back to Brandthread to import your products.</p>
<a href="brandthread://shopify-import?shopify=connected" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:600;padding:14px 24px;border-radius:999px;">Return to Brandthread</a>
</body></html>`;

const CONSENT_MOCK_HTML = (callbackUrl, scope) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Install app</title></head>
<body style="margin:0;background:#f1f1f1;font-family:-apple-system,system-ui,sans-serif;color:#303030;">
<div style="background:#1a1a1a;color:#fff;padding:14px 16px;font-weight:600;">${SHOP}</div>
<div style="margin:16px;background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 0 rgba(0,0,0,.08);">
  <div style="font-size:20px;font-weight:700;margin-bottom:6px;">Install Brandthread</div>
  <div style="font-size:14px;color:#616161;margin-bottom:18px;">Brandthread will be able to:</div>
  <div style="font-size:14px;font-weight:600;margin-bottom:4px;">View products</div>
  <div style="font-size:13px;color:#616161;margin-bottom:12px;">Products, variants, photos and collections</div>
  <div style="font-size:14px;font-weight:600;margin-bottom:4px;">View inventory</div>
  <div style="font-size:13px;color:#616161;margin-bottom:22px;">Stock levels for each variant</div>
  <div style="font-size:12px;color:#8a8a8a;margin-bottom:18px;">Requested scopes: ${scope}</div>
  <a id="install" href="${callbackUrl}" style="display:block;text-align:center;background:#303030;color:#fff;text-decoration:none;font-weight:600;padding:12px;border-radius:8px;">Install</a>
</div>
<div style="margin:0 16px;font-size:11px;color:#8a8a8a;text-align:center;">Screenshot harness mock of Shopify's OAuth consent screen — not the real Shopify page.</div>
</body></html>`;

async function fakeShopify(context, appOrigin, { configured }) {
  const state = { configured, connected: false, job: null, polls: 0, imported: false };
  const progress = [0, 9, 23, 41, 61];
  const cors = {
    'access-control-allow-origin': appOrigin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await context.route(/api\.brandthread\.test\/api(\/v1)?\/(shopify|products|product-variants)(\/|\?|$)/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api(\/v1)?/, '');
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (p === '/shopify/status') return json({ configured: state.configured, connected: state.connected, shopDomain: state.connected ? SHOP : null, fulfillmentEnabled: false, linkedProductsCount: state.imported ? CATALOG.length : 0 });
    if (p === '/shopify/catalog-import/latest') return json(state.job);
    if (p === '/shopify/connect/start') {
      if (!state.configured) return json({ error: 'not_configured', message: 'Shopify import is almost ready — Brandthread\'s Shopify app is still being set up.' }, 503);
      const authorize = new URL(`https://${SHOP}/admin/oauth/authorize`);
      authorize.searchParams.set('client_id', 'demo-client-id');
      authorize.searchParams.set('scope', 'read_products,read_inventory');
      authorize.searchParams.set('redirect_uri', `${DEMO_API}/api/shopify/oauth/callback`);
      authorize.searchParams.set('state', 'demo-state');
      return json({ authorizeUrl: authorize.toString() });
    }
    if (p === '/shopify/oauth/callback') {
      state.connected = true;
      return route.fulfill({ status: 200, contentType: 'text/html', body: CALLBACK_HTML });
    }
    const job = (processed, status = 'running') => ({
      id: 'job-demo-1', shopDomain: SHOP, status, totalCount: 61, processedCount: processed,
      importedCount: processed, updatedCount: 0, skippedCount: 0, skipped: [], imagesStored: processed * 2, imagesLinked: 0,
      errorMessage: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), finishedAt: status === 'running' ? null : new Date().toISOString(),
    });
    if (p === '/shopify/catalog-import' && req.method() === 'POST') {
      state.job = job(0);
      return json(state.job, 202);
    }
    if (p === '/shopify/catalog-import/job-demo-1') {
      state.polls = Math.min(state.polls + 1, progress.length - 1);
      const processed = progress[state.polls];
      state.job = job(processed, processed === 61 ? 'complete' : 'running');
      if (processed === 61) state.imported = true;
      return json(state.job);
    }
    if (p === '/products') return json(state.imported ? CATALOG.map(listRow) : []);
    const m = p.match(/^\/products\/([^/]+)$/);
    if (m && state.imported) return json(CATALOG.find((x) => x.id === m[1]) ?? null);
    // GET /api/product-variants/:id — the shape routes/product-variants.ts returns for an import
    // (variant size/color columns + the Size/Color axes the importer writes).
    const v = p.match(/^\/product-variants\/([^/]+)$/);
    if (v && state.imported) {
      const product = CATALOG.find((x) => x.id === v[1]);
      if (!product) return json({ error: 'Product not found' }, 404);
      const sizes = [...new Set(product.variants.map((x) => x.size))];
      const colors = [...new Set(product.variants.map((x) => x.color))];
      return json({
        product: { id: product.id, name: product.name },
        axes: [{ name: 'Size', values: sizes }, { name: 'Color', values: colors }],
        variants: product.variants.map((x) => ({
          id: x.id, sku: x.sku, size: x.size, color: x.color, priceCents: x.priceCents, stock: x.stock, lowStockThreshold: x.lowStockThreshold, options: {},
        })),
        stockRules: { lowStockThresholdDefault: null, soldOutBehavior: 'show', limitedQuantityEnabled: false, limitedQuantityTotal: null, showRemainingCounter: false, counterThreshold: null },
        maxVariants: 100,
      });
    }
    return route.fallback();
  });
  await context.route(`https://${SHOP}/**`, (route) => {
    const u = new URL(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: CONSENT_MOCK_HTML(u.searchParams.get('redirect_uri') + '?code=demo&shop=' + SHOP + '&state=demo-state', u.searchParams.get('scope')) });
  });
  return state;
}

// PLAYWRIGHT_CHROMIUM=/path/to/chrome when the project's Playwright has no browser download of its own.
const browser = process.env.PLAYWRIGHT_CHROMIUM
  ? await (await import('playwright')).chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM })
  : await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
const shot = async (page, name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(`  ✓ ${name}`); };
const unseeded = new Set();
try {
  // ── 00: server without the Shopify app credentials ──────────────────────
  {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images, apiOptions: { fresh: true, emptyProducts: true } });
    await fakeShopify(context, origin, { configured: false });
    await context.addInitScript(() => localStorage.removeItem('user_role'));
    await page.goto(`${origin}/shopify-import`);
    await page.getByTestId('shopify-import-unavailable').waitFor({ timeout: 20_000 });
    await waitForQuietNetwork(activity, 500, 8_000).catch(() => {});
    await shot(page, '00-not-configured-almost-ready');
    await context.close();
  }

  // ── 01–08: configured, full flow ─────────────────────────────────────────
  const { context, page, activity } = await openContext(browser, {
    device, role: 'seller', origin, images, apiOptions: { fresh: true, emptyProducts: true }, seedOptions: { fresh: true },
    onUnseeded: (r) => unseeded.add(r),
  });
  const shopify = await fakeShopify(context, origin, { configured: true });
  await page.goto(`${origin}/(tabs)/`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 500, 10_000).catch(() => {});
  // A brand-new seller gets the "Set up your store" sheet first; close it like a seller would.
  const later = page.getByText('Continue setup later');
  if (await later.waitFor({ timeout: 15_000 }).then(() => true, () => false)) { await later.click(); await later.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {}); }
  const card = page.getByTestId('seller-dashboard-setup-card');
  await card.waitFor({ timeout: 15_000 });
  await card.scrollIntoViewIfNeeded();
  await shot(page, '01-dashboard-import-from-shopify');
  await page.getByTestId('seller-dashboard-setup-import').click();
  await page.waitForURL(/\/shopify-import/, { timeout: 10_000 });
  console.log(`  ✓ dashboard button opened ${new URL(page.url()).pathname}`);

  // The preview build treats a stored seller role as the signed-out preview
  // (POSTs refused); the import needs the signed-in stub, as quick-import does.
  await context.addInitScript(() => localStorage.removeItem('user_role'));
  await page.goto(`${origin}/shopify-import`);
  await page.getByTestId('shopify-import-store').waitFor({ timeout: 20_000 });
  await page.getByTestId('shopify-import-store').fill('northline-studio');
  await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
  await shot(page, '02-enter-store');

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('shopify-import-continue').click();
  const popup = await popupPromise;
  await popup.setViewportSize(device.viewport);
  await popup.waitForSelector('#install', { timeout: 15_000 });
  await page.getByTestId('shopify-import-consent').waitFor({ timeout: 10_000 });
  await shot(page, '03a-app-waiting-for-consent');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(outDir, '03b-shopify-consent-MOCK.png') });
  console.log('  ✓ 03b-shopify-consent-MOCK');
  await popup.click('#install');
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(300);
  await popup.screenshot({ path: path.join(outDir, '04-oauth-callback.png') });
  console.log('  ✓ 04-oauth-callback');
  await popup.close();

  await page.getByText('23 of 61 products').waitFor({ timeout: 20_000 });
  await shot(page, '05-progress-23-of-61');
  await page.getByTestId('shopify-import-done').waitFor({ timeout: 20_000 });
  await shot(page, '06-done');
  if (!shopify.imported) throw new Error('import did not complete');

  await page.getByTestId('shopify-import-view-products').click();
  await page.waitForURL(/products/, { timeout: 10_000 });
  await page.getByText(CATALOG[0].name).first().waitFor({ timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForQuietNetwork(activity, 600, 8_000).catch(() => {});
  await shot(page, '07-products-list');

  await page.goto(`${origin}/product-variants?productId=${CATALOG[0].id}`);
  await waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await shot(page, '08a-sizes-and-colors');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(0, 900);
  await shot(page, '08b-stock-per-variant');
  await page.goto(`${origin}/product-detail?id=${CATALOG[0].id}`);
  await waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  await shot(page, '09-product-detail');
  await context.close();
} finally {
  if (unseeded.size) console.log('  unseeded:', [...unseeded].join(', '));
  await browser.close();
  close();
}
