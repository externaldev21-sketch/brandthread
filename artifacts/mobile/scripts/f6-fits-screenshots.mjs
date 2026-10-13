#!/usr/bin/env node
/**
 * Verification screenshots for F6 "Fits" (items 80-82) at 390x844:
 *   - share sheet "Stitch" entry (feed)
 *   - stitch flow: trim → your part → post (TikTok order)
 *   - Tag product (buyer fit check → purchased products)
 *   - product page "Fit checks" strip
 *   - post viewer: fit-check product + stitch attribution, ••• menu
 *   - repost request: Review → Approve / Decline sheet
 *
 *   node scripts/f6-fits-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/fits/ours/<NN-step>.png (repo root)
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST, respond } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/fits/ours');
const API = 'https://api.brandthread.test';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE_VIDEO = uuid(1);
const FIT_POST = uuid(2);
const PRODUCT = uuid(3);
const REQUEST = uuid(4);
const STITCH_POST = uuid(5);

async function fulfill(route, origin, body, status = 200) {
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
}

const nova = { displayName: 'Nova Studio', brandName: 'Nova Studio', username: 'novastudio', accountType: 'seller' };
const sourceSummary = {
  id: SOURCE_VIDEO, userId: 'user_nova', caption: 'Drop 04, worn three ways.', mediaType: 'video',
  mediaUrl: `${IMAGE_HOST}/fits-walk.mp4`, thumbnailUrl: `${IMAGE_HOST}/look-rust.jpg`, author: nova,
};
const purchased = [
  { id: PRODUCT, name: 'Heavyweight Hoodie — Ember', imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg`, brandName: 'Northline' },
  { id: uuid(31), name: 'Field Shell Jacket — Rust', imageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, brandName: 'Northline' },
  { id: uuid(32), name: 'Trail Runner 02 — Clay', imageUrl: `${IMAGE_HOST}/runner-rust.jpg`, brandName: 'Field Office' },
];
const fitChecks = [
  { postId: FIT_POST, userId: 'user_ava', caption: '', mediaType: 'photo', thumbnailUrl: `${IMAGE_HOST}/look-rust.jpg`, createdAt: '2026-10-01T10:00:00Z', author: { displayName: 'Ava', username: 'ava.wears' } },
  { postId: uuid(21), userId: 'user_kai', caption: '', mediaType: 'photo', thumbnailUrl: `${IMAGE_HOST}/hoodie-ember.jpg`, createdAt: '2026-09-30T10:00:00Z', author: { displayName: 'Kai', username: 'kai.fits' } },
  { postId: uuid(22), userId: 'user_mo', caption: '', mediaType: 'photo', thumbnailUrl: `${IMAGE_HOST}/look-mono.jpg`, createdAt: '2026-09-29T10:00:00Z', author: { displayName: 'Mo', username: 'mo' } },
];

/** Matches the API path with or without the /api/v1 prefix the app sends; `**` = any suffix. */
function rx(rest) {
  const esc = rest.replace(/\*\*$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${API.replace(/[.]/g, '\\.')}/api(/v1)?${esc}${rest.endsWith('**') ? '' : '(\\?.*)?$'}`);
}

async function installRoutes(page, origin) {
  await page.route(rx(`/fits/stitch-source/**`), (r) => fulfill(r, origin, { source: sourceSummary }));
  await page.route(rx(`/fits/purchased-products**`), (r) => fulfill(r, origin, { products: purchased }));
  await page.route(rx(`/products/${PRODUCT}/fit-checks**`), (r) => fulfill(r, origin, { fitChecks }));
  await page.route(rx(`/fits/fit-checks/${FIT_POST}**`), (r) => fulfill(r, origin, { fitCheck: { postId: FIT_POST, product: purchased[0] } }));
  await page.route(rx(`/fits/fit-checks/${STITCH_POST}**`), (r) => fulfill(r, origin, { error: 'Not a fit check' }, 404));
  await page.route(rx(`/fits/stitches/${FIT_POST}**`), (r) => fulfill(r, origin, { error: 'Not a stitch' }, 404));
  await page.route(rx(`/fits/stitches/${STITCH_POST}**`), (r) => fulfill(r, origin, {
    stitch: { postId: STITCH_POST, clipStartMs: 0, clipEndMs: 5000, sourceAuthor: nova, source: sourceSummary },
  }));
  await page.route(rx(`/fits/repost-requests/status**`), (r) => fulfill(r, origin, { request: null }));
  await page.route(rx(`/fits/posts/${FIT_POST}/repost-eligibility**`), (r) => fulfill(r, origin, { eligible: true, request: null }));
  await page.route(rx(`/fits/repost-requests/${REQUEST}**`), (r) => fulfill(r, origin, {
    request: {
      id: REQUEST, postId: FIT_POST, status: 'pending', createdAt: '2026-10-12T10:00:00Z', respondedAt: null,
      brand: { userId: 'user_northline', name: 'Northline', handle: '@northline', avatarUrl: `${IMAGE_HOST}/portrait-mono.jpg` },
      post: { id: FIT_POST, caption: 'Ember hoodie, one size up.', mediaType: 'photo', mediaUrl: `${IMAGE_HOST}/look-rust.jpg`, thumbnailUrl: `${IMAGE_HOST}/look-rust.jpg` },
    },
  }));
  const viewerPost = (id, caption) => ({
    id, userId: 'user_ava', caption, mediaType: 'photo', mediaUrl: `${IMAGE_HOST}/look-rust.jpg`,
    mediaUrls: [`${IMAGE_HOST}/look-rust.jpg`], thumbnailUrl: `${IMAGE_HOST}/look-rust.jpg`, slides: [], aspectRatio: '3:4',
    seller: { displayName: 'Ava', brandName: null }, likeCount: 12, repostCount: 1, createdAt: '2026-10-01T10:00:00Z',
  });
  await page.route(rx(`/posts/${FIT_POST}`), (r) => fulfill(r, origin, viewerPost(FIT_POST, 'Ember hoodie, one size up.')));
  await page.route(rx(`/posts/${STITCH_POST}`), (r) => fulfill(r, origin, viewerPost(STITCH_POST, '#stitch with @novastudio how I wear it to work')));
  // Product detail for a UUID product: the demo catalogue's hoodie, re-keyed.
  await page.route(rx(`/public/products/${PRODUCT}`), (r) => {
    const body = respond({ method: 'GET', path: '/api/public/products/prod_nl_hoodie_ember', query: new URLSearchParams(), role: 'buyer' });
    return fulfill(r, origin, body ? { ...body, id: PRODUCT } : { error: 'nope' }, body ? 200 : 404);
  });
  // Feed posts with real (UUID) ids so the share sheet offers Quote/Stitch.
  for (const p of ['/api/posts/feed', '/api/public/posts']) {
    await page.route(rx(p.replace(/^\/api/, '') + '**'), (r) => {
      const url = new URL(r.request().url());
      const body = respond({ method: 'GET', path: url.pathname, query: url.searchParams, role: 'buyer' });
      const remap = (list) => list.map((post, i) => ({ ...post, id: uuid(100 + i) }));
      const out = Array.isArray(body) ? remap(body) : body && Array.isArray(body.posts) ? { ...body, posts: remap(body.posts) } : body;
      return fulfill(r, origin, out ?? []);
    });
  }
}

async function shot(page, index, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function go(page, activity, origin, role, target, extraQuery = '') {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await openScreen(page, activity, origin, role, target, { extraQuery });
    await page.waitForTimeout(600);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) break;
  }
  await waitForQuietNetwork(activity, 600, 8000);
  await page.waitForTimeout(800);
}

async function step(page, label, fn) {
  try { await fn(); } catch (err) {
    console.error(`  ✗ ${label}: ${String(err?.message ?? err).split('\n')[0]}`);
    await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  if (!skipBuild || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  // Headless Chromium has no H.264: serve a VP9 copy (ffmpeg -c:v libvpx-vp9) when present.
  const vp9 = path.join(MOBILE_ROOT, '.store-screenshots', 'fits-walk-vp9.mp4');
  const videos = { 'fits-walk': existsSync(vp9) ? vp9 : path.join(MOBILE_ROOT, 'assets/videos/fashion_walk.mp4') };
  const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  let i = 0;
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, videos });
  page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
    await installRoutes(page, origin);

    await step(page, 'share-sheet', async () => {
      await go(page, activity, origin, 'buyer', '/');
      const share = page.getByRole('button', { name: /^share/i }).first();
      await share.click({ timeout: 8000 });
      await page.getByTestId('thread-share-stitch').waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
      await waitForImages(page);
      await shot(page, ++i, 'share-sheet-stitch');
    });

    await step(page, 'stitch', async () => {
      await go(page, activity, origin, 'buyer', `/stitch-post?postId=${SOURCE_VIDEO}`);
      await page.getByTestId('stitch-step-clip').waitFor({ timeout: 10000 });
      await page.waitForTimeout(2000);
      const track = page.getByTestId('stitch-track');
      const box = await track.boundingBox();
      if (box) await page.mouse.click(box.x + box.width * 0.45, box.y + box.height / 2);
      await page.waitForTimeout(800);
      await shot(page, ++i, 'stitch-1-trim');
      await page.getByTestId('stitch-next').click();
      await page.getByTestId('stitch-step-yours').waitFor({ timeout: 8000 });
      await waitForImages(page);
      await page.waitForTimeout(400);
      await shot(page, ++i, 'stitch-2-your-part');
      const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
      await page.getByTestId('stitch-upload').click();
      await (await chooser).setFiles(images['look-mono'] ?? Object.values(images)[0]);
      await page.waitForTimeout(1200);
      await shot(page, ++i, 'stitch-3-your-part-picked');
      await page.getByTestId('stitch-next').click();
      await page.getByTestId('stitch-step-post').waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
      await shot(page, ++i, 'stitch-4-post');
    });

    await step(page, 'tag-product', async () => {
      await go(page, activity, origin, 'buyer', `/fit-check-product?postId=${FIT_POST}`);
      await page.getByTestId(`fit-check-product-${PRODUCT}`).waitFor({ timeout: 8000 });
      await waitForImages(page);
      await shot(page, ++i, 'fit-check-tag-product');
    });

    await step(page, 'product-strip', async () => {
      await go(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
      const strip = page.getByTestId('product-fit-checks');
      await strip.waitFor({ timeout: 12000 });
      await strip.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(600);
      await waitForImages(page);
      await shot(page, ++i, 'product-fit-checks-strip');
    });

    await step(page, 'viewer', async () => {
      await go(page, activity, origin, 'buyer', `/buyer-post-viewer?postId=${FIT_POST}`);
      await page.getByTestId('post-fit-check-product').waitFor({ timeout: 10000 });
      await page.getByTestId('post-fit-check-product').scrollIntoViewIfNeeded();
      await waitForImages(page);
      await shot(page, ++i, 'viewer-fit-check');
      await page.getByRole('button', { name: 'More options' }).click();
      await page.waitForTimeout(600);
      await shot(page, ++i, 'viewer-more-menu');
      await page.keyboard.press('Escape').catch(() => {});
    });

    await step(page, 'viewer-stitch', async () => {
      await go(page, activity, origin, 'buyer', `/buyer-post-viewer?postId=${STITCH_POST}`);
      await page.getByTestId('post-stitch-attribution').waitFor({ timeout: 10000 });
      await page.getByTestId('post-stitch-attribution').scrollIntoViewIfNeeded();
      await waitForImages(page);
      await shot(page, ++i, 'viewer-stitch-attribution');
    });

    await step(page, 'repost-request', async () => {
      await go(page, activity, origin, 'buyer', `/repost-request?id=${REQUEST}`);
      await page.getByTestId('repost-request-review').waitFor({ timeout: 10000 });
      await waitForImages(page);
      await shot(page, ++i, 'repost-request');
      await page.getByTestId('repost-request-review').click();
      await page.getByTestId('repost-request-approve').waitFor({ timeout: 5000 });
      await page.waitForTimeout(700);
      await shot(page, ++i, 'repost-request-review-sheet');
    });
    await context.close();

    const seller = await openContext(browser, { device, role: 'seller', origin, images, videos });
    await installRoutes(seller.page, origin);
    await step(seller.page, 'seller-menu', async () => {
      // The signed-out seller preview blocks API calls, so it shows the item only in its demo dataset.
      await go(seller.page, seller.activity, origin, 'seller', `/buyer-post-viewer?postId=${FIT_POST}`, '&demo=1');
      await seller.page.getByRole('button', { name: 'More options' }).click({ timeout: 10000 });
      await seller.page.waitForTimeout(600);
      await shot(seller.page, ++i, 'seller-request-to-repost-menu');
    });
    await seller.context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Done → ${path.relative(MOBILE_ROOT, OUT)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
