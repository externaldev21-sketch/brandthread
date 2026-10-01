#!/usr/bin/env node
/**
 * Size recommendation badge — screenshots at 393x852 (product page + feed Shop
 * sheet) using the store-screenshots harness (signed-in demo buyer, fake API).
 * The harness product has no size chart and the buyer has no saved sizes, so
 * the script serves a chart for prod_nl_jacket_rust and (for the "saved" cases)
 * GET /api/buyer/preferences. Also runs the text-fit check on each screen.
 *
 *   node scripts/size-recommendation-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-assets/buyer-size-recommendations/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';
import { collectTextFitIssues } from './textFitCheck.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/buyer-size-recommendations');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PRODUCT = 'prod_nl_jacket_rust';
const CHART = {
  columns: ['Chest'], unit: 'cm',
  rows: [{ size: 'S', values: ['88-94'] }, { size: 'M', values: ['94-100'] }, { size: 'L', values: ['100-108'] }, { size: 'XL', values: ['108-116'] }],
};
const CASES = [
  { tag: 'no-chart', chart: null, prefs: null },
  { tag: 'find-my-size', chart: CHART, prefs: null },
  { tag: 'saved-size', chart: CHART, prefs: { sizes: { outerwear: 'M' } } },
  { tag: 'measurements', chart: CHART, prefs: { sizes: { measurements: { chestCm: 103 } } } },
];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin, c) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  await context.route((url) => url.pathname.endsWith(`/public/products/${PRODUCT}`), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const base = PUBLIC_PRODUCTS.find((p) => p.id === PRODUCT);
    return route.fulfill(json(origin, { ...base, sizeChart: c.chart }));
  });
  await context.route((url) => url.pathname.endsWith('/buyer/preferences'), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    return route.fulfill(json(origin, {
      sizes: c.prefs?.sizes ?? {}, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null,
    }));
  });
  return { context, page, activity };
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  let failures = 0;
  try {
    for (const c of CASES) {
      // Product page
      {
        const { context, page, activity } = await setup(browser, images, server.origin, c);
        for (let attempt = 0; ; attempt++) {
          await openScreen(page, activity, server.origin, 'buyer', `/buyer-product-detail?productId=${PRODUCT}`);
          try { await page.getByRole('radio', { name: /^Size, / }).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
        }
        await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(800);
        await page.evaluate(() => {
          const el = document.querySelector('[data-testid="size-recommendation"], [data-testid="size-find-my-size"]')
            ?? document.querySelector('[role="radio"]');
          el?.scrollIntoView({ block: 'center' });
        });
        await page.waitForTimeout(300);
        const issues = await collectTextFitIssues(page);
        console.log(`pdp ${c.tag}: text-fit issues`, JSON.stringify(issues));
        failures += issues.length;
        await page.screenshot({ path: path.join(OUT, `pdp-${c.tag}.jpg`), type: 'jpeg', quality: 84 });
        await context.close();
      }
      // Feed tap-to-buy sheet
      {
        const { context, page, activity } = await setup(browser, images, server.origin, c);
        for (let attempt = 0; ; attempt++) {
          await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
          try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
        }
        await waitForQuietNetwork(activity);
        const guide = page.getByTestId('feed-gesture-guide');
        if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400); }
        const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
        await pill.click({ timeout: 8_000 });
        await page.waitForTimeout(700);
        await pill.click({ timeout: 8_000 });
        await page.getByTestId('shop-product-sheet').waitFor({ timeout: 10_000 });
        await page.waitForTimeout(1200);
        const sheet = page.getByTestId('shop-product-sheet');
        const box = await sheet.boundingBox();
        console.log(`sheet ${c.tag}: top=${Math.round(box.y)} height=${Math.round(box.height)} of ${VIEWPORT.height}`);
        // LIST step (partial height) -> tap the jacket row to reach the DETAIL step with the size chips.
        if (await sheet.getByRole('radio').count() === 0) {
          await page.screenshot({ path: path.join(OUT, `sheet-list-step.jpg`), type: 'jpeg', quality: 84 });
          await sheet.getByText('Field Shell Jacket — Rust').first().click();
          await page.waitForTimeout(1500);
        }
        const box2 = await sheet.boundingBox();
        console.log(`sheet ${c.tag} detail: top=${Math.round(box2.y)} height=${Math.round(box2.height)}`);
        await sheet.getByRole('radio').first().scrollIntoViewIfNeeded({ timeout: 8000 });
        const issues = await collectTextFitIssues(page, { root: '[data-testid="shop-product-sheet"]' });
        console.log(`sheet ${c.tag}: text-fit issues`, JSON.stringify(issues));
        failures += issues.length;
        await page.screenshot({ path: path.join(OUT, `sheet-${c.tag}.jpg`), type: 'jpeg', quality: 84 });
        if (c.tag === 'saved-size') {
          // Size picker works, recommendation is only marked (not pre-selected), add to cart stays on the feed.
          const before = await sheet.getByRole('radio', { checked: true }).count();
          console.log('  selected chips before tap (must be 0):', before);
          await sheet.getByRole('radio', { name: /^M(,|$)/ }).first().click();
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(OUT, 'sheet-saved-size-selected.jpg'), type: 'jpeg', quality: 84 });
          await sheet.getByRole('button', { name: /^Add to cart/ }).first().click();
          await page.waitForTimeout(1500);
          console.log('  after add to cart, url:', page.url());
          await page.screenshot({ path: path.join(OUT, 'sheet-after-add-to-cart.jpg'), type: 'jpeg', quality: 84 });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures === 0 ? 'TEXT-FIT: clean' : `TEXT-FIT: ${failures} issue(s)`);
  if (failures) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exit(1); });
