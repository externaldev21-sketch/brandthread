#!/usr/bin/env node
/**
 * Restock pushes (bag_restock, size_back) in the buyer's Activity and
 * Notifications screens, before (dev baseline build) and after (this branch).
 * The fake API answers GET /api/buyer/notifications with the rows
 * artifacts/api-server/src/lib/restockAudiences.ts writes.
 *
 *   node scripts/restock-push-screenshots.mjs [--skip-build]
 *
 * Before: /home/user/baseline-web-build (prebuilt dev). After:
 * .store-screenshots/web-build in this checkout (built unless --skip-build).
 * Output: docs/pr-assets/restock-push/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const SKIP_BUILD = process.argv.includes('--skip-build');
const BEFORE_BUILD = process.env.BASELINE_BUILD ?? '/home/user/baseline-web-build';
const AFTER_BUILD = path.join(MOBILE_ROOT, '.store-screenshots', 'web-build');
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/restock-push');
mkdirSync(OUT, { recursive: true });

const API = 'https://api.brandthread.test';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = [
  { id: '390x844', viewport: { width: 390, height: 844 } },
  { id: '393x852', viewport: { width: 393, height: 852 } },
];
const NOW = Date.parse('2026-09-18T23:30:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;

const [hoodie, jacket] = PUBLIC_PRODUCTS;

/** GET /api/buyer/notifications rows, as restockAudiences.ts publishes them. */
const feedRows = [
  {
    id: 'n-bag-1', category: 'cart', type: 'bag_restock', title: 'Back in stock',
    body: `${hoodie.name}, size M, from your bag is available again.`, isRead: false, isMuted: false,
    targetId: hoodie.id, targetType: 'product', targetImageUrl: hoodie.images[0], cta: 'Shop now', createdAt: iso(4 * MIN),
  },
  {
    // A product without a photo shows the type's icon instead of a thumbnail.
    id: 'n-size-1', category: 'stock', type: 'size_back', title: 'Your size is back',
    body: `${jacket.name} is back in L.`, isRead: false, isMuted: false,
    targetId: jacket.id, targetType: 'product', targetImageUrl: null, cta: 'Shop now', createdAt: iso(25 * MIN),
  },
  {
    id: 'n-bag-2', category: 'cart', type: 'bag_restock', title: 'Back in stock',
    body: 'Canvas tote from your bag is available again.', isRead: true, isMuted: false,
    targetId: 'restock-tote', targetType: 'product', targetImageUrl: null, cta: 'Shop now', createdAt: iso(3 * 60 * MIN),
  },
];

async function routeApi(context, origin) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
    if (p === '/api/buyer/notifications' && request.method() === 'GET') {
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(feedRows) });
    }
    return route.fallback();
  });
}

async function settle(page, activity, ms = 800) {
  await waitForQuietNetwork(activity, 800, 20_000).catch(() => {});
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(ms);
}

async function capture(browser, images, origin, label, device, screen, file, readyText) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: device.viewport, scale: 2, isMobile: true, userAgent: UA }, role: 'buyer', origin, images,
  });
  await routeApi(context, origin);
  try {
    await openScreen(page, activity, origin, 'buyer', screen);
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await page.getByText(readyText).first().waitFor({ state: 'visible', timeout: 12_000 }); break; } catch (error) {
        if (attempt === 3) throw error;
        await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); },
          `${screen}?bt_preview=buyer`);
      }
    }
    await settle(page, activity, 1000);
    const out = path.join(OUT, `${label}-${file}-${device.id}.png`);
    await page.screenshot({ path: out });
    console.log(`  ✓ ${path.relative(process.cwd(), out)}`);
  } catch (error) {
    console.warn(`  ✗ ${label} ${file} ${device.id}: ${error.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
}

async function run() {
  if (!existsSync(path.join(BEFORE_BUILD, 'index.html'))) throw new Error(`Missing baseline build at ${BEFORE_BUILD}`);
  if (!SKIP_BUILD || !existsSync(path.join(AFTER_BUILD, 'index.html'))) buildPreviewWeb(AFTER_BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    for (const [label, build] of [['before', BEFORE_BUILD], ['after', AFTER_BUILD]]) {
      const server = await serveBuild(build);
      try {
        for (const device of DEVICES) {
          await capture(browser, images, server.origin, label, device, '/activity-center', 'activity', 'Your size is back');
          await capture(browser, images, server.origin, label, device, '/buyer-notifications', 'notifications', 'Your size is back');
        }
      } finally {
        server.close();
      }
    }
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
