#!/usr/bin/env node
/**
 * Launch checklist + best time to launch (items 45, 56), live on the
 * store-screenshots harness (fake API, signed-in demo seller).
 *
 *   node scripts/f4-launch-screenshots.mjs <buildDir> <outDir> <before|after>
 *
 * "before" answers the new endpoints with 404 and drops `readiness` from the
 * launch list, which is exactly how the screens rendered before this change
 * (every new element hides itself without its data).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const BEFORE = MODE === 'before';
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const VIEWPORT = BEFORE ? { width: 390, height: 844 } : { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const img = (n) => `${IMAGE_HOST}/${n}.jpg`;
const LAUNCHES = [
  { productId: P1, name: 'Heavyweight boxy tee', imageUrl: img('hoodie'), status: 'active', launchAt: '2026-09-25T02:00:00Z', launchedAt: null, notifyFollowers: true, alertCount: 38, readiness: { readyCount: 6, total: 9, blockers: [] } },
  { productId: P2, name: 'Washed denim jacket', imageUrl: img('model'), status: 'active', launchAt: '2026-09-27T17:00:00Z', launchedAt: null, notifyFollowers: false, alertCount: 4, readiness: { readyCount: 4, total: 9, blockers: ['price', 'payouts'] } },
];
const PRODUCTS = [
  { id: P1, name: 'Heavyweight boxy tee', images: [img('hoodie')], status: 'active' },
  { id: P2, name: 'Washed denim jacket', images: [img('model')], status: 'active' },
  { id: P3, name: 'Ribbed knit beanie', images: [img('texture')], status: 'active' },
];
const ids = ['photos', 'price', 'stock', 'variants', 'description', 'shipping', 'payouts', 'launch_time', 'followers'];
function checklist(open, blockers = []) {
  const items = ids.map((id) => ({ id, done: !open.includes(id), blocking: blockers.includes(id) }));
  return { items, readyCount: items.filter((i) => i.done).length, total: items.length, blockers, canSchedule: blockers.length === 0, imageCount: 2, followerCount: 1240 };
}
const CHECKLISTS = {
  [P1]: checklist(['photos', 'variants', 'shipping']),
  [P2]: checklist(['price', 'description', 'shipping', 'payouts', 'followers'], ['price', 'payouts']),
  [P3]: checklist(['launch_time', 'followers']),
};
function bestTime(tz) {
  const grid = Array.from({ length: 7 }, (_, wd) => Array.from({ length: 24 }, (_, h) => {
    if (h < 7) return (h * 3 + wd) % 4;
    const evening = Math.max(0, 10 - Math.abs(h - 19) * 2);
    const lunch = Math.max(0, 5 - Math.abs(h - 12) * 2);
    return (evening + lunch) * (wd === 4 ? 9 : 6) + ((wd * 7 + h) % 5) + 3;
  }));
  const slots = [];
  grid.forEach((row, weekday) => row.forEach((followers, hour) => slots.push({ weekday, hour, followers })));
  slots.sort((a, b) => b.followers - a.followers || a.weekday - b.weekday || a.hour - b.hour);
  return { status: 'ok', timeZone: tz, days: 28, activeFollowers: 412, minActiveFollowers: 20, grid, byWeekday: [118, 164, 171, 180, 236, 205, 139], top: slots.slice(0, 3) };
}

function json(route, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': route.request().headers().origin ?? '*', 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ok ${name}`);
}
async function overflowCheck(page, label) {
  const issues = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll('body *')) {
      const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ');
      if (!text) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const ellipsis = cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1;
      const offScreen = (r.right > vw + 1 || r.left < -1) && cs.position !== 'fixed';
      if (ellipsis || offScreen) out.push({ text: text.slice(0, 40), ellipsis, offScreen });
    }
    return out;
  });
  console.log(`overflow[${label}]:`, issues.length ? JSON.stringify(issues) : 'none');
}
async function waitText(page, text, pathForRetry) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { await page.getByText(text, { exact: true }).first().waitFor({ timeout: 12_000 }); return; }
    catch (error) {
      if (attempt === 5) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, pathForRetry);
    }
  }
}

async function routes(context) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/product-launches') return json(route, BEFORE ? LAUNCHES.map(({ readiness, ...l }) => l) : LAUNCHES);
    if (p === '/api/product-launches/best-time') return BEFORE ? json(route, { error: 'Not found' }, 404) : json(route, bestTime(url.searchParams.get('tz') || 'UTC'));
    const m = /^\/api\/product-launches\/([^/]+)\/checklist$/.exec(p);
    if (m) return BEFORE ? json(route, { error: 'Not found' }, 404) : json(route, CHECKLISTS[m[1]]);
    if (p === '/api/products' && request.method() === 'GET') return json(route, PRODUCTS);
    return route.fallback();
  });
}

async function launchesFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await routes(context);
  await openScreen(page, activity, origin, 'seller', '/product-launches');
  await waitText(page, 'Heavyweight boxy tee', '/product-launches?bt_preview=seller');
  await waitForQuietNetwork(activity, 900, 15_000);
  await waitForImages(page);
  await page.waitForTimeout(800);
  await shot(page, `${MODE}-01-launches-list`);
  await overflowCheck(page, 'list');

  // Editor with warnings only.
  await page.getByText('Heavyweight boxy tee', { exact: true }).first().click();
  await page.getByText('Edit launch', { exact: true }).first().waitFor({ timeout: 10_000 });
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(800);
  await shot(page, `${MODE}-02-editor-top`);
  await overflowCheck(page, 'editor-top');
  if (!BEFORE) {
    await page.getByTestId('launch-best-time').click();
    await page.waitForTimeout(600);
    await shot(page, `${MODE}-03-editor-best-time-applied`);
  }
  await page.getByText(BEFORE ? 'Save launch' : 'LAUNCH CHECKLIST', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, `${MODE}-04-editor-checklist`);
  await overflowCheck(page, 'editor-checklist');
  if (BEFORE) { await context.close(); return; }
  await page.getByTestId('launch-checklist').screenshot({ path: path.join(OUT, 'zoom-01-checklist-warnings.png') });

  // Close and open the blocked launch.
  await page.getByLabel('Go back').last().click();
  await page.waitForTimeout(800);
  await page.getByText('Washed denim jacket', { exact: true }).first().click();
  await page.getByText('Edit launch', { exact: true }).first().waitFor({ timeout: 10_000 });
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.getByText('LAUNCH CHECKLIST', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.getByText('Finish the required steps to schedule this launch.', { exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, `${MODE}-05-editor-blocked`);
  await overflowCheck(page, 'editor-blocked');
  await page.getByTestId('launch-checklist').screenshot({ path: path.join(OUT, 'zoom-02-checklist-blocked.png') });
  await context.close();
}

async function audienceFlow(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images });
  await routes(context);
  await openScreen(page, activity, origin, 'seller', '/analytics-audience', { extraQuery: '&demo=1' });
  await waitText(page, 'Devices', '/analytics-audience?bt_preview=seller&demo=1');
  await waitForQuietNetwork(activity, 900, 15_000);
  await page.waitForTimeout(1200);
  const anchor = BEFORE ? page.getByText('Devices', { exact: true }).first() : page.getByText('Most active times', { exact: true }).first();
  await anchor.scrollIntoViewIfNeeded();
  await page.evaluate(() => { for (const el of document.querySelectorAll('*')) { if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight; } });
  await page.waitForTimeout(700);
  await shot(page, `${MODE}-06-audience-bottom`);
  await overflowCheck(page, 'audience');
  if (BEFORE) { await context.close(); return; }
  await page.getByTestId('most-active-times').screenshot({ path: path.join(OUT, 'zoom-03-most-active-hours.png') });
  await page.getByText('Days', { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.getByTestId('most-active-times').screenshot({ path: path.join(OUT, 'zoom-04-most-active-days.png') });
  await shot(page, `${MODE}-07-audience-days`);
  await context.close();
}

async function run() {
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    await launchesFlow(browser, images, server.origin);
    await audienceFlow(browser, images, server.origin);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
