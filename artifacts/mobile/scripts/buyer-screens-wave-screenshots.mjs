#!/usr/bin/env node
/**
 * Before/after screenshots for the "Buyer screens" wave (bag, product page,
 * order review, order page, search, Discover, Following) at 390x844, for a
 * fresh account and the demo cast (&demo=1). Same build/serve/fake-API
 * harness as scripts/store-screenshots.
 *
 *   node scripts/buyer-screens-wave-screenshots.mjs --tag after --only bag,product
 *   node scripts/buyer-screens-wave-screenshots.mjs --tag before --skip-build
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
const BUILD_DIR = path.join(WORK_DIR, `web-build-wave-${TAG}`);
const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'buyer-screens-wave');

const DEVICE = {
  viewport: { width: 390, height: 844 },
  scale: 1,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

/** name → target route, plus optional interaction after load. */
const SCREENS = {
  bag: { target: '/(buyer)/cart' },
  'bag-scrolled': { target: '/(buyer)/cart', after: async (page) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, 900); } },
  product: { target: '/buyer-product-detail?productId=prod_nl_hoodie_ember' },
  'product-scrolled': { target: '/buyer-product-detail?productId=prod_nl_hoodie_ember', after: async (page) => { await page.mouse.move(195, 420); await page.mouse.wheel(0, 900); } },
  'product-size-sheet': {
    target: '/buyer-product-detail?productId=prod_nl_hoodie_ember',
    after: async (page) => { await page.getByTestId('product-size-row').first().click(); },
  },
  'product-size-picked': {
    target: '/buyer-product-detail?productId=prod_nl_hoodie_ember',
    after: async (page) => {
      await page.getByTestId('product-size-row').first().click();
      await page.waitForTimeout(400);
      await page.getByTestId('size-sheet-option-M').first().click();
    },
  },
  checkout: { target: '/thread-checkout?source=cart' },
  orders: { target: '/(buyer)/orders' },
  search: { target: '/buyer-search' },
  discover: { target: '/(buyer)/discover' },
  following: { target: '/(buyer)/following' },
};

const MODES = [
  { id: 'fresh', apiOptions: { fresh: true }, extraQuery: '' },
  { id: 'demo', apiOptions: {}, extraQuery: '&demo=1' },
];

async function main() {
  if (!args.includes('--skip-build')) {
    console.log(`Building preview web export (${TAG})...`);
    buildPreviewWeb(BUILD_DIR);
  }
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const names = ONLY.length ? ONLY : Object.keys(SCREENS);
  try {
    for (const name of names) {
      const screen = SCREENS[name];
      if (!screen) { console.warn(`unknown screen ${name}`); continue; }
      for (const mode of MODES) {
        const { context, page, activity } = await openContext(browser, {
          device: DEVICE, role: 'buyer', origin, images, apiOptions: mode.apiOptions,
        });
        try {
          await openScreen(page, activity, origin, 'buyer', screen.target, { extraQuery: mode.extraQuery });
          await page.waitForTimeout(1200);
          // The first client-side push sometimes lands before the navigator
          // settles (it stays on the feed); push once more if the feed is
          // still showing.
          if (await page.getByText('Threads', { exact: true }).first().isVisible().catch(() => false)) {
            await page.evaluate((url) => {
              history.pushState(history.state, '', url);
              window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
            }, `${screen.target}${screen.target.includes('?') ? '&' : '?'}bt_preview=buyer${mode.extraQuery}`);
            await page.waitForTimeout(1500);
          }
          await waitForQuietNetwork(activity);
          if (screen.after) { await screen.after(page); await page.waitForTimeout(700); }
          await waitForImages(page);
          await page.waitForTimeout(300);
          const file = path.join(OUTPUT_DIR, `${TAG}-${name}-${mode.id}.png`);
          await page.screenshot({ path: file });
          console.log(`  wrote ${file}`);
        } catch (error) {
          console.warn(`  skipped ${TAG}-${name}-${mode.id}: ${error.message}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
