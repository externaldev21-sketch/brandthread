#!/usr/bin/env node
/**
 * One-off live verification for the "fine print isn't crisp" pass — not
 * part of the store screenshot pipeline. Production web export + a fake
 * API, richer review data (buyerName, verifiedBuyer, sizeBought,
 * helpfulCount, photos) than demo-data.mjs's REVIEWS so every row type Dev
 * flagged actually renders: review body, "Helpful (N)", dates, "Verified
 * buyer", "Size bought".
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/fine-print-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/fine-print'));
mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const iso = (msAgo) => new Date(DEMO_NOW - msAgo).toISOString();

const REVIEWS = {
  reviews: [
    {
      id: 'rev_1', rating: 5, buyerName: 'Priya Shah', verifiedBuyer: true,
      sizeBought: 'M', fitNote: 'True to size', helpfulCount: 12,
      body: 'Heaviest hoodie I own and it still drapes. Sized true, holds its shape after washing.',
      createdAt: iso(6 * DAY),
    },
    {
      id: 'rev_2', rating: 5, buyerName: 'Marcus Webb', verifiedBuyer: true,
      sizeBought: 'L', fitNote: 'Runs slightly large', helpfulCount: 4,
      body: 'The ember colour is even better in person. Stitching is clean.',
      createdAt: iso(14 * DAY),
      photos: [`${IMAGE_HOST}/hoodie-bone.jpg`],
    },
    {
      id: 'rev_3', rating: 4, buyerName: 'Ana Ruiz', verifiedBuyer: true,
      sizeBought: 'S', helpfulCount: 1,
      body: 'Great fit, sleeves run slightly long for me but overall happy with the purchase.',
      createdAt: iso(30 * DAY),
    },
  ],
  avgRating: 4.8,
  totalCount: 126,
};

async function installFakeApi(context, origin) {
  const norm = (pathname) => `/api${pathname.replace(/^\/api\/v1/, '').replace(/^\/api/, '')}`;
  await context.route((url) => url.origin === 'https://api.brandthread.test' && norm(url.pathname).startsWith('/api/reviews/product/'), async (route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': req.headers().origin ?? origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(REVIEWS) });
  });
}

async function run(browser, images, origin) {
  const role = 'buyer';
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await installFakeApi(context, origin);
  const shot = (name) => page.screenshot({ path: path.join(OUT, name) });
  const settle = async (ms = 900) => { await waitForQuietNetwork(activity, 500, 8000); await page.waitForTimeout(ms); };

  for (let attempt = 1; ; attempt += 1) {
    await openScreen(page, activity, origin, role, '/buyer-product-detail?productId=prod_nl_jacket_rust');
    try { await page.getByText('Priya Shah').first().waitFor({ timeout: 20_000 }); break; } catch (error) { if (attempt >= 4) throw error; }
  }
  await settle(1000);
  // Scroll the reviews section into view.
  await page.getByText('Priya Shah').first().scrollIntoViewIfNeeded();
  await settle(500);
  await shot('01-product-page-reviews.png');

  await context.close();
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await run(browser, images, origin);
    console.log('OK — screenshot(s) written to', OUT);
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
