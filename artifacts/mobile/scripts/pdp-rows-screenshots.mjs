#!/usr/bin/env node
/**
 * Product page bottom rows — "Complete the fit" (automatic same-brand fill)
 * and "Recently viewed" — before (dev baseline build) vs after (this branch).
 * Signed-in demo buyer from the store-screenshots harness; the pairings,
 * related and recently-viewed endpoints are routed to fixed fake responses
 * (test scaffolding only).
 *
 *   node scripts/pdp-rows-screenshots.mjs [--skip-build] [--only before|after]
 *
 * Output: docs/pr-assets/pdp-rows/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';
import { collectTextFitIssues } from './textFitCheck.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/pdp-rows');
const BASELINE_DIR = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 393, height: 852 }];
const PRODUCT = 'prod_nl_hoodie_ember'; // a top from Northline

const byId = (id) => PUBLIC_PRODUCTS.find((p) => p.id === id);
const current = byId(PRODUCT);

// What the server returns for a Northline hoodie with no curated pairings:
// bottoms, outerwear, shoes from the same seller (source 'auto').
function pairing(id, opts = {}) {
  const p = byId(id);
  return {
    id: p.id, sellerId: current.sellerId, sellerName: current.sellerDisplayName, name: p.name,
    image: p.images[0], images: p.images, priceCents: p.priceCents, isPreOrder: false, available: true,
    variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: null, priceCents: v.priceCents, stock: v.stock })),
    source: 'auto', ...opts,
  };
}
const AUTO_PAIRINGS = [
  pairing('prod_nl_cargo_rust'),
  pairing('prod_nl_jacket_rust'),
  pairing('prod_fo_runner_stone'),
];
// History includes the product being viewed; the row must drop it.
const RECENTLY_VIEWED = [PRODUCT, 'prod_qh_hoodie_moss', 'prod_fo_runner_rust', 'prod_ea_jacket_onyx', 'prod_qh_hoodie_midnight']
  .map((id, i) => {
    const p = byId(id);
    return { productId: p.id, name: p.name, brand: p.sellerDisplayName, image: p.images[0], priceCents: p.priceCents, viewedAt: new Date(Date.now() - i * 3600_000).toISOString() };
  });
const RELATED = PUBLIC_PRODUCTS.filter((p) => p.id !== PRODUCT).slice(0, 5);

async function setup(browser, images, origin, viewport, { pairings }) {
  const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const seen = [];
  const handle = (body) => async (route) => {
    const method = route.request().method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push(`${method} ${new URL(route.request().url()).pathname}`);
    if (method === 'POST') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  };
  await context.route((url) => url.pathname.includes('/product-pairings/public/'), handle(pairings));
  await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}/related`), handle(RELATED));
  await context.route((url) => url.pathname.endsWith('/buyer/recently-viewed'), handle(RECENTLY_VIEWED));
  return { context, page, activity, seen };
}

async function capture(browser, images, origin, state, viewport) {
  // Dev's server returns [] when nothing is curated; this branch returns the auto fill.
  const { context, page, activity, seen } = await setup(browser, images, origin, viewport, {
    pairings: state === 'before' ? [] : AUTO_PAIRINGS,
  });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
    try { await page.getByText('Report listing').first().waitFor({ state: 'attached', timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity, 800, 12_000);
  const tag = `${state}-${viewport.width}x${viewport.height}`;
  const shots = [];

  // 1) The product rows, starting at the first bottom row header.
  const first = state === 'after' ? 'Complete the fit' : 'You might also like';
  await page.getByText(first, { exact: false }).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    // Leave a little room above the header.
    const scroller = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50 && getComputedStyle(d).overflowY !== 'visible' && d.scrollTop > 0);
    if (scroller) scroller.scrollTop -= 60;
  });
  await waitForImages(page); await page.waitForTimeout(600);
  shots.push(`${tag}-rows.png`);
  await page.screenshot({ path: path.join(OUT, shots.at(-1)) });

  // 2) Scrolled to the very bottom (report links).
  await page.getByText('Report listing').first().evaluate((el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (n.scrollHeight > n.clientHeight + 50 && getComputedStyle(n).overflowY !== 'visible') { n.scrollTop = n.scrollHeight; return; }
    }
  });
  await waitForImages(page); await page.waitForTimeout(600);
  shots.push(`${tag}-bottom.png`);
  await page.screenshot({ path: path.join(OUT, shots.at(-1)) });

  const issues = await collectTextFitIssues(page);
  const counts = {
    completeTheFit: await page.getByText('Complete the fit', { exact: false }).count(),
    recentlyViewed: await page.getByText('Recently viewed', { exact: false }).count(),
    currentInRecent: await page.locator(`[aria-label^="${current.name},"]`).count(),
  };
  console.log(tag, JSON.stringify({ shots, counts, textFit: issues.length, api: [...new Set(seen)] }));
  await context.close();
  return issues.length;
}

async function run() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  let failures = 0;
  try {
    for (const state of ['before', 'after']) {
      if (only && only !== state) continue;
      const dir = state === 'before' ? BASELINE_DIR : DEFAULT_BUILD_DIR;
      if (state === 'before' && !existsSync(path.join(dir, 'index.html'))) throw new Error(`baseline build missing at ${dir}`);
      if (state === 'after' && (!process.argv.includes('--skip-build') || !existsSync(path.join(dir, 'index.html')))) buildPreviewWeb(dir);
      const server = await serveBuild(dir);
      try {
        for (const vp of VIEWPORTS) failures += await capture(browser, images, server.origin, state, vp);
      } finally {
        server.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(failures === 0 ? 'TEXT-FIT: clean' : `TEXT-FIT: ${failures} issue(s)`);
}

run().catch((error) => { console.error(error); process.exit(1); });
