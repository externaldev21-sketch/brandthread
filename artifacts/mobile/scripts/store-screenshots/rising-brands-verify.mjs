#!/usr/bin/env node
/**
 * Discover > Brands "Rising this week" + Store Settings "Show in Rising
 * brands", on the store-screenshots harness, 393x852 dark.
 *
 *   node scripts/store-screenshots/rising-brands-verify.mjs <before|after> [buildDir]
 *
 * before (a build of origin/dev): Discover > Brands in demo=1, Store Settings.
 * after:
 *  01 Discover > Brands, demo=1 (preview leaderboard, 5 rows + See all)
 *  02 the full 10 ("See all")
 *  03 Discover > Brands, fresh preview (no section: honest empty)
 *  04 Discover > Brands, real API path with only 2 qualifying brands (hidden)
 *  05 Store Settings, switch off (default)
 *  06 Store Settings, switch on after a tap (PUT answered by the route below)
 * Runs the text-fit check on every capture.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './demo-images.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { findTextOverflow } from './checkTextOverflow.mjs';

const MODE = process.argv[2] ?? 'after';
const BUILD = path.resolve(process.argv[3] ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/rising-brands');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

/** openScreen, then re-push the route until `ready` shows (the app can remount once after Clerk loads). */
async function openUntil(page, activity, origin, role, target, ready, extraQuery = '') {
  await openScreen(page, activity, origin, role, target, { extraQuery });
  const url = `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${extraQuery}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await page.getByText(ready, { exact: true }).first().waitFor({ timeout: 8_000 });
      return;
    } catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
    }
  }
}

let problems = 0;
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${MODE}-393x852-${name}.png`), caret: 'hide' });
  const issues = await findTextOverflow(page);
  problems += issues.length;
  console.log(`${MODE}-${name}: text-fit ${issues.length ? 'PROBLEMS ' + JSON.stringify(issues.slice(0, 6)) : 'OK'}`);
}

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

async function discoverBrands(browser, images, origin, { demo, risingBody, name }) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  if (risingBody) {
    await context.route(`${API}/**`, (route) => {
      const p = new URL(route.request().url()).pathname;
      if (route.request().method() !== 'OPTIONS' && /\/public\/brands\/rising$/.test(p)) return json(route, risingBody);
      return route.fallback();
    });
  }
  await openUntil(page, activity, origin, 'buyer', '/discover', 'Brands', demo ? '&demo=1' : '');
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.getByText('Brands', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await waitForQuietNetwork(activity, 800, 10_000);
  await page.waitForTimeout(800);
  await shot(page, name);
  return { context, page, activity };
}

async function storeSettings(browser, images, origin, { tapToggle }) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
  let optIn = false;
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/seller/profile/rising-brands' && req.method() === 'PUT') {
      optIn = !!JSON.parse(req.postData() || '{}').optIn;
      return json(route, { risingBrandsOptIn: optIn });
    }
    if (p === '/api/seller/profile' && req.method() === 'GET') {
      const res = await route.fetch().catch(() => null);
      const body = res ? await res.json().catch(() => ({})) : {};
      return json(route, { ...body, risingBrandsOptIn: optIn });
    }
    return route.fallback();
  });
  // ?bt_preview=buyer keeps the signed-in demo seller's real API path on
  // (see scripts/f4-customers-screenshots.mjs).
  await openUntil(page, activity, origin, 'seller', '/store-settings?bt_preview=buyer', 'STORE IDENTITY');
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(800);
  // Scroll the settings list to the end so the new section is on screen.
  await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 40) e.scrollTop = e.scrollHeight; }));
  await page.waitForTimeout(600);
  await shot(page, MODE === 'before' ? '02-store-settings' : '05-store-settings-off');
  if (tapToggle) {
    await page.getByRole('switch', { name: /Show in Rising brands/ }).click();
    await page.waitForTimeout(800);
    await shot(page, '06-store-settings-on');
    console.log(`opt-in after tap: ${optIn}`);
    if (!optIn) problems++;
  }
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    if (MODE === 'before') {
      (await discoverBrands(browser, images, server.origin, { demo: true, name: '01-discover-brands' })).context.close();
      await storeSettings(browser, images, server.origin, { tapToggle: false });
      return;
    }
    {
      const { context, page } = await discoverBrands(browser, images, server.origin, { demo: true, name: '01-discover-brands' });
      await page.getByRole('button', { name: 'See all rising brands' }).click();
      await page.getByText('10', { exact: true }).first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(1200);
      await shot(page, '02-rising-see-all');
      await context.close();
    }
    (await discoverBrands(browser, images, server.origin, { demo: false, name: '03-discover-brands-fresh' })).context.close();
    (await discoverBrands(browser, images, server.origin, {
      demo: false, name: '04-discover-brands-under-3',
      risingBody: { weekOf: '2026-09-11', brands: [
        { rank: 1, sellerId: 'user_ember', username: 'emberandash', brandName: 'Ember & Ash', logoUrl: null, growthPct: 120 },
        { rank: 2, sellerId: 'user_field', username: 'fieldoffice', brandName: 'Field Office', logoUrl: null, growthPct: 40 },
      ] },
    })).context.close();
    await storeSettings(browser, images, server.origin, { tapToggle: true });
  } finally {
    await browser.close();
    server.close();
  }
  if (problems) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exit(1); });
