#!/usr/bin/env node
/**
 * 390x844 screenshots for F6 "Live 1/2" (flash-deal timers, just-bought /
 * gift rows, co-host bag, 7-day shoppable replays). Drives the preview web
 * export through the shared harness (fake Clerk user + fake API). Endpoints
 * that aren't in the harness's demo data are answered here with page.route
 * stubs — screenshot-only.
 *
 *   node scripts/f6-live-commerce-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/live-commerce/ours/*.png (repo root)
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/live-commerce/ours');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const API = 'https://api.brandthread.test';
const STREAM = '7d3c1f0e-1b7a-4c41-9a51-2f3e4d5c6b7a';
const IMG = (name) => `https://cdn.brandthread.test/demo/${name}.jpg`;

async function shot(page, name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ok ${name}`);
}

function corsFor(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

async function stub(page, origin, pattern, body) {
  await page.route(`${API}${pattern}`, async (route) => {
    const cors = corsFor(origin);
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const payload = typeof body === 'function' ? body(route.request()) : body;
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(payload) });
  });
}

let images = {};
async function open(browser, origin, role, target, { demo = false, marker, routes = async () => {} } = {}) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  await routes(page);
  await openScreen(page, activity, origin, role, target, demo ? { extraQuery: '&demo=1' } : {});
  await page.waitForTimeout(2000);
  const m = page.getByTestId(marker);
  for (let i = 0; i < 4 && !(await m.first().isVisible().catch(() => false)); i++) {
    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${demo ? '&demo=1' : ''}`);
    await page.waitForTimeout(2500);
  }
  return { context, page };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  mkdirSync(OUT, { recursive: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const now = Date.now();
  try {
    // 1-3. Buyer pager (demo): gift + just-bought rows in chat; bag with a
    // running flash deal and a co-host's piece.
    let s = await open(browser, origin, 'buyer', '/live', { demo: true, marker: 'live-screen' });
    await s.page.waitForTimeout(9000); // let the scripted chat roll past the gift line
    await shot(s.page, '01-live-chat-gift-and-just-bought');
    await s.page.getByTestId('live-bag').first().click();
    await s.page.getByTestId('live-products-sheet').waitFor({ timeout: 8000 });
    await shot(s.page, '02-live-bag-flash-deal-cohost');
    await s.page.waitForTimeout(3000);
    await shot(s.page, '03-live-bag-flash-deal-ticking');
    await s.context.close();

    // (Host Live codes sheet lives in seller-live.tsx, which is native-only on web.)

    // 5. Replay player with "Shop the replay".
    const replay = {
      streamId: STREAM, sellerId: 'seller_demo', postId: 'p1', title: 'Fall drop — tailoring live',
      description: null, thumbnailUrl: IMG('look-mono'), replayUrl: 'https://cdn.brandthread.test/replay.mp4',
      peakViewerCount: 1840, startedAt: new Date(now - 2 * 86_400_000 - 3_600_000).toISOString(),
      endedAt: new Date(now - 2 * 86_400_000).toISOString(), durationSeconds: 3540, isOwner: false,
      expiresAt: new Date(now + 5 * 86_400_000).toISOString(), expired: false,
      products: [
        { productId: 'a1', name: 'Linen Blazer', priceCents: 18000, imageUri: IMG('jacket-onyx'), sellerId: 'seller_demo', sellerName: 'Atelier' },
        { productId: 'a2', name: 'Silk Scarf', priceCents: 6500, imageUri: IMG('texture-mono'), sellerId: 'seller_demo', sellerName: 'Atelier' },
        { productId: 'a3', name: 'Wool Trousers', priceCents: 14500, imageUri: IMG('cargo-rust'), sellerId: 'seller_demo', sellerName: 'Atelier' },
      ],
    };
    s = await open(browser, origin, 'buyer', `/live-replay?streamId=${STREAM}`, {
      marker: 'live-replay-screen',
      routes: async (page) => { await stub(page, origin, `/api/v1/live-replays/${STREAM}**`, { replay }); },
    });
    await s.page.getByTestId('replay-products').waitFor({ timeout: 8000 }).catch(() => {});
    await shot(s.page, '05-replay-shop-the-replay');
    await s.context.close();

    // 6. Owner's replays grid: an expired replay is marked.
    s = await open(browser, origin, 'buyer', '/live-replays?sellerId=seller_demo', {
      marker: 'live-replays-screen',
      routes: async (page) => {
        await stub(page, origin, '/api/v1/live-replays/by-seller/**', {
          hasMore: false,
          replays: [
            { ...replay, isOwner: true, visibility: 'public', thumbnailUrl: IMG('look-mono'), products: undefined },
            { ...replay, streamId: 'r2', title: 'Denim restock', isOwner: true, visibility: 'public', thumbnailUrl: IMG('story-mono'), expired: true, products: undefined },
            { ...replay, streamId: 'r3', title: 'Bridal first look', isOwner: true, visibility: 'hidden', thumbnailUrl: IMG('portrait-mono'), products: undefined },
          ],
        });
      },
    });
    await shot(s.page, '06-owner-replays-expired');
    await s.context.close();
  } finally {
    await browser.close();
    close();
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
