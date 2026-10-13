#!/usr/bin/env node
/**
 * Product page polish (items 81–106): before/after captures at 393×852 on the
 * exported web build (signed-in demo account, fake API from demo-data.mjs,
 * plus the per-shot overrides below).
 *
 *   node scripts/store-screenshots/product-polish-verify.mjs <buildDir> <outDir> [--only=a,b]
 *
 * Build with:  node -e "import('./scripts/store-screenshots/harness.mjs').then(m => m.buildPreviewWeb('<buildDir>'))"
 *
 * Every override below is a shape the real server returns:
 *   GET /api/public/products/:id                    → product row incl. migration 270 columns
 *   GET /api/product-page-details/public/:id/in-bags → { count }
 *   GET /api/product-videos/public/:id               → { video }
 *   GET /api/product-page-details/:id                → seller editor
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './demo-images.mjs';
import { launchBrowser, MOBILE_ROOT, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { PUBLIC_PRODUCTS } from './demo-data.mjs';

const [buildDir, outDir] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
if (!buildDir || !outDir) {
  console.error('usage: product-polish-verify.mjs <buildDir> <outDir> [--only=a,b]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };
const DEVICE = {
  viewport: VIEWPORT, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const API = 'https://api.brandthread.test';
const IMG = 'https://cdn.brandthread.test/demo';

const base = PUBLIC_PRODUCTS[0];
const PHOTOS = { Ember: `${IMG}/hoodie-ember.jpg`, Graphite: `${IMG}/hoodie-graphite.jpg`, Bone: `${IMG}/hoodie-bone.jpg` };
/** A product with every product-page field the seller can set. */
const RICH_PRODUCT = {
  ...base,
  images: [PHOTOS.Ember, PHOTOS.Graphite, PHOTOS.Bone, `${IMG}/hoodie-moss.jpg`],
  imageUrl: PHOTOS.Ember,
  modelHeightCm: 185,
  modelSizeWorn: 'L',
  fabric: '100% organic cotton loopback fleece, 480 gsm. Garment-washed for a broken-in hand.',
  care: 'Machine wash cold, inside out. Hang dry. Do not tumble dry or bleach.',
  origin: 'Cut and sewn in Portland, Oregon',
  colorImages: PHOTOS,
  sizeChart: {
    unit: 'in',
    columns: ['Chest', 'Length', 'Sleeve'],
    rows: [
      { size: 'S', values: ['21', '27', '33'] },
      { size: 'M', values: ['22.5', '28', '34'] },
      { size: 'L', values: ['24', '29', '35'] },
      { size: 'XL', values: ['25.5', '30', '36'] },
    ],
  },
  variants: Object.keys(PHOTOS).flatMap((color, ci) => ['S', 'M', 'L', 'XL'].map((size, si) => {
    const soldOut = ci === 2 && si === 0; // Bone / S
    return {
      id: `${base.id}_${color.toLowerCase()}_${size.toLowerCase()}`,
      productId: base.id, size, color,
      priceCents: 9800, compareAtPriceCents: 12800,
      stock: soldOut ? 0 : 12 - si * 2, weightGrams: 900,
    };
  })),
};

const SELLER_EDITOR = {
  productId: base.id,
  productName: base.name,
  images: RICH_PRODUCT.images,
  colors: Object.keys(PHOTOS),
  details: {
    modelHeightCm: 185, modelSizeWorn: 'L',
    fabric: RICH_PRODUCT.fabric, care: RICH_PRODUCT.care, origin: RICH_PRODUCT.origin,
    colorImages: { Ember: PHOTOS.Ember, Graphite: PHOTOS.Graphite },
  },
};

const PDP = `/buyer-product-detail?productId=${base.id}`;
const scrollTo = (testId) => async (page) => {
  await page.getByTestId(testId).first().scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible')
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (sc) sc.scrollTop = Math.max(0, sc.scrollTop - 220);
  });
  await page.waitForTimeout(500);
};
const clickText = (text) => (page) => page.getByText(text, { exact: true }).first().click();

