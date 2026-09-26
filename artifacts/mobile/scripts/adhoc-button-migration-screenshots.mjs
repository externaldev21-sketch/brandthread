#!/usr/bin/env node
/**
 * Before/after evidence for the app-wide ad-hoc-button migration PR: the
 * inbox.tsx message-request Accept/Decline bug (already fixed and shipped)
 * plus a representative sample of the newly-migrated screens.
 *
 *   node scripts/adhoc-button-migration-screenshots.mjs --tag after
 *   node scripts/adhoc-button-migration-screenshots.mjs --tag before
 */
import { mkdirSync } from 'node:fs';
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
const BUILD_DIR = path.join(WORK_DIR, `web-build-adhoc-${TAG}`);

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'adhoc-button-migration');
const VIEWPORT = { width: 390, height: 844 };

const SCREENS = [
  { role: 'seller', path: '/security', name: 'seller-security' },
  { role: 'seller', path: '/(tabs)/orders', name: 'seller-orders' },
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

  const device = {
    viewport: VIEWPORT,
    scale: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    isMobile: true,
  };

  async function capture(screen) {
    const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
    try {
      await openScreen(page, activity, origin, screen.role, screen.path);
      await page.waitForTimeout(700);
      await waitForImages(page);
      await waitForQuietNetwork(activity);
      await page.waitForTimeout(300);
      const file = path.join(OUTPUT_DIR, `${TAG}-390x844-${screen.name}.png`);
      await page.screenshot({ path: file });
      console.log(`  wrote ${file}`);
    } catch (error) {
      console.warn(`  skipped ${TAG}-${screen.name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  try {
    for (const screen of SCREENS) {
      await capture(screen);
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
