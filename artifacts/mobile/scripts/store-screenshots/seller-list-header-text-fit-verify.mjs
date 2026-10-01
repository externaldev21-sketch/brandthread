/**
 * Text-fit & alignment audit (Dev's mandatory pre-PR pass — see
 * text-fit-audit.mjs) for the Products/Orders header cleanup PR: flags any
 * text that doesn't fit its box, or any element overflowing its parent, on
 * the Products tab (populated/dropdown-open) and Orders tab
 * (populated/dropdown-open) at 393x852. Also captures zoomed crops of the
 * count row and title dropdown for the PR recap.
 *
 * Run:  node scripts/store-screenshots/seller-list-header-text-fit-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  MOBILE_ROOT,
  buildPreviewWeb,
  launchBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForQuietNetwork,
} from './harness.mjs';
import { auditTextFit, reportTextFit } from './text-fit-audit.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/text-fit-audit');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

let anyFailed = false;

async function check(page, label) {
  const report = await auditTextFit(page, {});
  const ok = reportTextFit(label, report);
  if (!ok) anyFailed = true;
  return report;
}

async function cropShot(page, selector, filename) {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count === 0) { console.log(`  (skip crop ${filename} — selector not found: ${selector})`); return; }
  await locator.screenshot({ path: path.join(OUT, filename) }).catch((e) => console.log(`  (crop failed ${filename}: ${e.message})`));
}

async function main() {
  console.log('Building web preview…');
  buildPreviewWeb();
  const { origin, close } = await serveBuild(path.join(MOBILE_ROOT, '.store-screenshots', 'web-build'));
  const browser = await launchBrowser();

  try {
    // ── Products tab: populated, dropdown open ──
    {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/products');
        try { await page.getByLabel('Products, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);

      await check(page, 'products (populated)');
      await cropShot(page, 'text="8 products"', 'products-count-row.png');

      await page.getByLabel('Products, choose a view').click();
      await page.waitForTimeout(300);
      await check(page, 'products (dropdown open)');
      await cropShot(page, 'text="Collections" >> xpath=ancestor::*[3]', 'products-dropdown.png');

      await context.close();
    }

    // ── Orders tab: populated, dropdown open ──
    {
      const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
      for (let attempt = 1; ; attempt += 1) {
        await openScreen(page, activity, origin, 'seller', '/(tabs)/orders');
        try { await page.getByLabel('Orders, choose a view').waitFor({ timeout: 15000 }); break; } catch (e) { if (attempt >= 3) throw e; }
      }
      await waitForQuietNetwork(activity, 500, 8000);
      await page.waitForTimeout(500);

      await check(page, 'orders (populated)');
      await cropShot(page, 'text=/^\\d+ orders?/', 'orders-count-row.png');

      await page.getByLabel('Orders, choose a view').click();
      await page.waitForTimeout(300);
      await check(page, 'orders (dropdown open)');
      await cropShot(page, 'text="Returns" >> xpath=ancestor::*[3]', 'orders-dropdown.png');

      await context.close();
    }
  } finally {
    await browser.close();
    close();
  }

  if (anyFailed) {
    console.error('\nFAIL — one or more screens have text-fit/overflow problems. See above.');
    process.exitCode = 1;
  } else {
    console.log('\nOK — all audited screens are clean.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