const SHOTS = {
  // Before + after: the same plain catalogue product and the rich one.
  'pdp-top': { target: PDP },
  'pdp-full': { target: PDP, full: true },
  'pdp-rich-top': { target: PDP, rich: true },
  'pdp-rich-full': { target: PDP, rich: true, full: true },
  // After only.
  'pdp-color-bone': {
    target: PDP, rich: true,
    act: async (page) => { await page.getByTestId('option-opt_color-color_Bone').click(); await page.waitForTimeout(900); await page.evaluate(() => { const sc = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible').sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (sc) sc.scrollTop = 0; }); await page.waitForTimeout(600); },
  },
  'pdp-color-swatches': {
    target: PDP, rich: true,
    act: async (page) => { await page.getByTestId('option-opt_color-color_Bone').click(); await scrollTo('option-opt_color-color_Bone')(page); },
  },
  'pdp-sold-out': {
    target: PDP, rich: true,
    act: async (page) => {
      await page.getByTestId('option-opt_color-color_Bone').click();
      await page.getByTestId('option-opt_size-size_S').click();
      await page.waitForTimeout(1500);
      await scrollTo('sold-out-alternatives')(page);
    },
  },
  'pdp-size-chart-cm': {
    target: PDP, rich: true,
    act: async (page) => {
      await page.getByRole('button', { name: 'Size chart' }).click();
      await page.waitForTimeout(400);
      await page.getByTestId('size-chart-unit-toggle').getByText('Centimeters', { exact: true }).click();
      await scrollTo('size-chart-unit-toggle')(page);
    },
  },
  'pdp-details-rows': {
    target: PDP, rich: true,
    act: async (page) => {
      await page.getByTestId('product-detail-row-fabric').click();
      await page.getByTestId('product-detail-row-care').click();
      await scrollTo('product-detail-rows')(page);
    },
  },
  'pdp-loupe': {
    target: PDP, rich: true,
    act: async (page) => {
      const cdp = await page.context().newCDPSession(page);
      const point = { x: 230, y: 330 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await page.waitForTimeout(450);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 236, y: 336 }] });
      await page.waitForTimeout(250);
      page.__endTouch = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  },
  'pdp-plus-one': {
    target: PDP, rich: true, motion: true,
    act: async (page) => {
      await page.getByTestId('option-opt_color-color_Ember').click();
      await page.getByTestId('option-opt_size-size_M').click();
      await page.getByTestId('product-add-to-cart').click();
      await page.getByTestId('bag-plus-one').waitFor({ timeout: 8000 });
      await page.waitForTimeout(160);
      await page.evaluate(() => { const sc = [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible').sort((a, b) => b.scrollHeight - a.scrollHeight)[0]; if (sc) sc.scrollTop = 0; });
    },
  },
  'pdp-video-first': { target: PDP, rich: true, video: true },
  'seller-details': { target: `/product-page-details?productId=${base.id}`, role: 'seller', seller: true, full: true },
  'bag': { target: '/(buyer)/cart', full: true },
};

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

async function override(context, origin, test, body) {
  await context.route((url) => url.origin === API && test(url.pathname.replace(/^\/api\/v1/, '/api')), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    return route.fulfill({ status: 200, headers: cors(origin), contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function fullShot(page, file) {
  const extra = await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight + 4 && getComputedStyle(d).overflowY !== 'visible')
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (sc) sc.scrollTop = 0;
    return sc ? Math.min(sc.scrollHeight - sc.clientHeight, 7000) : 0;
  });
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height + extra });
  await page.waitForTimeout(900);
  await waitForImages(page);
  await page.screenshot({ path: file });
  await page.setViewportSize(VIEWPORT);
}

async function run() {
  const server = await serveBuild(path.resolve(buildDir));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const videos = { 'product-video': path.join(MOBILE_ROOT, 'assets/videos/fashion_runway_05.mp4') };
  try {
    for (const [name, shot] of Object.entries(SHOTS)) {
      if (ONLY && !ONLY.includes(name)) continue;
      const role = shot.role ?? 'buyer';
      const { context, page, activity } = await openContext(browser, {
        device: DEVICE, role, origin: server.origin, images, videos,
        contextOptions: shot.motion ? { reducedMotion: 'no-preference' } : {},
      });
      if (shot.rich) {
        await override(context, server.origin, (p) => /^\/api\/public\/products\/[^/]+$/.test(p), RICH_PRODUCT);
        await override(context, server.origin, (p) => /^\/api\/product-page-details\/public\/[^/]+\/in-bags$/.test(p), { count: 12 });
      }
      if (shot.video) {
        await override(context, server.origin, (p) => /^\/api\/product-videos\/public\//.test(p), {
          video: { videoUrl: `${IMG}/product-video.mp4`, posterUrl: PHOTOS.Ember, durationMs: 14000 },
        });
      }
      if (shot.seller) {
        await override(context, server.origin, (p) => /^\/api\/product-page-details\/[^/]+$/.test(p), SELLER_EDITOR);
      }
      page.setDefaultNavigationTimeout(120_000);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await openScreen(page, activity, server.origin, role, shot.target);
        await page.waitForTimeout(800);
        const pathname = decodeURIComponent(await page.evaluate(() => window.location.pathname)).replace('/(buyer)', '');
        if (pathname.startsWith(shot.target.split('?')[0].replace('/(buyer)', ''))) break;
      }
      if (shot.target.startsWith('/buyer-product-detail')) {
        await page.getByTestId('product-add-to-cart').first().waitFor({ timeout: 60_000 }).catch(() => {});
      }
      await page.waitForTimeout(2500);
      await waitForQuietNetwork(activity, 800, 15_000);
      await waitForImages(page);
      try {
        if (shot.act) await shot.act(page);
      } catch (error) {
        console.log(`  ! ${name}: ${error.message.split('\n')[0]}`);
      }
      const file = path.join(outDir, `${name}.png`);
      if (shot.full) await fullShot(page, file);
      else await page.screenshot({ path: file });
      if (page.__endTouch) await page.__endTouch();
      console.log(`  ✓ ${name}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
