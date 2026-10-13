#!/usr/bin/env node
/**
 * Store page Lookbook mode, on the store-screenshots harness, 393x852 dark.
 *
 *   node scripts/store-screenshots/lookbook-verify.mjs <before|after> [buildDir]
 *
 * before (a build of origin/dev): the buyer's view of Northline Studio's
 * store page, and Store Settings.
 * after:
 *  01 store page, grid layout (unchanged)
 *  02 store page, lookbook: first look full screen
 *  03 lookbook after paging to the next look
 *  04 Store Settings with the Lookbook switch on
 *  05 owner store page "..." menu with the Preview entry
 * The public profile response is the harness's own, with `storeLayout`
 * added by a route override (what GET /api/public/sellers/:id now returns).
 * Runs the text-fit check on every capture.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './demo-images.mjs';
import { DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './harness.mjs';
import { findTextOverflow } from './checkTextOverflow.mjs';

const MODE = process.argv[2] ?? 'after';
const BUILD = path.resolve(process.argv[3] ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/lookbook');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const DEVICE = {
  viewport: { width: 393, height: 852 },
  scale: 2,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
const STORE = '/seller-profile?id=user_northline';
const BIO = 'Heavyweight basics, cut and sewn in Portland. New drop every season.';

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

/** Adds `storeLayout` to the harness's public profile / seller profile answers. */
async function withLayout(context, getLayout, setLayout) {
  await context.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const p = new URL(req.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/seller/profile/store-layout' && req.method() === 'PUT') {
      setLayout(JSON.parse(req.postData() || '{}').layout);
      return json(route, { storeLayout: getLayout() });
    }
    if ((/^\/api\/public\/sellers\/[^/]+$/.test(p) || p === '/api/seller/profile') && req.method() === 'GET') {
      const res = await route.fetch().catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      if (!body) return route.fallback();
      if (body.profile) body.profile.storeLayout = getLayout();
      else body.storeLayout = getLayout();
      return json(route, body);
    }
    return route.fallback();
  });
}

async function storePage(browser, images, origin, layout, name, ready = BIO) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  await withLayout(context, () => layout, () => {});
  await openUntil(page, activity, origin, 'buyer', STORE, ready, '&demo=1');
  await waitForQuietNetwork(activity, 800, 15_000);
  await waitForImages(page).catch(() => {});
  await page.waitForTimeout(1200);
  await shot(page, name);
  return { context, page, activity };
}

async function storeSettings(browser, images, origin, { tapToggle }) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
  let layout = 'grid';
  await withLayout(context, () => layout, (v) => { layout = v; });
  await openUntil(page, activity, origin, 'seller', '/store-settings?bt_preview=buyer', 'STORE IDENTITY');
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelectorAll('*').forEach((e) => { if (e.scrollHeight > e.clientHeight + 40) e.scrollTop = e.scrollHeight; }));
  await page.waitForTimeout(600);
  if (tapToggle) {
    await page.getByRole('switch', { name: /Lookbook/ }).click();
    await page.waitForTimeout(800);
    console.log(`layout after tap: ${layout}`);
    if (layout !== 'lookbook') problems++;
  }
  await shot(page, MODE === 'before' ? '02-store-settings' : '04-store-settings-lookbook-on');
  await context.close();
}

async function ownerPreview(browser, images, origin) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'seller', origin, images });
  await withLayout(context, () => 'lookbook', () => {});
  await openUntil(page, activity, origin, 'seller', '/seller-profile?isOwner=true&bt_preview=buyer', 'Northline Studio');
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: /More options|More/ }).first().click();
  await page.getByText('Preview lookbook', { exact: true }).first().waitFor({ timeout: 8_000 });
  await page.waitForTimeout(600);
  await shot(page, '05-owner-preview-entry');
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    if (MODE === 'before') {
      (await storePage(browser, images, server.origin, 'grid', '01-store-page')).context.close();
      await storeSettings(browser, images, server.origin, { tapToggle: false });
      return;
    }
    (await storePage(browser, images, server.origin, 'grid', '01-store-page-grid')).context.close();
    {
      const { context, page } = await storePage(browser, images, server.origin, 'lookbook', '02-lookbook-first-look');
      await page.mouse.move(196, 430);
      await page.mouse.wheel(0, 852);
      await page.waitForTimeout(1500);
      await waitForImages(page).catch(() => {});
      await shot(page, '03-lookbook-next-look');
      await context.close();
    }
    await storeSettings(browser, images, server.origin, { tapToggle: true });
    await ownerPreview(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
  if (problems) process.exitCode = 1;
}

run().catch((error) => { console.error(error); process.exit(1); });
