#!/usr/bin/env node
/**
 * PDP sizes — "Notify me" on sold-out sizes (Zalando stock reminder) and the
 * saved size auto-select. Signed-in demo buyer, fake API via context.route
 * (test scaffolding only). Product: prod_nl_jacket_rust.
 *
 *   node scripts/pdp-sizes-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Before = the prebuilt dev baseline at /home/user/baseline-web-build.
 * After  = this branch's build at .store-screenshots/web-build.
 * Output: docs/pr-assets/pdp-sizes/<viewport>/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/pdp-sizes');
const BASELINE_DIR = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 393, height: 852 }];
const PRODUCT = 'prod_nl_jacket_rust';
const CHART = {
  columns: ['Chest'], unit: 'cm',
  rows: [{ size: 'S', values: ['88-94'] }, { size: 'M', values: ['94-100'] }, { size: 'L', values: ['100-108'] }, { size: 'XL', values: ['108-116'] }],
};
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const json = (origin, body, status = 200) => ({
  status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

/** soldOutM: size M has no stock. prefs: saved sizes (null = none). */
async function setup(browser, images, origin, viewport, { soldOutM, prefs, chart }) {
  const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
  const productFor = (id) => ({
    ...base,
    id,
    sizeChart: chart,
    variants: base.variants.map((v) => ({
      ...v, id: `${id}_${v.size.toLowerCase()}`, productId: id,
      ...(soldOutM && v.size === 'M' ? { stock: 0, inventoryQuantity: 0, available: false } : {}),
    })),
  });
  // Any product detail (the PDP, and whichever feed card opens the sheet) is the jacket.
  await context.route((url) => /\/public\/products\/[^/]+$/.test(url.pathname), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill(json(origin, productFor(id)));
  });
  // Immersive feed (DiscoverPager): one card, the jacket, so Add to cart opens its size sheet.
  await context.route((url) => url.pathname.endsWith('/public/discover/feed'), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill(json(origin, {
      items: [{
        rank: 1, productId: PRODUCT, brandId: 'northline', brandName: base.sellerDisplayName, brandVerified: true,
        productName: base.name, priceCents: base.priceCents, compareAtPriceCents: null, images: base.images,
        category: base.category, sellerScore: 1,
      }],
      nextOffset: null,
    }));
  });
  await context.route((url) => url.pathname.endsWith('/buyer/preferences'), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill(json(origin, { sizes: prefs?.sizes ?? {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null }));
  });
  const joined = new Set();
  await context.route((url) => url.pathname.includes('/waitlist/'), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const url = new URL(req.url());
    if (url.pathname.includes('/waitlist/check/')) return route.fulfill(json(origin, { joined: joined.has(decodeURIComponent(url.pathname.split('/').pop())) }));
    if (url.pathname.endsWith('/waitlist/join')) { joined.add(JSON.parse(req.postData() || '{}').variantId); return route.fulfill(json(origin, { joined: true })); }
    if (url.pathname.endsWith('/waitlist/leave')) { joined.delete(url.searchParams.get('variantId')); return route.fulfill(json(origin, { left: true })); }
    return route.fallback();
  });
  return { context, page, activity };
}

async function openPdp(page, activity, origin) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
    try { await page.getByTestId('option-opt_size-size_M').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
}

async function centre(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), selector);
  await page.waitForTimeout(400);
}

async function shoot(page, dir, name) {
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log('  saved', path.relative(path.resolve(MOBILE_ROOT, '../..'), file));
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const after = label === 'after';
  try {
    for (const viewport of VIEWPORTS) {
      const dir = path.join(OUT, `${viewport.width}x${viewport.height}`);
      mkdirSync(dir, { recursive: true });
      console.log(`${label} @ ${viewport.width}x${viewport.height}`);

      // 1. Sold-out size M tapped (+ Notify me on after).
      {
        const { context, page, activity } = await setup(browser, images, server.origin, viewport, { soldOutM: true, prefs: null, chart: null });
        await openPdp(page, activity, server.origin);
        await centre(page, '[data-testid="option-opt_size-size_M"]');
        // Dev disables the sold-out chip, so the before tap is forced (and ignored by the app).
        await page.getByTestId('option-opt_size-size_M').first().click({ force: !after });
        await page.waitForTimeout(700);
        await centre(page, after ? '[data-testid="product-notify-me"]' : '[data-testid="option-opt_size-size_M"]');
        await shoot(page, dir, `${label}-01-soldout-size-tapped`);
        if (after) {
          // 2. Notify me -> "Reminder set" toast + joined state.
          await page.getByTestId('product-notify-me').first().click();
          await page.waitForTimeout(700);
          await shoot(page, dir, `${label}-02-reminder-set`);
          // 3. Tap again -> "Reminder removed".
          await page.waitForTimeout(2600);
          await page.getByTestId('product-notify-me').first().click();
          await page.waitForTimeout(700);
          await shoot(page, dir, `${label}-03-reminder-removed`);
        }
        await context.close();
      }

      // 4. Buy-now size sheet from the feed (Add to cart on a card).
      {
        const { context, page, activity } = await setup(browser, images, server.origin, viewport, { soldOutM: true, prefs: null, chart: null });
        for (let attempt = 0; ; attempt++) {
          await openScreen(page, activity, server.origin, 'buyer', '/discover-feed');
          try { await page.getByRole('button', { name: 'Add to cart', exact: true }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
        }
        await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
        await page.getByRole('button', { name: 'Add to cart', exact: true }).filter({ visible: true }).first().click();
        await page.getByTestId('variant-chip-size_M').first().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(900);
        await shoot(page, dir, `${label}-04-size-sheet`);
        if (after) {
          await page.getByTestId('variant-chip-size_M').first().click();
          await page.waitForTimeout(700);
          await shoot(page, dir, `${label}-05-size-sheet-reminder-set`);
        }
        await context.close();
      }

      // 6. Saved size: badge "Your size: M" (+ M preselected on after).
      {
        const { context, page, activity } = await setup(browser, images, server.origin, viewport, { soldOutM: false, prefs: { sizes: { outerwear: 'M' } }, chart: CHART });
        await openPdp(page, activity, server.origin);
        await page.waitForTimeout(600);
        await centre(page, '[data-testid="size-recommendation"]');
        await shoot(page, dir, `${label}-06-saved-size`);
        const selected = await page.getByTestId('option-opt_size-size_M').first().getAttribute('aria-checked');
        console.log('  M aria-checked:', selected);
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error('Baseline build missing');
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
