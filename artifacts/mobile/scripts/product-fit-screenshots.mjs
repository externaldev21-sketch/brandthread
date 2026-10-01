#!/usr/bin/env node
/**
 * 393x852 screenshots for the "Complete the fit" + product video PR.
 * Preview web export, demo data via `&demo=1` (localStorage bt_preview_demo),
 * fresh preview for the empty video manager. No real API is called.
 *
 *   node scripts/product-fit-screenshots.mjs [--skip-build]
 */
import { existsSync, mkdirSync } from 'node:fs';
import { reportTextFit } from './lib/textFitCheck.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/product-fit-video');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PID = 'preview-product-01';
const MAIN = PUBLIC_PRODUCTS[0];
const PAIRED = PUBLIC_PRODUCTS.slice(1, 5);
let IMAGES = {};

const go = (page, target) => page.evaluate((url) => {
  history.pushState(history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
}, target);

/** The PDP + the two new public endpoints, answered by the fake API (real component code paths run). */
async function installFitApi(context) {
  const cors = (route) => ({
    'access-control-allow-origin': route.request().headers().origin ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  });
  const re = /^\/api(\/v1)?\/(public\/products\/[^/]+|product-pairings\/public\/[^/]+|product-videos\/public\/[^/]+)$/;
  await context.route((url) => url.origin === 'https://api.brandthread.test' && re.test(url.pathname), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
    const pathname = new URL(req.url()).pathname.replace(/^\/api(\/v1)?/, '');
    let body;
    if (pathname.startsWith('/public/products/')) body = PUBLIC_PRODUCTS.find((p) => p.id === decodeURIComponent(pathname.split('/').pop())) ?? null;
    else if (pathname.startsWith('/product-pairings/')) {
      body = PAIRED.map((p, i) => ({
        id: p.id, sellerId: p.sellerId, sellerName: p.sellerDisplayName, name: p.name, image: p.images[0], images: p.images,
        priceCents: p.priceCents, isPreOrder: false, available: i !== 2,
        variants: p.variants.map((v) => ({ id: v.id, size: v.size, color: null, priceCents: v.priceCents, stock: v.stock })),
      }));
    } else body = { video: { videoUrl: '', posterUrl: MAIN.images[0], durationMs: 18000 } };
    if (body === null) return route.fulfill({ status: 404, headers: cors(route), contentType: 'application/json', body: '{"error":"Product not found"}' });
    return route.fulfill({ status: 200, headers: cors(route), contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function session(browser, origin, role, demo) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images: IMAGES });
  await installFitApi(context);
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  await openScreen(page, activity, origin, role, '/', {
    beforeNavigate: async () => {
      await page.evaluate((on) => { if (on) localStorage.setItem('bt_preview_demo', '1'); else localStorage.removeItem('bt_preview_demo'); }, demo);
    },
  });
  await page.waitForTimeout(6000);
  return { context, page };
}

async function nav(page, url, text) {
  for (let i = 0; i < 5; i += 1) {
    await go(page, url);
    await page.waitForTimeout(2500);
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
  }
  throw new Error(`screen did not open: ${url}`);
}

async function shot(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
  await reportTextFit(page, name);
}

/** Zoomed 2x crop of a region (text-fit evidence). */
async function clip(page, name, y, height) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: 0, y, width: 393, height } });
  console.log(`  ok ${name}`);
}

async function clipFrom(page, name, text, height, above = 12) {
  const box = await page.getByText(text, { exact: true }).first().boundingBox();
  const y = Math.max(0, box.y - above);
  await clip(page, name, y, Math.min(height, 852 - y));
}

async function scrollTo(page, text) {
  await page.getByText(text, { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  IMAGES = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    {
      const { context, page } = await session(browser, origin, 'buyer', true);
      await nav(page, `/buyer-product-detail?productId=${MAIN.id}&bt_preview=buyer`, 'Complete the fit');
      await scrollTo(page, 'Complete the fit');
      await shot(page, '01-complete-the-fit-pdp');
      await clipFrom(page, 'zoom-complete-the-fit-rail', 'Complete the fit', 330);
      await scrollTo(page, 'Product video');
      await shot(page, '03-product-video-pdp');
      await clipFrom(page, 'zoom-product-video-section', 'Product video', 330);
      await context.close();
    }
    {
      const { context, page } = await session(browser, origin, 'seller', true);
      await nav(page, `/product-pairings?productId=${PID}&bt_preview=seller`, 'Paired products');
      await shot(page, '02-pairings-manager');
      await clipFrom(page, 'zoom-pairings-rows', 'Paired products', 330);
      await page.getByLabel('Add product').first().click();
      await page.waitForTimeout(800);
      await shot(page, '02b-pairings-picker');
      await nav(page, `/product-video?productId=${PID}&bt_preview=seller`, 'Replace');
      await shot(page, '05-video-manager-uploaded');
      await clipFrom(page, 'zoom-video-actions', 'Replace', 90, 20);
      await context.close();
    }
    {
      const { context, page } = await session(browser, origin, 'seller', false);
      await nav(page, `/product-video?productId=${PID}&bt_preview=seller`, 'Add video');
      await shot(page, '04-video-manager-empty');
      await clipFrom(page, 'zoom-video-empty-tile', 'Add video', 120, 60);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
