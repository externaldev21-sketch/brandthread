#!/usr/bin/env node
/**
 * Captures pressed/focused-state screenshots for the PR that replaced the
 * plain white outline ring with a soft theme-tinted inset glow and an
 * animated sliding tab indicator (see components/profile/ProfileControls.tsx
 * and app/+html.tsx). Not a regression test — scripts/white-flash-check.mjs
 * and tests/no-outer-focus-ring.test.ts cover that; this is purely visual
 * evidence for the PR description.
 *
 *   node scripts/pressed-state-screenshots.mjs
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

const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'polish', 'screenshots', 'pressed-states');
const VIEWPORT = { width: 390, height: 844 };

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

  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

  try {
    for (const themeId of ['monochrome', 'navy']) {
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
      try {
        // bt_theme is only read on AppThemeProvider's mount effect, so it
        // must be present on the initial navigation (a pushState after
        // openScreen's own navigation would not retrigger that effect).
        await page.goto(`${origin}/(buyer)/profile?bt_preview=buyer&bt_theme=${themeId}`);
        await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
        await waitForQuietNetwork(activity, 800, 15_000);
        await page.waitForSelector('text=Posts', { timeout: 12_000 }).catch(() => {});
        await waitForImages(page);
        await waitForQuietNetwork(activity);
        await page.waitForTimeout(300);

        // Keyboard-focus state: Tab to the "Reposts" tab so :focus-visible
        // engages (a mouse click alone doesn't trigger :focus-visible in
        // Chromium), then screenshot the whole tab row.
        const repostsTab = page.getByTestId('profile-tab-reposts');
        await repostsTab.focus();
        await page.waitForTimeout(150);
        const tabsRow = page.getByRole('tablist').first();
        await tabsRow.screenshot({ path: path.join(OUTPUT_DIR, `${themeId}-tabs-focused.png`) }).catch(async () => {
          await page.screenshot({ path: path.join(OUTPUT_DIR, `${themeId}-tabs-focused.png`), clip: { x: 0, y: 60, width: VIEWPORT.width, height: 90 } });
        });

        // Pressed state: hold pointer down on a different tab (mouse.down
        // without mouse.up keeps `pressed: true` for this one frame).
        const box = await page.getByTestId('profile-tab-tagged').boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(120);
          await page.screenshot({ path: path.join(OUTPUT_DIR, `${themeId}-tab-pressed.png`), clip: { x: 0, y: 60, width: VIEWPORT.width, height: 90 } });
          await page.mouse.up();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    close();
  }

  console.log(`Wrote pressed-state screenshots to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
