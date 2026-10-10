#!/usr/bin/env node
/**
 * Captures every main buyer + seller screen for the consistency pass:
 * 390x844 fresh account and &demo=1, plus iPad (1032x1376) with demo data.
 * Waits for the screen to load (network quiet + images) instead of fixed
 * "ready" strings, so it keeps working as copy and demo data change.
 *
 *   node scripts/store-screenshots/main-screens-capture.mjs --out <dir> [--build] [--only a,b]
 */
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { BUYER_USER } from './demo-data.mjs';

export const MAIN_SCREENS = [
  { id: 'buyer-feed', role: 'buyer', path: '/(buyer)' },
  { id: 'buyer-discover', role: 'buyer', path: '/(buyer)/discover' },
  { id: 'buyer-search', role: 'buyer', path: '/buyer-search' },
  { id: 'buyer-inbox', role: 'buyer', path: '/(buyer)/inbox' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile' },
  { id: 'buyer-product', role: 'buyer', path: '/buyer-product-detail?productId=prod_nl_jacket_rust' },
  { id: 'buyer-cart', role: 'buyer', path: '/(buyer)/cart' },
  { id: 'buyer-checkout', role: 'buyer', path: '/buyer-checkout?source=cart' },
  { id: 'buyer-orders', role: 'buyer', path: '/(buyer)/orders' },
  { id: 'buyer-menu', role: 'buyer', path: '/buyer-settings-menu' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)' },
  { id: 'seller-orders', role: 'seller', path: '/(tabs)/orders' },
  { id: 'seller-products', role: 'seller', path: '/(tabs)/products' },
  { id: 'seller-product', role: 'seller', path: '/product-detail?id=prod_nl_hoodie_ember' },
  { id: 'seller-add-product', role: 'seller', path: '/add-product' },
  { id: 'seller-analytics', role: 'seller', path: '/(tabs)/analytics' },
  { id: 'seller-settings', role: 'seller', path: '/seller-settings' },
  { id: 'seller-profile', role: 'seller', path: '/(tabs)/profile' },
];

const VARIANTS = [
  { id: 'phone', viewport: { width: 390, height: 844 }, demo: false },
  { id: 'phone-demo', viewport: { width: 390, height: 844 }, demo: true },
  { id: 'ipad-demo', viewport: { width: 1032, height: 1376 }, demo: true },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const out = path.resolve(arg('--out') ?? 'scratch/main-screens');
  const only = arg('--only')?.split(',');
  mkdirSync(out, { recursive: true });
  if (process.argv.includes('--build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb();
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(path.dirname(DEFAULT_BUILD_DIR), 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    for (const screen of MAIN_SCREENS.filter((s) => !only || only.includes(s.id))) {
      for (const v of VARIANTS) {
        const device = { viewport: v.viewport, scale: 2, isMobile: true };
        const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
        const file = path.join(out, `${screen.id}-${v.id}.png`);
        try {
          if (screen.role === 'buyer') {
            await context.addInitScript((key) => { try { localStorage.setItem(key, '1'); } catch {} }, `feed_gesture_guide_seen:${BUYER_USER.id}`);
          }
          // The app remounts its navigator once Clerk signs in, which can swallow
          // the first client-side navigation: retry until the URL sticks.
          const want = screen.path.replace(/\/\([a-z]+\)/g, '').split('?')[0] || '/';
          for (let attempt = 0; attempt < 4; attempt++) {
            await openScreen(page, activity, origin, screen.role, screen.path, { extraQuery: v.demo ? '&demo=1' : '' });
            await page.waitForTimeout(2500);
            const at = await page.evaluate(() => location.pathname.replace(/\/\([a-z]+\)/g, '') || '/');
            if (at === want) break;
          }
          await waitForQuietNetwork(activity, 900, 15_000);
          await waitForImages(page, 8_000);
          await page.waitForTimeout(2500);
          await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
          console.log(`ok ${screen.id} ${v.id}`);
        } catch (e) {
          console.log(`FAILED ${screen.id} ${v.id} ${String(e.message).split('\n')[0]}`);
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

main().catch((e) => { console.error(e); process.exit(1); });
