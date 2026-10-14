#!/usr/bin/env node
/**
 * One-tap import at 393x852 with a brand-new demo seller (fake API):
 * dashboard card → paste link → Shopify-style picker → drafts added.
 * --before: the same new-seller dashboard and the existing Import products screen.
 *
 *   node scripts/store-screenshots/quick-import-capture.mjs <web-build-dir> <out-dir> [--before]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { IMAGE_HOST } from './demo-data.mjs';

const [buildDir, outDir, flag] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: quick-import-capture.mjs <web-build-dir> <out-dir> [--before]');
mkdirSync(outDir, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 3, isMobile: true, userAgent: undefined };
const img = (n) => `${IMAGE_HOST}/demo/${n}.jpg`;
const ITEMS = [
  ['Heavyweight Hoodie — Ember', 'hoodie-ember', 9800, 4],
  ['Heavyweight Hoodie — Graphite', 'hoodie-graphite', 9800, 4],
  ['Heavyweight Hoodie — Moss', 'hoodie-moss', 9800, 4],
  ['Heavyweight Hoodie — Midnight', 'hoodie-midnight', 9800, 4],
  ['Heavyweight Hoodie — Bone', 'hoodie-bone', 9800, 4],
  ['Field Shell Jacket — Rust', 'jacket-rust', 22000, 3],
  ['Field Shell Jacket — Onyx', 'jacket-onyx', 22000, 3],
  ['Utility Cargo Pant — Rust', 'cargo-rust', 12800, 5],
  ['Trail Runner — Rust', 'runner-rust', 14500, 6],
  ['Trail Runner — Stone', 'runner-stone', 14500, 6],
].map(([name, image, priceFromCents, variantCount], i) => ({ key: `shopify:northline.example.com:${1000 + i}`, name, image: img(image), priceFromCents, variantCount }));

async function fakeImportApi(context, appOrigin) {
  await context.route(/api\.brandthread\.test\/api(\/v1)?\/product-import\//, async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/api(\/v1)?/, '');
    const cors = {
      'access-control-allow-origin': appOrigin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (p === '/product-import/providers') return json({ csv: true, shopify: { publicUrl: true, oauth: false, connected: false, shopDomain: null }, etsy: { enabled: false, connected: false }, instagram: { enabled: false, connected: false, username: null } });
    if (p === '/product-import/runs') return json({ runs: [] });
    if (p === '/product-import/shopify-url/preview') return json({ layout: 'shopify', layoutLabel: 'Northline Studio', source: 'shopify_url', rowCount: ITEMS.length, counts: {}, capacity: {}, issues: [], issuesTruncated: false, sample: [], ignoredColumns: [], notes: [], items: ITEMS });
    if (p === '/product-import/shopify-url/commit') {
      const keys = JSON.parse(route.request().postData() || '{}').keys ?? [];
      return json({ runId: 'r1', source: 'shopify_url', counts: { created: keys.length, updated: 0, unchanged: 0, failed: 0, skipped: 0, invalid: 0 }, planLimitReached: false, results: [], issues: [] });
    }
    return route.fallback();
  });
}

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
const shot = async (page, name) => { await page.waitForTimeout(700); await page.screenshot({ path: path.join(outDir, `${name}.png`) }); console.log(`  ✓ ${name}`); };
try {
  const { context, page, activity } = await openContext(browser, {
    device, role: 'seller', origin, images, apiOptions: { fresh: true, emptyProducts: true },
  });
  await fakeImportApi(context, origin);
  await page.goto(`${origin}/(tabs)/`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 500, 10_000).catch(() => {});
  const card = page.getByTestId('seller-dashboard-setup-card');
  await card.waitFor({ timeout: 10_000 }).catch(() => {});
  if (await card.count()) await card.scrollIntoViewIfNeeded();
  await shot(page, '01-dashboard-new-seller');
  if (flag === '--before') {
    await page.goto(`${origin}/product-import`);
    await waitForQuietNetwork(activity, 500, 8_000).catch(() => {});
    await shot(page, '02-product-import');
  } else {
    // The screenshot build treats a stored seller role as the signed-out seller
    // preview, which refuses POSTs; this screen only needs the signed-in stub.
    await context.addInitScript(() => localStorage.removeItem('user_role'));
    await page.goto(`${origin}/quick-import`);
    await page.getByTestId('quick-import-url').fill('northlinestudio.com');
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    await shot(page, '02-paste-link');
    await page.getByTestId('quick-import-find').click();
    await page.getByTestId('quick-import-picker').waitFor({ timeout: 10_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(outDir, 'debug.png') });
      throw e;
    });
    await page.getByLabel('Field Shell Jacket — Onyx').click();
    await page.waitForTimeout(400);
    await waitForQuietNetwork(activity, 300, 5_000).catch(() => {});
    await shot(page, '03-picker');
    await page.getByTestId('quick-import-commit').click();
    await page.getByTestId('quick-import-done').waitFor({ timeout: 10_000 });
    await shot(page, '04-drafts-added');
  }
  await context.close();
} finally {
  await browser.close();
  close();
}
