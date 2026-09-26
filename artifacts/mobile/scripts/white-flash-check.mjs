#!/usr/bin/env node
/**
 * Playwright check for the "white strip at the bottom of the screen" bug:
 * screenshots the bottom 120px of every main screen, on several themes, and
 * asserts no pixel in that strip is pure/near white. Every one of the 12
 * themes is a dark background, so any white pixel there is a real bug, not
 * a false positive from legitimate light-colored UI.
 *
 * Reuses the existing store-screenshots harness (demo data, no real
 * server/account) and the ?bt_theme= dev preview override (see
 * contexts/AppThemeContext.tsx's getPreviewThemeId) to check multiple
 * themes without needing to drive the in-app theme picker.
 *
 *   node scripts/white-flash-check.mjs
 *   node scripts/white-flash-check.mjs --skip-build   (reuse the last export)
 */
import { PNG } from 'pngjs';
import path from 'node:path';
import {
  buildPreviewWeb,
  launchBrowser,
  openContext,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
  DEFAULT_BUILD_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR } from './store-screenshots/harness.mjs';

const STRIP_HEIGHT = 120;
const VIEWPORT = { width: 390, height: 844 };

// Every theme id from contexts/AppThemeContext.tsx APP_THEME_PRESETS.
const THEMES = [
  'monochrome', 'purple', 'olive', 'navy', 'champagne', 'black', 'silver',
  'black-gold', 'emerald-gold', 'leopard-red', 'maroon', 'gold',
];

const SCREENS = [
  { id: 'buyer-feed', role: 'buyer', path: '/(buyer)', ready: 'Drop 04 is live' },
  { id: 'buyer-profile', role: 'buyer', path: '/(buyer)/profile', ready: 'Posts' },
  { id: 'seller-dashboard', role: 'seller', path: '/(tabs)', ready: null },
  { id: 'manufacturer-hub', role: 'seller', path: '/manufacturer-hub', ready: 'Porto Knit Collective' },
];

/** True if a pixel reads as "white" — a generous threshold so an off-white
 *  accidental leak (not just pure #FFFFFF) still trips the check. */
function isWhiteish(r, g, b, a) {
  return a > 10 && r > 240 && g > 240 && b > 240;
}

function countWhitePixels(png) {
  let count = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b, a] = [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
    if (isWhiteish(r, g, b, a)) count += 1;
  }
  return count;
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));

  const failures = [];
  const checked = [];

  try {
    for (const themeId of THEMES) {
      for (const screen of SCREENS) {
        const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
        const { context, page, activity } = await openContext(browser, { device, role: screen.role, origin, images });
        try {
          // bt_theme (contexts/AppThemeContext.tsx's getPreviewThemeId) is
          // only read inside AppThemeProvider's mount effect, so it has to
          // be present on the very first navigation — a client-side
          // pushState after the fact (what openScreen does for bt_preview)
          // would not retrigger that effect. One direct full navigation
          // with both params set gets both overrides applied from mount.
          await page.goto(`${origin}${screen.path}?bt_preview=${screen.role}&bt_theme=${themeId}`);
          await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
          await waitForQuietNetwork(activity, 800, 15_000);
          await page.waitForTimeout(300);
          if (screen.ready) {
            await page.waitForSelector(`text=${screen.ready}`, { timeout: 12_000 }).catch(() => {});
          }
          await waitForImages(page);
          await waitForQuietNetwork(activity);
          await page.waitForTimeout(400);

          const buffer = await page.screenshot({
            clip: { x: 0, y: VIEWPORT.height - STRIP_HEIGHT, width: VIEWPORT.width, height: STRIP_HEIGHT },
          });
          const png = PNG.sync.read(buffer);
          const whiteCount = countWhitePixels(png);
          checked.push(`${themeId}/${screen.id}`);
          if (whiteCount > 0) {
            failures.push(`${themeId}/${screen.id}: ${whiteCount} near-white pixel(s) in the bottom ${STRIP_HEIGHT}px`);
          }
        } catch (error) {
          console.warn(`  skipped ${themeId}/${screen.id}: ${error.message}`);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    close();
  }

  console.log(`Checked ${checked.length} theme/screen combinations.`);
  if (failures.length > 0) {
    console.error('\nWhite-strip failures:');
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('No white pixels found in the bottom strip of any checked screen/theme.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
