#!/usr/bin/env node
/**
 * Price history chart + "Tell me if the price drops" on the product page, at
 * 393x852 on the store-screenshots harness (signed-in demo buyer, fake API).
 * The price history, the buyer's saved list (so the product reads as saved)
 * and the per-item alert are served here; the alert PUT is echoed back.
 *
 *   node scripts/price-history-screenshots.mjs --build <web export dir> --tag <before|after>
 *
 * Output: docs/pr-assets/price-history/<tag>-*.jpg
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';
import {
  MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BUILD = path.resolve(arg('build', path.join(WORK_DIR, 'web-build')));
const TAG = arg('tag', 'after');
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/price-history');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';
const DAY = 86_400_000;
// The page clock is frozen at DEMO_NOW, so the history is dated from it.
const NOW = new Date(DEMO_NOW).getTime();
const HISTORY = {
  changed: true,
  points: [
    { priceCents: 26000, at: new Date(NOW - 90 * DAY).toISOString() },
    { priceCents: 24000, at: new Date(NOW - 52 * DAY).toISOString() },
    { priceCents: 22000, at: new Date(NOW - 11 * DAY).toISOString() },
  ],
};

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  let alertOn = false;
  await context.route((url) => url.pathname.includes('/price-history') || url.pathname.includes('/price-alert') || url.pathname.endsWith('/buyer/saved'), (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname;
    if (p.includes('/price-history')) return route.fulfill(json(origin, HISTORY));
    if (p.includes('/price-alert')) {
      if (req.method() === 'PUT') alertOn = !!JSON.parse(req.postData() || '{}').enabled;
      return route.fulfill(json(origin, { saved: true, enabled: alertOn }));
    }
    return route.fulfill(json(origin, [{
      id: 'saved-1', type: 'product', targetId: PRODUCT, title: 'Field Shell Jacket — Rust', savedAt: new Date(NOW - 20 * DAY).toISOString(),
      priceDropAlert: alertOn,
    }]));
  });
  return { context, page, activity };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log('wrote', `${TAG}-${name}.jpg`);
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const { context, page, activity } = await setup(browser, images, server.origin);
    for (let attempt = 0; ; attempt++) {
      await openScreen(page, activity, server.origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
      try { await page.getByRole('radio', { name: /^Size, / }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
    }
    await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(1200);
    // Frame the size chips → (price history) → seller row.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="product-price-history"]') ?? document.querySelector('[data-testid="product-seller-link"]');
      el?.scrollIntoView({ block: 'center' });
    });
    await page.waitForTimeout(500);
    await shot(page, 'pdp');
    const toggle = page.getByTestId('product-price-alert').getByRole('switch');
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(700);
      await shot(page, 'pdp-alert-on');
    }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
