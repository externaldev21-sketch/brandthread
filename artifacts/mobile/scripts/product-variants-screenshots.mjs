#!/usr/bin/env node
/**
 * 393x852 screenshots for the variants & stock PR. Runs the preview web build
 * with a signed-in demo seller/buyer; the variants + stock-info endpoints are
 * answered by the fixtures in this file (screenshot fixtures only, never app code).
 *
 *   node scripts/product-variants-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { reportTextFit } from './lib/textFitCheck.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/product-variants-stock');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEMO_API = 'https://api.brandthread.test';

const RULES = {
  lowStockThresholdDefault: 5, soldOutBehavior: 'hide', limitedQuantityEnabled: true, limitedQuantityTotal: 50,
  showRemainingCounter: true, counterThreshold: 5,
};
function variants() {
  const out = [];
  let n = 0;
  for (const size of ['S', 'M', 'L']) for (const color of ['Black', 'Bone']) for (const fit of ['Slim', 'Regular']) {
    n += 1;
    out.push({
      id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, sku: `TEE-${size}-${color.slice(0, 3).toUpperCase()}-${fit.slice(0, 3).toUpperCase()}`,
      size, color, options: { Fit: fit }, priceCents: 4800, stock: [14, 9, 0, 3, 22, 6, 11, 2, 8, 0, 17, 5][n - 1], lowStockThreshold: 5,
    });
  }
  return out;
}
const AXES = [
  { name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Colour', values: ['Black', 'Bone'] }, { name: 'Fit', values: ['Slim', 'Regular'] },
];

async function fixtures(context, origin, stockInfo) {
  await context.route((url) => url.origin === DEMO_API && /\/api(\/v1)?\/(product-variants|catalog-public)\//.test(url.pathname), (route) => {
    const req = route.request();
    const headers = {
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const { pathname } = new URL(req.url());
    let body = {};
    if (pathname.includes('/catalog-public/')) body = stockInfo;
    else if (pathname.includes('/empty')) body = { product: { id: 'empty', name: 'Boxy Heavyweight Tee' }, axes: [], variants: [], stockRules: { ...RULES, soldOutBehavior: 'show', limitedQuantityEnabled: false, showRemainingCounter: false, limitedQuantityTotal: null, counterThreshold: null, lowStockThresholdDefault: null } };
    else body = { product: { id: 'p1', name: 'Boxy Heavyweight Tee' }, axes: AXES, variants: variants(), stockRules: RULES, maxVariants: 100 };
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const go = (page, target) => page.evaluate((url) => {
  history.pushState(history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}, target);
async function wheel(page, dy) {
  await page.mouse.move(200, 500);
  await page.mouse.wheel(0, dy);
}

async function shot(page, name, full = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  console.log(`  ok ${name}`);
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };

  async function screen(role, route, info, ready, fn) {
    const { context, page, activity } = await openContext(browser, { device, role, origin, images: {} });
    await fixtures(context, origin, info);
    page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
    await openScreen(page, activity, origin, role, route);
    let found = false;
    for (let attempt = 0; attempt < 3 && !found; attempt++) {
      found = await page.getByText(ready).first().waitFor({ timeout: 9000 }).then(() => true).catch(() => false);
      if (!found) await go(page, `${route}${route.includes('?') ? '&' : '?'}bt_preview=${role}`);
    }
    if (!found) { await page.screenshot({ path: path.join(OUT, 'FAILED.png') }); throw new Error(`never saw "${ready}" on ${route}`); }
    await page.waitForTimeout(800);
    await fn(page);
    await context.close();
  }
  const clip = async (page, name, y, height) => {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y, width: 393, height } });
    console.log(`  ok ${name}`);
  };

  try {
    await screen('seller', '/product-variants?productId=empty', {}, 'No options yet', async (page) => {
      await shot(page, '01-empty'); await reportTextFit(page, '01-empty');
      await page.getByLabel('Add option').click();
      await shot(page, '01b-add-option'); await reportTextFit(page, '01b-add-option');
    });
    await screen('seller', '/product-variants?productId=p1', {}, 'Size (3)', async (page) => {
      await shot(page, '02-options-and-variants'); await reportTextFit(page, '02-options-and-variants');
      await clip(page, 'zoom-option-card', 190, 175);
      await wheel(page, 1150);
      await shot(page, '03-variant-list'); await reportTextFit(page, '03-variant-list');
      await page.getByLabel(/L \/ Black \/ Slim, edit details/).first().click().catch(() => undefined);
      await shot(page, '04-variant-expanded'); await reportTextFit(page, '04-variant-expanded');
      await wheel(page, 4000);
      await shot(page, '05-stock-rules'); await reportTextFit(page, '05-stock-rules');
    });
    for (const [name, readyText, info] of [
      ['06-pdp-limited', 'Limited edition · 12 of 50 left', { soldOut: false, limited: true, editionSize: 50, remaining: 12 }],
      ['07-pdp-only-left', 'Only 3 left', { soldOut: false, limited: false, editionSize: null, remaining: 3 }],
      ['08-pdp-sold-out', 'Sold out', { soldOut: true, limited: false, editionSize: null, remaining: null }],
    ]) {
      await screen('buyer', '/buyer-product-detail?productId=prod_nl_hoodie_ember', info, readyText, async (page) => {
        await shot(page, name);
      });
    }
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
