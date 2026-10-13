#!/usr/bin/env node
/**
 * Before/after screenshots of the buyer checkout's Order review at 390x844
 * (demo cast), scrolled through the page and with its sheets open. Same
 * build/serve/fake-API harness as scripts/store-screenshots.
 *
 *   node scripts/checkout-review-screenshots.mjs --tag after
 *   node scripts/checkout-review-screenshots.mjs --tag before --build-dir <dir> --skip-build
 *
 * The ZIP lookup (GET /api/geo/postal/US/:zip) answers 10012 → New York, NY,
 * as the real service does, so the autofill shows.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
  MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const TAG = arg('--tag') ?? 'after';
const ONLY = (arg('--only') ?? '').split(',').filter(Boolean);
const BUILD_DIR = arg('--build-dir') ?? path.join(WORK_DIR, `web-build-checkout-${TAG}`);
const OUTPUT_DIR = arg('--out') ?? path.resolve(MOBILE_ROOT, '..', '..', 'screenshots', 'checkout-review');

const DEVICE = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

const scrollCheckout = (page, fraction) => page.evaluate((f) => {
  const el = document.querySelector('[data-testid="checkout-scroll"]');
  const scroller = el && (el.scrollHeight > el.clientHeight ? el : [...el.querySelectorAll('div')].find(d => d.scrollHeight > d.clientHeight + 4));
  if (scroller) scroller.scrollTop = f >= 1 ? scroller.scrollHeight : scroller.scrollHeight * f;
}, fraction);

const tap = async (page, testId) => { await page.getByTestId(testId).first().click(); await page.waitForTimeout(700); };

/** Opens the address form: the after build's Ship to sheet, the before build's inline row. */
async function openAddress(page) {
  await tap(page, 'order-review-ship-to');
  const newAddress = page.getByTestId('checkout-new-address').first();
  if (await newAddress.isVisible().catch(() => false)) { await newAddress.click(); await page.waitForTimeout(500); }
}

const SHOTS = {
  top: async () => {},
  middle: async (page) => { await scrollCheckout(page, 0.45); },
  bottom: async (page) => { await scrollCheckout(page, 1); },
  'address-form': async (page) => { await openAddress(page); },
  'address-zip-autofill': async (page) => {
    await openAddress(page);
    const zip = page.getByTestId('checkout-zip').first();
    await zip.fill('');
    const city = page.getByTestId('checkout-city').first();
    await city.fill('');
    await zip.fill('10012');
    await page.waitForTimeout(1200);
  },
  'state-picker': async (page) => {
    await openAddress(page);
    await page.getByTestId('checkout-zip').first().fill('10012');
    await page.waitForTimeout(600);
    await tap(page, 'checkout-state');
  },
  'state-picker-search': async (page) => {
    await openAddress(page);
    await tap(page, 'checkout-state');
    const search = page.getByTestId('checkout-state-picker-search').first();
    if (await search.isVisible().catch(() => false)) { await search.fill('New'); await page.waitForTimeout(400); }
  },
  'country-picker': async (page) => { await openAddress(page); await tap(page, 'checkout-country'); },
};

async function main() {
  if (!args.includes('--skip-build')) {
    console.log(`Building preview web export (${TAG})...`);
    buildPreviewWeb(BUILD_DIR);
  }
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const names = ONLY.length ? ONLY : Object.keys(SHOTS);
  try {
    for (const name of names) {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
      await context.route('**/geo/postal/US/*', (route) => {
        const zip = new URL(route.request().url()).pathname.split('/').pop();
        const cors = {
          'access-control-allow-origin': origin,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'authorization,content-type,x-store-context',
          'access-control-allow-methods': 'GET,OPTIONS',
        };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (zip !== '10012') return route.fulfill({ status: 404, headers: cors, contentType: 'application/json', body: '{"error":"ZIP code not found"}' });
        return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ postalCode: '10012', city: 'New York', state: 'NY', country: 'US' }) });
      });
      try {
        const target = '/thread-checkout?source=cart';
        await openScreen(page, activity, origin, 'buyer', target, { extraQuery: '&demo=1' });
        // The first client-side push can land before the navigator settles
        // (it stays on the feed): push again until checkout shows.
        for (let attempt = 0; attempt < 3; attempt++) {
          await page.waitForTimeout(1500);
          if (await page.getByTestId('checkout-scroll').first().isVisible().catch(() => false)) break;
          await page.evaluate((url) => {
            history.pushState(history.state, '', url);
            window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
          }, `${target}&bt_preview=buyer&demo=1`);
        }
        await waitForQuietNetwork(activity);
        await waitForImages(page);
        await SHOTS[name](page);
        await page.waitForTimeout(500);
        const file = path.join(OUTPUT_DIR, `${TAG}-${name}.png`);
        await page.screenshot({ path: file });
        console.log(`  wrote ${file}`);
      } catch (error) {
        console.warn(`  skipped ${TAG}-${name}: ${error.message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
