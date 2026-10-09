#!/usr/bin/env node
/**
 * Captures the in-app Alert host (components/ui/AppAlertHost.tsx) on real
 * flows at 390x844: a two-button confirmation, a 3+ options list, and a toast.
 *
 *   node scripts/store-screenshots/app-alert-verify.mjs [outDir] [--demo]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(MOBILE_ROOT, 'docs/pr-review/app-alert'));
mkdirSync(OUT, { recursive: true });
const device = { viewport: { width: Number(process.env.VW ?? 390), height: Number(process.env.VH ?? 844) }, scale: 2, isMobile: true };
const suffix = `${demo ? '-demo' : ''}${process.env.VW ? `-${process.env.VW}` : ''}`;

async function flow(browser, images, origin, role, target, name, act, ready) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      await openScreen(page, activity, origin, role, target, { extraQuery: demo ? '&demo=1' : '' });
      await waitForQuietNetwork(activity, 600, 10_000);
      if (await page.getByText(ready).first().waitFor({ timeout: 6_000 }).then(() => true, () => false)) break;
    }
    await page.waitForTimeout(800);
    await waitForImages(page, 6_000);
    await act(page);
    // Let the open animation finish (the fake clock can lag a little behind real time).
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(OUT, `${name}${suffix}.png`) });
    console.log(`Captured ${name}${suffix}`);
  } catch (e) {
    console.error(`FAILED ${name}: ${e.message}`);
    await page.screenshot({ path: path.join(OUT, `${name}${suffix}-FAILED.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    await flow(browser, images, origin, 'buyer', '/buyer-settings-menu', 'confirm-sign-out', async (page) => {
      const target = page.getByText(/^(Log out|Sign out)$/).last();
      for (let i = 0; i < 20 && !(await target.isVisible().catch(() => false)); i++) {
        await page.mouse.move(195, 500);
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(250);
      }
      await target.click();
      await page.getByTestId('app-alert-sheet').waitFor({ timeout: 5_000 });
    }, 'Your account');
    await flow(browser, images, origin, 'seller', '/product-detail?id=prod_nl_hoodie_ember', 'options-list', async (page) => {
      await page.getByLabel(/more|options/i).first().click();
      await page.getByTestId('app-alert-sheet').waitFor({ timeout: 5_000 });
    }, 'Overview');
    await flow(browser, images, origin, 'seller', '/product-detail?id=prod_nl_hoodie_ember', 'toast', async (page) => {
      await page.getByLabel(/more|options/i).first().click();
      await page.getByTestId('app-alert-sheet').waitFor({ timeout: 5_000 });
      await page.waitForTimeout(500);
      await page.getByTestId('app-alert-option-0').click();
      await page.getByTestId('app-alert-toast').waitFor({ timeout: 8_000 });
    }, 'Overview');
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
