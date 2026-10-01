#!/usr/bin/env node
/**
 * Screenshots for buyer-search filters. Reuses the store-screenshots harness
 * (web export + stubbed Clerk) but forwards /api/public/search* to a REAL
 * local public router (SEARCH_API, default http://127.0.0.1:4010) backed by a
 * scratch Postgres, so the filtered results are real API output.
 *
 *   SEARCH_API=http://127.0.0.1:4010 node scripts/search-filters-screenshots.mjs [--skip-build]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { textFitCheckScoped } from './textFitCheck.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const SEARCH_API = process.env.SEARCH_API ?? 'http://127.0.0.1:4010';
const DEMO_API = 'https://api.brandthread.test';
const BUILD_DIR = path.join(WORK_DIR, 'web-build-filters');
const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'buyer-search-filters');

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(BUILD_DIR);
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  mkdirSync(OUT, { recursive: true });

  const device = {
    viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  // Registered after the harness routes, so it wins for the real search endpoint.
  await context.route((u) => u.origin === DEMO_API && /\/public\/search$/.test(u.pathname), async (route) => {
    const url = new URL(route.request().url());
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const real = await fetch(`${SEARCH_API}/api/public/search${url.search}`);
    activity.lastApiAt = Date.now();
    return route.fulfill({
      status: real.status,
      headers: cors,
      contentType: 'application/json',
      body: await real.text(),
    });
  });

  const fitReport = {};
  const snap = async (name, scope) => {
    fitReport[name] = await textFitCheckScoped(page, scope ? { scope } : undefined);
    await waitForImages(page);
    await waitForQuietNetwork(activity);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    console.log('wrote', name);
  };

  await openScreen(page, activity, origin, 'buyer', '/buyer-search');
  await page.waitForTimeout(800);
  await page.waitForTimeout(1500);
  await page.getByPlaceholder('Search').first().fill('hoodie');
  await page.waitForTimeout(900);
  await page.getByPlaceholder('Search').first().press('Enter');
  await page.waitForTimeout(800);
  await page.getByTestId('search-tab-products').click();
  await page.waitForTimeout(600);
  await snap('1-search-products');

  await page.getByTestId('buyer-search-filter-button').click();
  await page.waitForTimeout(800);
  await snap('2-filter-sheet', '[data-testid="search-filter-sheet"]');

  await page.getByTestId('search-filter-size-M').click();
  await page.getByTestId('search-filter-color-Grey').click();
  await page.getByTestId('search-filter-in-stock').click();
  await page.waitForTimeout(300);
  await snap('3-filter-sheet-selected', '[data-testid="search-filter-sheet"]');

  await page.getByTestId('search-filter-apply').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await snap('3b-filter-sheet-lower', '[data-testid="search-filter-sheet"]');
  await page.getByTestId('search-filter-apply').click();
  await page.waitForTimeout(1200);
  await snap('4-filtered-results');

  await page.screenshot({ path: path.join(OUT, '5-zoom-filter-row.png'), clip: { x: 0, y: 160, width: 393, height: 56 } });
  console.log('TEXT-FIT', JSON.stringify(fitReport, null, 1));
  await browser.close();
  close();
}

main().catch((e) => { console.error(e); process.exit(1); });
