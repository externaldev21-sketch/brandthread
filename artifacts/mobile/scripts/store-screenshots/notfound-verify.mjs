#!/usr/bin/env node
/**
 * One-off live verification for the +not-found screen fix — not part of the
 * store screenshot pipeline. Captures at 393x852 (the audit's own viewport)
 * by navigating straight to a genuinely nonexistent route, which Expo
 * Router falls through to app/+not-found.tsx.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/notfound-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, 'docs/pr-review/notfound-screen-and-audit-gate/393'));
mkdirSync(OUT, { recursive: true });

const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };

async function shootScreen(browser, images, origin, role, target, filename) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await page.goto(`${origin}${target}?bt_preview=${role}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 500, 8_000);
  await page.waitForTimeout(600);
  await waitForImages(page, 6_000);
  await page.screenshot({ path: path.join(OUT, filename) });
  console.log(`Captured ${filename}: ${page.url()}`);
  await context.close();
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await shootScreen(browser, images, origin, 'seller', '/this-route-does-not-exist-xyz', 'not-found.png');
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
