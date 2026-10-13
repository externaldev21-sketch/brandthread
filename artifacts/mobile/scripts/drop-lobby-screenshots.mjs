#!/usr/bin/env node
/**
 * Drop lobby on the product page: before (dev) and after, at 393x852, using
 * the store-screenshots harness (signed-in demo buyer) with a fake
 * /api/product-launches/:id that says the product opens in a few hours with
 * a real-looking notify count, plus a scene that opens 4 seconds after load
 * to show Buy switching on at the second with no reload.
 *
 *   node scripts/drop-lobby-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/drop-lobby/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/drop-lobby');
const BASELINE_DIR = '/home/user/baseline-web-build';
const PRODUCT = 'prod_nl_jacket_rust';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: UA };
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin, { opensInMs }) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  const launchAt = new Date(DEMO_NOW + opensInMs).toISOString();
  let subscribed = false;
  let count = 312;
  // The harness clock starts at DEMO_NOW and runs in real time.
  const t0 = Date.now();
  await context.route((url) => /\/api(\/v1)?\/product-launches\//.test(url.pathname) && url.pathname.includes(PRODUCT), async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const isAlert = new URL(req.url()).pathname.endsWith('/alert');
    if (isAlert) {
      if (req.method() === 'POST' && !subscribed) { subscribed = true; count += 1; }
      if (req.method() === 'DELETE' && subscribed) { subscribed = false; count -= 1; }
      return route.fulfill(json(origin, { subscribed }));
    }
    const serverNow = DEMO_NOW + (Date.now() - t0);
    const launching = serverNow < Date.parse(launchAt);
    return route.fulfill(json(origin, {
      launching, launchAt: launching ? launchAt : null, notifyCount: launching ? count : 0, serverNow: new Date(serverNow).toISOString(),
    }));
  });
  return { context, page, activity };
}

async function openProduct(page, activity, origin) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
    try { await page.getByTestId('launch-countdown').first().waitFor({ timeout: 30_000 }); break; } catch (e) {
      await page.screenshot({ path: path.join(WORK_DIR, 'drop-lobby-fail.png') });
      if (attempt >= 3) throw e;
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.getByTestId('launch-countdown').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    {
      const { context, page, activity } = await setup(browser, images, server.origin, { opensInMs: (2 * 3600 + 14 * 60 + 5) * 1000 });
      await openProduct(page, activity, server.origin);
      await page.screenshot({ path: path.join(OUT, `${label}-lobby-393x852.png`) });
      if (label === 'after') {
        await page.getByTestId('launch-notify-me').first().click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, `${label}-lobby-notify-on-393x852.png`) });
      }
      await context.close();
    }
    if (label === 'after') {
      // Opens 6s after load: Buy is disabled in the lobby, then on at the second.
      const { context, page, activity } = await setup(browser, images, server.origin, { opensInMs: 40_000 });
      await openProduct(page, activity, server.origin);
      await page.screenshot({ path: path.join(OUT, `${label}-opening-before-393x852.png`) });
      await page.getByTestId('launch-countdown').first().waitFor({ state: 'detached', timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `${label}-opening-after-393x852.png`) });
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
