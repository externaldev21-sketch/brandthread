/**
 * Text-fit & alignment audit (Dev's mandatory pre-PR pass — see
 * text-fit-audit.mjs) for the Add Product Photos-row PR: flags any text
 * that doesn't fit its box, or any element overflowing its parent, on the
 * Add Product screen (fresh/empty state, all fixed chrome visible) at
 * 393x852. Also captures zoomed crops of the photos row, price row, and
 * inventory row for the PR recap.
 *
 * Run:  node scripts/store-screenshots/add-product-text-fit-verify.mjs
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, serveBuild } from './harness.mjs';
import { auditTextFit, reportTextFit } from './text-fit-audit.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/polish/screenshots/text-fit-audit');
mkdirSync(OUT, { recursive: true });

const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 3,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

// Photo tile thumbnails hold real (mocked) image content, not fixed-chrome
// text — excluded from the truncation check, same as elsewhere.
const DATA_TEXT_SELECTORS = ['[data-testid^="add-product-photo-"]'];

let anyFailed = false;

async function check(page, label) {
  const report = await auditTextFit(page, { dataTextSelectors: DATA_TEXT_SELECTORS });
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
    const { context, page } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images: {} });
    await page.goto(`${origin}/add-product?bt_preview=seller`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20000 });
    await page.getByText('Photos').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);

    await check(page, 'add-product (fresh)');
    await page.screenshot({ path: path.join(OUT, 'add-product-full.png') });
    await cropShot(page, 'text=Photos >> xpath=ancestor::*[2]', 'add-product-photos-row.png');
    await cropShot(page, 'text="Price *"', 'add-product-price-label.png');
    await cropShot(page, 'text="Track inventory"', 'add-product-inventory-row.png');
    await cropShot(page, 'text=Variants', 'add-product-variants-header.png');

    await context.close();
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
