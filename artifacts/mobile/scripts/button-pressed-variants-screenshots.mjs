#!/usr/bin/env node
/**
 * Captures rest/pressed evidence for the redesigned shared Button
 * (components/ui/Button.tsx) for the premium button redesign PR. Not a
 * regression test — purely visual evidence.
 *
 * Note: `?bt_theme=` only takes effect when `__DEV__` is true
 * (contexts/AppThemeContext.tsx's getPreviewThemeId), which the production
 * `expo export` build this harness uses does not set — so this only ever
 * renders the app's default (monochrome) theme, whatever THEMES below says.
 * That's a pre-existing harness limitation, not something this PR
 * introduces; Button.tsx's colors are 100% theme-token-driven
 * (theme.accent/theme.onAccent, never hardcoded), so the same code path
 * renders correctly in all 12 themes on-device.
 *
 *   node scripts/button-pressed-variants-screenshots.mjs
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb,
  launchBrowser,
  openContext,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
  DEFAULT_BUILD_DIR,
  MOBILE_ROOT,
  WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'button-redesign');
const VIEWPORT = { width: 390, height: 844 };
const THEMES = ['monochrome'];

async function main() {
  if (!process.argv.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb();
  }
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

  try {
    for (const themeId of THEMES) {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      try {
        // bt_theme is only read on AppThemeProvider's mount effect, so it must
        // be present on the initial full-page navigation (a later pushState
        // won't retrigger it) — a direct page.goto to a deep route gets stuck
        // on BootScreen, so go to "/" first, then client-side pushState to
        // the target, exactly like the harness's own openScreen() helper.
        await page.goto(`${origin}/?bt_preview=buyer&bt_theme=${themeId}`);
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
        await waitForQuietNetwork(activity, 800, 15_000);
        await page.evaluate((url) => {
          history.pushState(history.state, '', url);
          window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        }, '/(buyer)/cart?bt_preview=buyer');
        await page.waitForSelector('text=Cart', { timeout: 12_000 }).catch(() => {});
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(300);

        // Rest state: whole screen (primary "Buy"/"Check out" pills + secondary "Visit store" outline).
        await page.screenshot({ path: path.join(OUTPUT_DIR, 'rest-390x844-cart.png') });

        // Pressed state: hold pointer down on the primary bottom "Check out" CTA.
        const checkout = page.getByText('Check out').first();
        const ckBox = await checkout.boundingBox();
        if (ckBox) {
          await page.mouse.move(ckBox.x + ckBox.width / 2, ckBox.y + ckBox.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(110);
          await page.screenshot({ path: path.join(OUTPUT_DIR, 'pressed-390x844-cart-primary-checkout.png') });
          await page.mouse.up();
        }

        // Pressed state: a secondary/outline pill ("Visit store").
        const visitStore = page.getByText('Visit store').first();
        const vsBox = await visitStore.boundingBox();
        if (vsBox) {
          await page.mouse.move(vsBox.x + vsBox.width / 2, vsBox.y + vsBox.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(110);
          await page.screenshot({ path: path.join(OUTPUT_DIR, 'pressed-390x844-cart-secondary-visit-store.png') });
          await page.mouse.up();
        }
      } catch (error) {
        console.warn(`  skipped ${themeId}: ${error.message}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }

  console.log(`Wrote button-redesign pressed-state screenshots to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
