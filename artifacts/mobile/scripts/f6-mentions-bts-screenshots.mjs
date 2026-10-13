#!/usr/bin/env node
/**
 * Verification screenshots for F6 items 86 (product mentions in captions) and
 * 78 (seller "Behind the scenes" posts). Reference: TikTok (composer chips +
 * search-list picker, bold linked caption tokens, label line under the name).
 *
 *   node scripts/f6-mentions-bts-screenshots.mjs
 *   node scripts/f6-mentions-bts-screenshots.mjs --skip-build
 *
 * The feed fixture's first demo post is served with a product mention and the
 * 'bts' label (the shape GET /api/posts/feed now returns); the composer runs
 * in demo mode (?demo=1) so the picker lists the demo seller's products.
 *
 * Output: docs/pr-assets/mentions-bts/ours/<NN-step>.png (repo root)
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { respond } from './store-screenshots/demo-data.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'mentions-bts', 'ours');
const PHOTO = path.join(MOBILE_ROOT, 'assets', 'images', 'products', 'leather-ankle-boots.jpg');
const device = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};

let index = 0;
async function shot(page, name) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.waitForTimeout(500);
  const file = path.join(OUTPUT_DIR, `${String(++index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

/** First demo post gets a mention of its first tagged product + the bts label. */
function withMentions(list) {
  if (!Array.isArray(list)) return list;
  return list.map((post, i) => {
    if (i !== 0 || !post?.taggedProducts?.length) return post;
    const tag = post.taggedProducts[0];
    return {
      ...post,
      caption: `Fitting day in the studio. The ${tag.name}, cut heavy and made to last. #drop04`,
      productMentions: [{ productId: tag.productId, label: tag.name, position: 0, name: tag.name, images: [], priceCents: tag.priceCents }],
      labels: ['bts'],
    };
  });
}

async function routeFeed(page, origin, role) {
  for (const p of ['/api/posts/feed', '/api/public/posts']) {
    await page.route(`https://api.brandthread.test${p}**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
      const url = new URL(request.url());
      const body = withMentions(respond({ method: 'GET', path: url.pathname, query: url.searchParams, role }));
      return route.fulfill({ status: 200, headers: cors(origin), contentType: 'application/json', body: JSON.stringify(body ?? []) });
    });
  }
}

async function openReliably(page, activity, origin, role, target, extraQuery = '') {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target, { extraQuery });
    await page.waitForTimeout(600);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect`);
}

async function feedFlow(browser, origin, images) {
  console.log('\n== buyer feed ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  try {
    await routeFeed(page, origin, 'buyer');
    await openReliably(page, activity, origin, 'buyer', '/feed');
    const guide = page.getByText('Tap to keep watching');
    if (await guide.count()) await guide.first().click().catch(() => {});
    await page.getByTestId('post-label').first().waitFor({ timeout: 20_000 });
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await shot(page, 'feed-bts-label-and-product-mention');
    await page.locator('[data-testid^="caption-product-"]').first().click();
    await page.waitForTimeout(1200);
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await shot(page, 'feed-tap-mention-opens-product-sheet');
  } catch (error) {
    console.error(`  x feed: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-feed').catch(() => {});
  } finally {
    await context.close();
  }
}

async function composerFlow(browser, origin, images) {
  console.log('\n== seller composer ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  try {
    await openReliably(page, activity, origin, 'seller', '/create-post?mode=thread&bts=1', '&demo=1');
    await page.getByTestId('gallery-picker').waitFor({ timeout: 25_000 });
    await page.locator('[data-testid="gallery-file-input"]').setInputFiles([PHOTO]);
    await page.waitForTimeout(1200);
    await page.locator('[data-testid^="gallery-tile-"]').first().click();
    await page.getByTestId('gallery-next').click();
    await page.getByTestId('slide-editor').waitFor({ timeout: 15_000 });
    await page.getByTestId('edit-next').click();
    await page.getByTestId('post-screen').waitFor({ timeout: 15_000 });
    await page.getByTestId('caption-input').fill('Fitting day in the studio. Wearing the');
    await page.getByTestId('caption-input').press('End');
    await shot(page, 'composer-mention-a-product-row');

    await page.getByTestId('row-mention-products').click();
    await page.getByTestId('mention-products-page').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await shot(page, 'composer-product-picker');

    await page.locator('[data-testid^="mention-product-"]').first().click();
    await page.getByTestId('post-screen').waitFor();
    await page.getByTestId('caption-input').blur().catch(() => {});
    await shot(page, 'composer-caption-with-mention');

    await page.getByTestId('row-options').click();
    await page.getByTestId('options-page').waitFor({ timeout: 10_000 });
    await shot(page, 'composer-behind-the-scenes-switch');
  } catch (error) {
    console.error(`  x composer: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-composer').catch(() => {});
  } finally {
    await context.close();
  }
}

async function studioFlow(browser, origin, images) {
  console.log('\n== studio ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  try {
    await openReliably(page, activity, origin, 'seller', '/studio');
    await page.getByText('Behind the Scenes').first().waitFor({ timeout: 20_000 });
    await page.getByText('Behind the Scenes').first().scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 120);
    await waitForImages(page);
    await shot(page, 'studio-behind-the-scenes-entry');
  } catch (error) {
    console.error(`  x studio: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-studio').catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
    await feedFlow(browser, origin, images);
    await composerFlow(browser, origin, images);
    await studioFlow(browser, origin, images);
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
