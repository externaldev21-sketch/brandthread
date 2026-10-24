#!/usr/bin/env node
/**
 * Screenshots for the search upgrade (categories + unified results) at
 * 390x844, written to docs/screenshots/search-upgrade/.
 *
 * The search endpoints (/api/public/search/all, /search/suggested,
 * /trending/brands) are answered by the REAL api-server routes running over
 * a seeded throwaway database — start that first:
 *
 *   cd artifacts/api-server
 *   SEARCH_DEMO_DATABASE_URL=postgres://…/brandthread_test \
 *     pnpm exec tsx ./scripts/searchUpgradeDemoServer.ts --port 4789
 *
 * then:
 *
 *   node scripts/search-upgrade-screenshots.mjs --api http://127.0.0.1:4789 [--skip-build] [--only 03,09]
 *
 * Everything else comes from the shared store-screenshots demo data.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb,
  launchBrowser as launchHarnessBrowser,
  openContext,
  openScreen,
  serveBuild,
  waitForImages,
  waitForQuietNetwork,
  MOBILE_ROOT,
  WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1].split(',') : null;
const apiIndex = args.indexOf('--api');
const REAL_API = apiIndex >= 0 ? args[apiIndex + 1] : 'http://127.0.0.1:4789';
const BUILD_DIR = path.join(WORK_DIR, 'web-build-search-upgrade');
const OUTPUT_DIR = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'screenshots', 'search-upgrade');
const DEMO_API = 'https://api.brandthread.test';
const REAL_PATHS = ['/api/public/search/all', '/api/public/search/suggested', '/api/public/trending/brands'];

/** The harness's launcher, falling back to a system Chromium (PLAYWRIGHT_CHROMIUM_PATH). */
async function launchBrowser() {
  try {
    return await launchHarnessBrowser();
  } catch (error) {
    const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    if (!executablePath) throw error;
    const { chromium } = await import('playwright');
    return chromium.launch({ executablePath });
  }
}

const DEVICE = {
  viewport: { width: 390, height: 844 },
  scale: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  isMobile: true,
};

async function main() {
  const health = await fetch(`${REAL_API}/api/public/search/all?q=hoodie`).catch(() => null);
  if (!health?.ok) throw new Error(`The search demo API at ${REAL_API} is not answering — see the header comment.`);
  if (!args.includes('--skip-build')) {
    console.log('Building preview web export...');
    buildPreviewWeb(BUILD_DIR);
  }
  const { origin, close } = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  mkdirSync(OUTPUT_DIR, { recursive: true });

  async function capture(name, steps) {
    if (ONLY && !ONLY.some((prefix) => name.startsWith(prefix))) return;
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
    // Registered after the harness's catch-all, so these take precedence.
    await context.route(`${DEMO_API}/api/**`, async (route) => {
      const url = new URL(route.request().url());
      // The app calls the versioned /api/v1/... alias; the demo API serves the unversioned paths.
      const pathname = url.pathname.replace(/^\/api\/v1\//, '/api/');
      if (!REAL_PATHS.includes(pathname)) return route.fallback();
      const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': 'authorization,content-type,x-store-context' } });
      activity.lastApiAt = Date.now();
      const res = await fetch(`${REAL_API}${pathname}${url.search}`);
      return route.fulfill({ status: res.status, headers: cors, contentType: 'application/json', body: await res.text() });
    });
    try {
      // The harness's client-side navigation occasionally lands on Home
      // while the app is still settling; retry until Search is up.
      for (let attempt = 1; ; attempt++) {
        await openScreen(page, activity, origin, 'buyer', '/buyer-search');
        try {
          await page.getByTestId('buyer-search-field').waitFor({ timeout: 10_000 });
          break;
        } catch (error) {
          if (attempt >= 4) throw error;
        }
      }
      await page.waitForTimeout(700);
      await steps(page);
      await waitForQuietNetwork(activity);
      await waitForImages(page);
      // Let result tiles finish their entrance fade.
      await page.waitForTimeout(1500);
      const file = path.join(OUTPUT_DIR, `390x844-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`  wrote ${file}`);
    } catch (error) {
      console.warn(`  skipped ${name}: ${error.message}`);
    } finally {
      await context.close();
    }
  }

  const field = (page) => page.getByTestId('buyer-search-field');
  const search = async (page, q) => {
    await field(page).click();
    await field(page).fill(q);
    await page.waitForTimeout(2000);
  };
  const submit = async (page, q) => {
    await search(page, q);
    await field(page).press('Enter');
    await page.waitForTimeout(2000);
  };
  const tab = async (page, key) => {
    await page.getByTestId(`search-tab-${key}`).click();
    await page.waitForTimeout(2000);
  };
  const chip = async (page, key) => {
    await page.getByTestId(`search-chip-${key}`).click();
    await page.waitForTimeout(2000);
  };

  try {
    await capture('01-empty-chips-recent-trending-brands', async () => {});
    await capture('02-focused-empty-recent-trending-brands', async (page) => { await field(page).click(); await page.waitForTimeout(600); });
    await capture('03-typing-suggestions', async (page) => { await search(page, 'hood'); });
    await capture('04-results-top', async (page) => { await submit(page, 'hoodie'); });
    await capture('05-results-products', async (page) => { await submit(page, 'hoodie'); await tab(page, 'products'); });
    await capture('06-results-brands', async (page) => { await submit(page, 'vintage'); await tab(page, 'brands'); });
    await capture('07-results-people', async (page) => { await submit(page, 'hoodie'); await tab(page, 'people'); });
    await capture('08-results-posts', async (page) => { await submit(page, 'hoodie'); await tab(page, 'posts'); });
    await capture('09-chip-browse-streetwear', async (page) => { await chip(page, 'streetwear'); });
    await capture('10-chip-vintage-plus-query', async (page) => { await submit(page, 'hoodie'); await chip(page, 'vintage'); await tab(page, 'products'); });
    await capture('11-results-top-vintage', async (page) => { await submit(page, 'vintage'); });
  } finally {
    await browser.close();
    close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
