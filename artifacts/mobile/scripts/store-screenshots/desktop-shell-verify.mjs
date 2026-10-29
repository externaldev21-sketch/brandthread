#!/usr/bin/env node
/**
 * Desktop web shell check (components/web/DesktopShell.tsx).
 *
 * Captures the main buyer + seller screens at desktop sizes (1440x900,
 * 1280x800) — sidebar, top bar, multi-column content — and at the phone size
 * (390x844) and the tablet column size (900x1100), where the app must look exactly as it did before the desktop
 * shell existed. With --compare <baselineDir>, every phone capture is diffed
 * pixel-for-pixel against a capture of the same screen from a build made
 * before the change, and the run fails if any pixel differs.
 *
 *   node scripts/store-screenshots/desktop-shell-verify.mjs --out <dir> [--build-dir <dir>] [--variants desktop,laptop,tablet,phone] [--only a,b] [--compare <dir>] [--fresh]
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

const SCREENS = [
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)' },
  { id: 'seller-products', role: 'seller', path: '/(tabs)/products' },
  { id: 'seller-orders', role: 'seller', path: '/(tabs)/orders' },
  { id: 'seller-analytics', role: 'seller', path: '/(tabs)/analytics' },
  { id: 'seller-more', role: 'seller', path: '/(tabs)/more' },
  { id: 'seller-profile', role: 'seller', path: '/(tabs)/profile' },
  { id: 'seller-store-builder', role: 'seller', path: '/store-builder' },
  { id: 'seller-settings', role: 'seller', path: '/seller-settings' },
  { id: 'seller-inbox', role: 'seller', path: '/seller-inbox' },
  { id: 'buyer-feed', role: 'buyer', path: '/(buyer)' },
  { id: 'buyer-discover', role: 'buyer', path: '/(buyer)/discover' },
  { id: 'buyer-product', role: 'buyer', path: '/buyer-product-detail?productId=prod_nl_jacket_rust' },
  { id: 'buyer-inbox', role: 'buyer', path: '/(buyer)/inbox' },
  { id: 'buyer-activity', role: 'buyer', path: '/(buyer)/activity' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile' },
];

const VARIANTS = {
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false },
  laptop: { viewport: { width: 1280, height: 800 }, isMobile: false },
  tablet: { viewport: { width: 900, height: 1100 }, isMobile: false },
  phone: { viewport: { width: 390, height: 844 }, isMobile: true },
};

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function diffPngs(a, b) {
  const left = PNG.sync.read(readFileSync(a));
  const right = PNG.sync.read(readFileSync(b));
  if (left.width !== right.width || left.height !== right.height) return { differing: Infinity };
  let differing = 0;
  for (let i = 0; i < left.data.length; i += 4) {
    if (left.data[i] !== right.data[i] || left.data[i + 1] !== right.data[i + 1] || left.data[i + 2] !== right.data[i + 2]) differing++;
  }
  return { differing };
}

/** Elements whose box spills past the viewport's right edge (horizontal clipping). */
async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scrollW = document.documentElement.scrollWidth;
    return { pageScrollsHorizontally: scrollW > vw + 1 };
  });
}

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/desktop-shell');
  const buildDir = path.resolve(arg('--build-dir') ?? DEFAULT_BUILD_DIR);
  const compare = arg('--compare') ? path.resolve(arg('--compare')) : null;
  const only = arg('--only')?.split(',');
  // Demo data (a set-up store with products and orders) by default; --fresh for a new account.
  const demo = !process.argv.includes('--fresh');
  const variants = (arg('--variants') ?? 'desktop,laptop,phone').split(',');
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(buildDir, 'index.html'))) buildPreviewWeb(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(buildDir);
  const failures = [];
  try {
    for (const screen of SCREENS.filter((s) => !only || only.includes(s.id))) {
      for (const variantId of variants) {
        const v = VARIANTS[variantId];
        const device = { viewport: v.viewport, scale: 1, isMobile: v.isMobile };
        const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
        const file = path.join(out, `${screen.id}-${variantId}.png`);
        try {
          if (screen.role === 'buyer') {
            await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
          }
          // The app remounts its navigator once Clerk signs in, which can swallow
          // the first client-side navigation: retry until the URL sticks.
          const want = screen.path.replace(/\/\([a-z]+\)/g, '').split('?')[0] || '/';
          for (let attempt = 0; attempt < 4; attempt++) {
            await openScreen(page, activity, origin, screen.role, screen.path, { extraQuery: demo ? '&demo=1' : '' });
            await page.waitForTimeout(2500);
            const at = await page.evaluate(() => location.pathname.replace(/\/\([a-z]+\)/g, '') || '/');
            if (at === want) break;
          }
          await waitForQuietNetwork(activity, 900, 15_000);
          // The seller dashboard opens the "Set up your store" walkthrough
          // once; close it so the dashboard itself is what gets captured.
          const later = page.getByText('Continue setup later');
          if (await later.isVisible().catch(() => false)) {
            await later.click();
            await page.waitForTimeout(1200);
          }
          await waitForImages(page, 8_000);
          await page.waitForTimeout(2500);
          await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
          const overflow = await overflowReport(page);
          if (overflow.pageScrollsHorizontally) failures.push(`${screen.id} ${variantId}: page scrolls horizontally`);
          let note = '';
          if (compare && variantId !== 'desktop' && variantId !== 'laptop') {
            const baseline = path.join(compare, `${screen.id}-${variantId}.png`);
            if (existsSync(baseline)) {
              const { differing } = diffPngs(baseline, file);
              note = ` diff=${differing}px`;
              if (differing > 0) failures.push(`${screen.id} ${variantId}: ${differing} pixels differ from baseline`);
            } else {
              note = ' (no baseline)';
            }
          }
          console.log(`ok ${screen.id} ${variantId}${note}`);
        } catch (e) {
          failures.push(`${screen.id} ${variantId}: ${String(e.message).split('\n')[0]}`);
          console.log(`FAILED ${screen.id} ${variantId} ${String(e.message).split('\n')[0]}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    close();
  }
  if (failures.length) {
    console.log(`\n${failures.length} problem(s):\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
