#!/usr/bin/env node
/**
 * Home For You empty state (no seller posts) at 393x852: the "Shop products"
 * action and the trending products rail. Forces the empty state by answering
 * the feed sources with no posts; trending products come from the demo
 * product fixtures. Reuses a cached web build when there is one.
 *
 *   node scripts/for-you-empty-screenshots.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR, DEFAULT_BUILD_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { respond } from './store-screenshots/demo-data.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'screenshots', 'revenue-p1', 'buyer-engagement');
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const withRail of [true, false]) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
      const cors = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'authorization,content-type,x-store-context',
      };
      const json = (route, body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      // No posts and no live drops from followed sellers (a launch-day buyer).
      await context.route(/\/api(\/v1)?\/(public\/posts|posts\/feed|public\/drops)(\?|$)/, (route) => (
        route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : json(route, [])
      ));
      await context.route(/\/api(\/v1)?\/feed\/for-you(\?|$)/, (route) => (
        route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : json(route, { items: [], nextOffset: null })
      ));
      await context.route(/\/api(\/v1)?\/public\/trending\/products(\?|$)/, (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        const products = withRail
          ? respond({ method: 'GET', path: '/api/public/products/high-demand', query: new URLSearchParams('limit=8'), role: 'buyer' })
          : [];
        return json(route, { windowDays: 7, products });
      });
      await openScreen(page, activity, origin, 'buyer', '/(buyer)');
      await page.waitForSelector('text=Shop products', { timeout: 30_000 });
      await waitForQuietNetwork(activity);
      await waitForImages(page);
      await page.waitForTimeout(800);
      const name = withRail ? 'for-you-empty-shop-393x852.png' : 'for-you-empty-shop-no-trending-393x852.png';
      await page.screenshot({ path: path.join(OUTPUT_DIR, name) });
      console.log('saved', name);
      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
