#!/usr/bin/env node
/**
 * "<Brand> is live" on the BUYER side at 390×844 on the real web build
 * (signed-in demo buyer). The server writes a `live_started` notification
 * (targetType `live_stream`) to every follower when a seller goes live
 * (routes/live.ts → lib/liveGoLiveNotify.ts). Asserts:
 *   1. The row shows in Activity with the server's copy.
 *   2. Tapping it opens that exact live (/buyer-live?streamId=…).
 *
 * Going live itself is native-only on web ("Going live is mobile-only"), so
 * the seller side is covered by the API test
 * (live-shopping-two-sided.integration.test.ts).
 *
 *   node scripts/flows/live-go-live-verify.mjs [--skip-build]
 * Output: docs/flows/screens/live-shopping/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from '../store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForQuietNetwork,
} from '../store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, '../../docs/flows/screens/live-shopping');
const STREAM_ID = '11111111-2222-4333-8444-555555555555';
const device = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
mkdirSync(OUT, { recursive: true });
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await launchBrowser();
try {
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
  const cors = {
    'access-control-allow-origin': server.origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const json = (route, status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
  await context.route('https://api.brandthread.test/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/notifications' && request.method() === 'GET') {
      // Exactly the row notifyFollowersSellerIsLive publishes.
      return json(route, 200, [{
        id: 'n-live-1', category: 'social', type: 'live_started',
        title: 'Northline Studio is live', body: 'Fall drop — first look', isRead: false, isMuted: false,
        actorId: 'seller-northline', actorName: 'Northline Studio', actorHandle: 'northline',
        targetId: STREAM_ID, targetType: 'live_stream', cta: 'Watch',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      }]);
    }
    if (p === `/api/live/${STREAM_ID}` && request.method() === 'GET') {
      return json(route, 200, { stream: { id: STREAM_ID, status: 'live', title: 'Fall drop — first look', viewer_count: 12, like_count: 40, product_tags: [] } });
    }
    return route.fallback();
  });

  await openScreen(page, activity, server.origin, 'buyer', '/activity-center');
  await page.waitForTimeout(1500);
  if (!page.url().includes('/activity-center')) await page.goto(`${server.origin}/activity-center?bt_preview=buyer`);
  const row = page.getByText('Northline Studio is live').first();
  await row.waitFor({ timeout: 20_000 }).then(
    () => check('the "is live" row shows in Activity', true),
    () => check('the "is live" row shows in Activity', false),
  );
  await waitForQuietNetwork(activity);
  await page.screenshot({ path: path.join(OUT, 'buyer-activity-is-live.png') });
  await row.click().catch(() => {});
  await page.waitForTimeout(2000);
  check('tapping it opens that live', page.url().includes(`/buyer-live?streamId=${STREAM_ID}`), page.url());
  await page.screenshot({ path: path.join(OUT, 'buyer-opens-live.png') });
  await context.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
