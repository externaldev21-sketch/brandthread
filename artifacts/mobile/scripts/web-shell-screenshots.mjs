#!/usr/bin/env node
/**
 * One-off desktop/tablet web-shell screenshots for the PR that introduced
 * WebAppShell (components/web/WebAppShell.tsx). Reuses the same
 * build/serve/demo-data harness as scripts/store-screenshots, at two web
 * viewport sizes the owner asked to see: 1440x900 (desktop) and 768x1024
 * (tablet portrait). Not part of the regular store-screenshots pipeline —
 * run manually:
 *
 *   node scripts/web-shell-screenshots.mjs
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
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { MOBILE_ROOT, WORK_DIR, DEFAULT_BUILD_DIR } from './store-screenshots/harness.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'web-shell');

const VIEWPORTS = [
  { id: '1440x900', width: 1440, height: 900 },
  { id: '768x1024', width: 768, height: 1024 },
];

const SCREENS = [
  { id: 'buyer-feed', role: 'buyer', path: '/(buyer)', ready: 'Drop 04 is live' },
  { id: 'payouts', role: 'seller', path: '/payouts', ready: '$1,842.50' },
  { id: 'manufacturer-hub', role: 'seller', path: '/manufacturer-hub', ready: 'Porto Knit Collective' },
  { id: 'seller-settings', role: 'seller', path: '/seller-settings', ready: 'Settings' },
];

async function main() {
  if (!process.argv.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  try {
    for (const viewport of VIEWPORTS) {
      for (const screen of SCREENS) {
        const device = {
          viewport: { width: viewport.width, height: viewport.height },
          scale: 1,
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          isMobile: false,
        };
        const { context, page, activity } = await openContext(browser, {
          device,
          role: screen.role,
          origin,
          images,
        });
        try {
          await openScreen(page, activity, origin, screen.role, screen.path);
          await page.waitForSelector(`text=${screen.ready}`, { timeout: 15_000 }).catch(() => {});
          await waitForImages(page);
          await waitForQuietNetwork(activity);
          await page.waitForTimeout(400);
          const file = path.join(OUTPUT_DIR, `${viewport.id}-${screen.role}-${screen.id}.png`);
          await page.screenshot({ path: file });
          console.log(`  wrote ${file}`);
        } catch (error) {
          console.warn(`  skipped ${viewport.id}-${screen.role}-${screen.id}: ${error.message}`);
        } finally {
          await context.close();
        }
      }
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
