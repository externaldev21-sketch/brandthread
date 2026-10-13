#!/usr/bin/env node
/**
 * "Your store is live" at 393x852 with the demo seller (fake API):
 *   - the screen at rest, and mid-way through its one silver shimmer pass
 *   - --before: the old "Product published!" sheet after publishing from Add product
 *
 *   node scripts/store-screenshots/store-live-capture.mjs <web-build-dir> <out-dir> [--before]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const [buildDir, outDir, flag] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: store-live-capture.mjs <web-build-dir> <out-dir> [--before]');
mkdirSync(outDir, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 3, isMobile: true, userAgent: undefined };

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
try {
  if (flag === '--before') {
    const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
    await page.goto(`${origin}/add-product?bt_preview=seller&demo=1`);
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
    await waitForQuietNetwork(activity, 500, 8_000);
    await page.getByPlaceholder('e.g. Vintage Washed Tee').fill('Boxy Linen Shirt');
    await page.getByPlaceholder('0.00').first().fill('88');
    await page.getByText('Draft', { exact: true }).first().click();
    await page.waitForTimeout(400);
    await page.getByText('Save', { exact: true }).last().click();
    await page.getByTestId('add-product-success-sheet').waitFor({ timeout: 10_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(outDir, 'debug.png') });
      throw e;
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, '01-product-published-sheet.png') });
    console.log('  ✓ before');
    await context.close();
  } else {
    for (const [name, reducedMotion, wait] of [['01-store-live', 'reduce', 1800], ['02-shimmer-pass', 'no-preference', 0]]) {
      const { context, page, activity } = await openContext(browser, {
        device, role: 'seller', origin, images, contextOptions: { reducedMotion },
      });
      await page.goto(`${origin}/store-live?productId=prod_nl_hoodie_ember`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await page.getByTestId('store-live-preview').waitFor({ timeout: 15_000 });
      if (wait > 0) {
        await waitForQuietNetwork(activity, 300, 6_000).catch(() => {});
        await page.waitForTimeout(wait);
      } else {
        // Mid-shimmer: wait for the product tiles, then catch the band partway across.
        await page.waitForFunction(() => document.querySelectorAll('[data-testid="store-live-preview"] img').length >= 3, undefined, { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
      await page.screenshot({ path: path.join(outDir, `${name}.png`) });
      console.log(`  ✓ ${name}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  close();
}
