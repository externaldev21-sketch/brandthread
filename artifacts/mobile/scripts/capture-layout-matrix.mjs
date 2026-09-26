#!/usr/bin/env node
/**
 * Manual layout-review screenshots: the same ~12 key screens as
 * tests/layout-audit.spec.ts, captured as full-page PNGs at 5 representative
 * sizes (smallest phone through desktop web), for a human to eyeball.
 *
 *   pnpm run capture:layout-matrix                  build, then capture everything
 *   pnpm run capture:layout-matrix -- --skip-build   reuse the last preview web build
 *   pnpm run capture:layout-matrix -- --only buyer-feed,seller-dashboard
 *
 * Output: scratch/layout-screenshots/<screen>-<size>.png (gitignored scratch
 * output — see .gitignore's `scratch/` entry — never committed).
 *
 * Reuses the same demo web build, fake Clerk/API and preview-role bypass as
 * scripts/store-screenshots/ (see that directory's harness.mjs for how the
 * `?bt_preview=buyer|seller` dev-only bypass works). No real account, order
 * or payment is involved.
 */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER } from './store-screenshots/demo-data.mjs';

export const OUTPUT_DIR = path.join(MOBILE_ROOT, 'scratch', 'layout-screenshots');

// 5 representative sizes (owner's device matrix, smallest through desktop).
const SIZES = [
  { id: 'smallest-phone', width: 320, height: 568, label: 'Smallest phone (iPhone SE 1st gen)' },
  { id: 'standard-phone', width: 390, height: 844, label: 'Standard phone (iPhone 12/13/14)' },
  { id: 'pro-max', width: 430, height: 932, label: 'iPhone Pro Max' },
  { id: 'ipad', width: 768, height: 1024, label: 'iPad portrait' },
  { id: 'desktop', width: 1440, height: 900, label: 'Web / desktop' },
];

// Same ~12 key screens as tests/layout-audit.spec.ts (kept in sync by hand —
// both files are small and reviewed together).
export const SCREENS = [
  { id: 'buyer-feed', role: 'buyer', path: '/(buyer)', ready: 'Drop 04 is live' },
  { id: 'discover', role: 'buyer', path: '/discover', ready: 'Heavyweight Hoodie — Ember' },
  { id: 'buyer-cart', role: 'buyer', path: '/cart', ready: 'Order summary' },
  { id: 'buyer-checkout', role: 'buyer', path: '/buyer-checkout?source=cart', ready: '1120 NW Everett Street' },
  { id: 'buyer-product-detail', role: 'buyer', path: '/buyer-product-detail?productId=prod_nl_jacket_rust', ready: 'Field Shell Jacket — Rust' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile', ready: '@jordanreyes' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)', ready: '$1,842.50' },
  { id: 'seller-orders', role: 'seller', path: '/(tabs)/orders', ready: 'Orders' },
  { id: 'seller-products', role: 'seller', path: '/(tabs)/products', ready: 'Products' },
  { id: 'seller-settings', role: 'seller', path: '/seller-settings', ready: 'Settings' },
  { id: 'manufacturer-hub', role: 'seller', path: '/manufacturer-hub', ready: 'Porto Knit Collective' },
  { id: 'theme-picker', role: 'seller', path: '/app-theme', ready: 'Choose your Brandthread finish' },
];

function parseArgs(argv) {
  const options = { skipBuild: false, only: null, sizes: null, buildDir: DEFAULT_BUILD_DIR };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') continue;
    else if (arg === '--skip-build') options.skipBuild = true;
    else if (arg === '--only') options.only = argv[++i].split(',');
    else if (arg === '--sizes') options.sizes = argv[++i].split(',');
    else if (arg === '--build-dir') options.buildDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

async function captureOne(browser, { screen, size, origin, file }) {
  const device = { viewport: { width: size.width, height: size.height }, scale: 1, isMobile: size.width < 700, userAgent: undefined };
  const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images: {} });
  try {
    if (screen.role === 'buyer') {
      // Suppress the one-time "Watching Threads" gesture-coach overlay so
      // the screenshot shows the steady-state screen, not a first-run tip.
      await context.addInitScript((key) => {
        try { localStorage.setItem(key, '1'); } catch {}
      }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
    }
    await openScreen(page, activity, origin, screen.role, screen.path);
    await page.getByText(screen.ready, { exact: false }).first().waitFor({ timeout: 30_000 });
    await waitForQuietNetwork(activity);
    await waitForImages(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: file, fullPage: true, animations: 'disabled', caret: 'hide' });
    return { status: 'captured' };
  } catch (error) {
    return { status: 'skipped', reason: String(error?.message ?? error).split('\n')[0] };
  } finally {
    await context.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const screens = SCREENS.filter((s) => !options.only || options.only.includes(s.id));
  const sizes = SIZES.filter((s) => !options.sizes || options.sizes.includes(s.id));
  if (!screens.length || !sizes.length) throw new Error('Nothing to capture: check --only / --sizes.');

  if (!options.skipBuild || !existsSync(path.join(options.buildDir, 'index.html'))) {
    console.log('Building the web app in preview mode (a few minutes)…');
    buildPreviewWeb(options.buildDir);
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const server = await serveBuild(options.buildDir);
  const browser = await launchBrowser();
  const results = [];
  try {
    for (const screen of screens) {
      for (const size of sizes) {
        const file = path.join(OUTPUT_DIR, `${screen.id}-${size.id}.png`);
        rmSync(file, { force: true });
        const result = await captureOne(browser, { screen, size, origin: server.origin, file });
        results.push({ screen: screen.id, size: size.id, ...result });
        const mark = result.status === 'captured' ? '✓' : '✗';
        console.log(`${mark} ${screen.id.padEnd(24)} ${size.id.padEnd(16)}${result.reason ? `  (${result.reason})` : ''}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  const skipped = results.filter((r) => r.status !== 'captured');
  console.log(`\n${results.length - skipped.length}/${results.length} screenshots saved to ${path.relative(process.cwd(), OUTPUT_DIR) || '.'}/`);
  if (skipped.length) console.log(`${skipped.length} skipped.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}`);
    process.exit(1);
  });
}
