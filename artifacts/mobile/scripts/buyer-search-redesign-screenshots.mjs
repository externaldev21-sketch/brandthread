#!/usr/bin/env node
/**
 * Before/after screenshots for the Buyer Search redesign. Reuses the same
 * build/serve/demo-data harness as scripts/store-screenshots.
 *
 *   node scripts/buyer-search-redesign-screenshots.mjs --tag after
 *   node scripts/buyer-search-redesign-screenshots.mjs --tag before
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
  MOBILE_ROOT,
  WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const tagIndex = args.indexOf('--tag');
const TAG = tagIndex >= 0 ? args[tagIndex + 1] : 'after';
const BUILD_DIR = path.join(WORK_DIR, `web-build-${TAG}`);

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'buyer-search-redesign');

const VIEWPORTS = [
  { id: '390x844', width: 390, height: 844, isMobile: true },
  { id: '1440x900', width: 1440, height: 900, isMobile: false },
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

  async function capture(viewport, name, { query } = {}) {
    const device = {
      viewport: { width: viewport.width, height: viewport.height },
      scale: 1,
      userAgent: viewport.isMobile
        ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
        : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      isMobile: viewport.isMobile,
    };
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    try {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)/search');
      if (query) {
        await page.waitForTimeout(500);
        // The query field lives in the buyer tab bar (BuyerSearchContext),
        // not on this screen itself — it becomes the active search field
        // once this route is active. Type into it like a real keystroke so
        // the screen's own 350ms debounce drives the results state.
        await page.getByPlaceholder('Search').first().fill(query);
        await page.waitForTimeout(900);
      } else {
        await page.waitForTimeout(500);
      }
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(300);
      const file = path.join(OUTPUT_DIR, `${TAG}-${viewport.isMobile ? 'mobile' : 'desktop'}-${viewport.id}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`  wrote ${file}`);
    } catch (error) {
      console.warn(`  skipped ${TAG}-${viewport.id}-${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  try {
    for (const viewport of VIEWPORTS) {
      await capture(viewport, 'empty');
      await capture(viewport, 'results', { query: 'hoodie' });
    }
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
