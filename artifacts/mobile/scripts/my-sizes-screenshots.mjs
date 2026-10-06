#!/usr/bin/env node
/**
 * Verification screenshots for item 117 ("Drafts saved + resume") — the
 * buyer-side half. The seller side already had this (Published/Drafts/
 * Scheduled filter in app/(tabs)/profile.tsx); this PR mirrors the same
 * Published/Drafts pattern onto app/(buyer)/profile.tsx (buyers can't
 * schedule, so no Scheduled filter) and fixes the two server-side bugs that
 * silently blocked it: GET /api/social/profile/:userId/posts excluded every
 * draft unconditionally (even the caller's own), and hardcoded `isDraft:
 * false` in every mapped row regardless of actual status.
 *
 *   node scripts/my-sizes-screenshots.mjs
 *   node scripts/my-sizes-screenshots.mjs --skip-build
 *
 * Output: docs/polish/screenshots/my-sizes/ours/<viewport>/<NN-step>.png
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const OUTPUT_ROOT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'buyer-saved-sizes');

const VIEWPORTS = [
  { id: '393x852', width: 393, height: 852 },
];

async function openScreenReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(500);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect after 5 attempts`);
}

async function shot(page, dir, index, name) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function runViewport(browser, { origin, viewport }) {
  console.log(`\n== ${viewport.id} ==`);
  const outDir = path.join(OUTPUT_ROOT, viewport.id);
  const device = { viewport: { width: viewport.width, height: viewport.height }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images: {} });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  let index = 0;

  try {
    await openScreenReliably(page, activity, origin, 'buyer', '/buyer-my-sizes');
    await page.waitForTimeout(1500);
    await shot(page, outDir, ++index, 'my-sizes');
    await page.evaluate(() => window.scrollTo(0, 99999)); await page.mouse.wheel(0, 1200); await page.waitForTimeout(400);
    await shot(page, outDir, ++index, 'my-sizes-measurements');
  } catch (error) {
    console.error(`  ✗ ${viewport.id}: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, outDir, ++index, 'FAILED-state').catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build');
  rmSync(OUTPUT_ROOT, { recursive: true, force: true });

  if (!skipBuild) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();

  try {
    for (const viewport of VIEWPORTS) {
      await runViewport(browser, { origin, viewport });
    }
  } finally {
    await browser.close();
    close();
  }
  console.log(`\nDone. Screenshots in ${path.relative(MOBILE_ROOT, OUTPUT_ROOT)}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
