#!/usr/bin/env node
/**
 * Automatic sales screens at 393x852 on the store-screenshots harness.
 *   node scripts/automatic-sales-screenshots.mjs <outDir> [--skip-build]
 * Seller: More tab row, Sales (empty), create form, list with a sale.
 * Buyer: product detail with the sale price and struck-through original.
 * The fake API (harness) has no /api/sales, so this script answers it with an
 * in-memory list; nothing here is shipped data.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '../../docs/pr-assets/automatic-sales'));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEWPORT = { width: 393, height: 852 };
const API = 'https://api.brandthread.test';
mkdirSync(OUT, { recursive: true });

function cors(origin) {
  return {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}


const fitIssues = [];
/** Flags text clipped by its box (scrollWidth > clientWidth), text/boxes past the viewport edge, and boxes wider than their parent. */
async function checkFit(page, label) {
  const found = await page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    for (const el of document.querySelectorAll('div, span, input')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = (el.innerText || el.value || el.placeholder || '').trim().slice(0, 40);
      const style = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && style.overflowX !== 'auto' && style.overflowX !== 'scroll' && text) out.push(`clipped: "${text}" (${el.scrollWidth}>${el.clientWidth})`);
      if (text && (r.right > vw + 1 || r.left < -1) && style.position !== 'fixed') out.push(`off-screen: "${text}" (${Math.round(r.left)}..${Math.round(r.right)})`);
      if (text && /…$/.test(text)) out.push(`ellipsis: "${text}"`);
      const ps = el.parentElement && getComputedStyle(el.parentElement);
      if (text && el.parentElement && ps.overflowX === 'visible') {
        const pr = el.parentElement.getBoundingClientRect();
        if (pr.width > 0 && r.width > pr.width + 1 && el.children.length === 0) out.push(`wider than parent: "${text}"`);
      }
    }
    return out;
  });
  for (const f of new Set(found)) fitIssues.push(`[${label}] ${f}`);
}

/** Zoomed crop around the union of the named texts' boxes. */
async function zoom(page, file, names, pad = 16) {
  const boxes = [];
  for (const n of names) boxes.push(await page.getByText(n, { exact: true }).first().boundingBox());
  const b = boxes.filter(Boolean);
  const x = Math.max(0, Math.min(...b.map((q) => q.x)) - pad), y = Math.max(0, Math.min(...b.map((q) => q.y)) - pad);
  const w = Math.min(393 - x, Math.max(...b.map((q) => q.x + q.width)) - x + pad), h = Math.max(...b.map((q) => q.y + q.height)) - y + pad;
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: w, height: h } });
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };

    // ── Seller ──
    const seller = await openContext(browser, { device, role: 'seller', origin: server.origin, images });
    const sales = [];
    await seller.page.route(/api\.brandthread\.test\/api\/(v1\/)?sales/, async (route) => {
      const req = route.request();
      const headers = cors(server.origin);
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const url = new URL(req.url());
      if (url.pathname.endsWith('/collections')) return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(['Hoodies', 'Outerwear', 'Footwear']) });
      if (req.method() === 'POST') {
        const b = req.postDataJSON();
        const row = { id: `sale_${sales.length + 1}`, ...b, productIds: b.productIds ?? [], startsAt: b.startsAt ?? new Date().toISOString(), active: true, status: 'live' };
        sales.unshift(row);
        return route.fulfill({ status: 201, headers, contentType: 'application/json', body: JSON.stringify(row) });
      }
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(sales) });
    });
    for (let attempt = 0; ; attempt++) {
      await openScreen(seller.page, seller.activity, server.origin, 'seller', '/(tabs)/more');
      try { await seller.page.getByText('Automatic sale prices').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await checkFit(seller.page, 'more');
    await seller.page.screenshot({ path: path.join(OUT, '01-more-tab-sales-row.png') });
    await zoom(seller.page, '01z-more-discounts-and-sales-rows.png', ['Discounts', 'Automatic sale prices']);

    await seller.page.getByText('Automatic sale prices').first().click();
    await seller.page.getByText('No sales yet').waitFor({ timeout: 15_000 });
    await waitForQuietNetwork(seller.activity);
    await checkFit(seller.page, 'sales-empty');
    await seller.page.screenshot({ path: path.join(OUT, '02-sales-empty.png') });

    await seller.page.getByText('Create sale').first().click();
    await seller.page.getByPlaceholder('Summer sale').waitFor();
    await seller.page.getByPlaceholder('Summer sale').fill('Summer sale');
    await seller.page.getByText('Collection', { exact: true }).click();
    await checkFit(seller.page, 'form');
    await seller.page.screenshot({ path: path.join(OUT, '03-create-sale-form.png') });
    await zoom(seller.page, '03z-value-and-scope-buttons.png', ['Percentage', 'Fixed amount', 'Entire store', 'Products', 'Collection']);
    await seller.page.getByText('Choose a collection').click();
    await seller.page.getByText('Hoodies', { exact: true }).click();
    await seller.page.getByPlaceholder('Start date (YYYY-MM-DD)').fill('2026-09-01');
    await seller.page.getByRole('switch').first().click();
    await seller.page.getByPlaceholder('End date (YYYY-MM-DD)').fill('2026-10-31');
    await checkFit(seller.page, 'form-filled');
    await seller.page.screenshot({ path: path.join(OUT, '04-create-sale-filled.png') });
    await seller.page.getByText('Create sale', { exact: true }).last().click();
    await seller.page.getByText('20% off').first().waitFor({ timeout: 10_000 });
    await seller.page.waitForTimeout(1500);
    await checkFit(seller.page, 'list');
    await seller.page.screenshot({ path: path.join(OUT, '05-sales-list.png') });
    await zoom(seller.page, '05z-sale-card.png', ['Summer sale', 'Live', 'Collection: Hoodies']);
    await seller.context.close();

    // ── Buyer: sale price + strike-through ──
    const buyer = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
    const base = PUBLIC_PRODUCTS[0];
    const sale = {
      ...base,
      variants: base.variants.map((v) => ({
        ...v, priceCents: Math.round(v.priceCents * 0.8), compareAtPriceCents: v.priceCents, saleId: 'sale_1', saleName: 'Summer sale',
      })),
    };
    await buyer.page.route(new RegExp(`api\\.brandthread\\.test/api/(v1/)?public/products/${base.id}$`), async (route) => {
      const headers = cors(server.origin);
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(sale) });
    });
    await openScreen(buyer.page, buyer.activity, server.origin, 'buyer', `/buyer-product-detail?productId=${base.id}`);
    await buyer.page.getByText('$78.40').first().waitFor({ timeout: 20_000 });
    await waitForQuietNetwork(buyer.activity);
    await waitForImages(buyer.page);
    await checkFit(buyer.page, 'buyer-detail');
    await buyer.page.screenshot({ path: path.join(OUT, '06-buyer-product-sale-price.png') });
    await buyer.context.close();
    const report = fitIssues.length ? fitIssues.join('\n') : 'No text-fit issues found on the screens above.';
    writeFileSync(path.join(OUT, 'text-fit-report.txt'), report + '\n');
    console.log(report);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
