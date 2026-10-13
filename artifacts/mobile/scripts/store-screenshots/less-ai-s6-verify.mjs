#!/usr/bin/env node
/**
 * Less-AI pass S6 (items 129–150): before/after screenshots at 390×844 of the
 * buyer screens this pass touches, on the harness's demo buyer + fake API.
 *
 *   node scripts/store-screenshots/less-ai-s6-verify.mjs <buildDir> <outDir> [screen ...]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const [buildDir, outDir, ...only] = process.argv.slice(2);
const OUT = path.resolve(outDir);
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 390, height: 844 };

/** Each screen: route, then optional steps that each save a shot. */
export const SCREENS = {
  pdp: {
    path: '/buyer-product-detail?productId=prod_nl_hoodie_ember',
    ready: 'Heavyweight Hoodie',
    async steps(page, shot) {
      await shot('pdp-1-top');
      const size = page.locator('[data-testid^="option-opt_size-"]').filter({ hasNotText: 'XS' });
      if (await size.count()) {
        await size.first().click().catch(() => {});
        await page.waitForTimeout(300);
        await shot('pdp-2-size-picked');
        const add = page.getByTestId('product-add-to-cart');
        if (await add.count()) {
          await add.click();
          await page.waitForTimeout(500);
          await shot('pdp-3-added');
          await page.waitForTimeout(2200);
          await shot('pdp-4-after-2s');
        }
      }
      await scrollToText(page, 'Report listing');
      await shot('pdp-5-shelves');
      await page.getByText('More from', { exact: false }).first().evaluate((n) => n.scrollIntoView({ block: 'start' })).catch(() => {});
      await page.mouse.move(195, 400);
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(600);
      await shot('pdp-6-more-from');
    },
  },
};

async function scrollToText(page, text) {
  await page.keyboard.press('Escape').catch(() => {});
  const target = page.getByText(text, { exact: false }).first();
  for (let i = 0; i < 30 && !(await target.isVisible().catch(() => false)); i++) {
    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
  }
  await target.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(600);
}

async function run() {
  const server = await serveBuild(path.resolve(buildDir));
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    for (const [id, screen] of Object.entries(SCREENS)) {
      if (only.length && !only.includes(id)) continue;
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
      const { context, page, activity } = await openContext(browser, { device, role: screen.role ?? 'buyer', origin: server.origin, images });
      await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
      // The app remounts once after sign-in; retry if that lands us on "/".
      for (let attempt = 0; ; attempt++) {
        await openScreen(page, activity, server.origin, screen.role ?? 'buyer', screen.path, { extraQuery: screen.extraQuery ?? '' });
        try { await page.getByText(screen.ready).first().waitFor({ timeout: 12_000 }); break; } catch (e) {
          if (attempt >= 4) { console.warn(`${id}: "${screen.ready}" not seen`); break; }
        }
      }
      await waitForQuietNetwork(activity);
      await waitForImages(page);
      await page.waitForTimeout(800);
      const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('saved', name); };
      if (screen.steps) await screen.steps(page, shot); else await shot(id);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
