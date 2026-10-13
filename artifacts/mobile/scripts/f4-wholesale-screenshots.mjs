#!/usr/bin/env node
/**
 * Wholesale price list (item 59) on the store-screenshots harness (signed-in
 * demo account, fake API), with a text-fit check on every screen.
 *
 *   node scripts/f4-wholesale-screenshots.mjs <buildDir> <outDir> <after|before> [width height]
 *
 * after:  More > Store row, Wholesale screen (top + buyer requests), Price list,
 *         price sheet, store ••• menu row, buyer apply / pending / approved.
 * before: only the two existing screens this PR touches (More, store ••• menu).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForImages, waitForQuietNetwork } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const MODE = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 393), height: Number(process.argv[6] ?? 852) };
const TAG = `${VIEWPORT.width}x${VIEWPORT.height}`;
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const SELLER = 'user_northline';
const failures = [];

const ME = {
  none: { enabled: true, status: 'none', businessName: null, minOrderCents: 25000, priceList: [] },
  approved: {
    enabled: true, status: 'approved', businessName: 'Harbor Supply', minOrderCents: 25000,
    priceList: [
      { id: 'p1', name: 'Ember hoodie', image: null, variants: [{ id: 'v1', label: 'M', priceCents: 8900, wholesaleCents: 5340, minQuantity: 6 }] },
      { id: 'p2', name: 'Heavyweight tee', image: null, variants: [{ id: 'v2', label: 'M', priceCents: 4800, wholesaleCents: 2880, minQuantity: 1 }] },
      { id: 'p3', name: 'Canvas tote', image: null, variants: [{ id: 'v3', label: 'One size', priceCents: 3200, wholesaleCents: 1500, minQuantity: 12 }] },
    ],
  },
};

async function textFit(page, label) {
  const offenders = await page.evaluate(() => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!walker.currentNode.textContent.trim() || !el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.bottom < 0 || box.top > innerHeight) continue;
      const reasons = [];
      if (style.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) reasons.push('ellipsis cut');
      if (el.scrollHeight > el.clientHeight + 2 && style.overflowY === 'hidden') reasons.push('clipped vertically');
      if (box.left < -0.5 || box.right > vw + 0.5) reasons.push('outside screen');
      if (reasons.length) out.push({ text: el.textContent.trim().slice(0, 40), reasons });
    }
    return out;
  });
  if (offenders.length) failures.push({ screen: label, offenders });
  console.log(`  ${offenders.length ? 'x' : 'ok'} text-fit ${label}${offenders.length ? ` ${JSON.stringify(offenders)}` : ''}`);
}

function json(route, origin, body, status = 200) {
  return route.fulfill({
    status, contentType: 'application/json',
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
    body: JSON.stringify(body),
  });
}

/**
 * demo=true: the dev preview with &demo=1 sample data (no API).
 * demo=false: boots the signed-in session, then drops the preview flag so the
 * screen runs its real code path against the fake API (+ `routes`).
 */
async function open(browser, origin, images, { role, target, demo, routes, cold = false }) {
  const { context, page, activity } = await openContext(browser, { device: { viewport: VIEWPORT, scale: 2, isMobile: true }, role, origin, images });
  if (routes) {
    await context.route(`${API}/**`, async (route) => {
      const request = route.request();
      if (request.method() === 'OPTIONS') return route.fallback();
      const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
      const handled = await routes(p, request, (body, status) => json(route, origin, body, status));
      if (handled === false) return route.fallback();
    });
  }
  page.setDefaultNavigationTimeout(240_000);
  await page.goto(`${origin}/?bt_preview=${role}${demo ? '&demo=1' : ''}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(2500);
  if (!demo) await page.evaluate(() => { localStorage.removeItem('user_role'); });
  const url = demo ? `${target}${target.includes("?") ? "&" : "?"}bt_preview=${role}&demo=1` : target;
  const wanted = target.split('?')[0];
  if (cold) {
    // Cold load of the deep link: the layout restores it after its own redirects, keeping the query.
    await page.goto(`${origin}${url}`);
    await page.waitForTimeout(6000);
  }
  for (let attempt = 0; attempt < (cold ? 0 : 6); attempt++) {
    await page.evaluate((u) => { history.pushState(history.state, '', u); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, url);
    await page.waitForTimeout(2500);
    if (new URL(page.url()).pathname === wanted) break;
  }
  await waitForQuietNetwork(activity, 900, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(1200);
  console.log(`  at ${page.url()}`);
  return { context, page };
}

async function need(page, locator, name) {
  try { await locator.waitFor({ timeout: 30_000 }); } catch (error) {
    await page.screenshot({ path: path.join(OUT, `FAIL-${name}.png`) });
    console.log('  PAGE TEXT:', (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400), page.url());
    throw error;
  }
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), caret: 'hide' });
  console.log(`  ok ${name}`);
}

async function moreRow(browser, origin, images, prefix) {
  const { context, page } = await open(browser, origin, images, { role: 'seller', target: '/more', demo: true });
  await need(page, page.getByText('Gift cards').first(), 'more');
  // Centre the end of the Store group so it clears the tab bar (before and after show the same region).
  await page.getByText('Discounts', { exact: true }).first().evaluate(el => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(800);
  await shot(page, `${prefix}-more-store-${TAG}`);
  await textFit(page, `more-${TAG}`);
  await context.close();
}

async function storeMenu(browser, origin, images, prefix) {
  const routes = async (p, _req, reply) => {
    if (p === `/api/wholesale/store/${SELLER}`) return reply({ enabled: true, minOrderCents: 25000 });
    return false;
  };
  const { context, page } = await open(browser, origin, images, { role: 'buyer', target: `/seller-profile?id=${SELLER}`, demo: true, routes });
  await need(page, page.getByTestId('seller-profile-more'), 'profile');
  await page.waitForTimeout(1500);
  await page.getByTestId('seller-profile-more').click();
  await page.waitForTimeout(1200);
  await shot(page, `${prefix}-store-menu-${TAG}`);
  await textFit(page, `store-menu-${TAG}`);
  if (prefix === 'after') {
    await page.getByText('Wholesale pricing', { exact: true }).click();
    await page.waitForTimeout(2500);
    await need(page, page.getByText('You’re approved'), 'apply-from-menu');
    await shot(page, `after-06-buyer-apply-from-menu-${TAG}`);
  }
  await context.close();
}

async function buyerApply(browser, origin, images) {
  let state = 'none';
  const routes = async (p, request, reply) => {
    if (p === `/api/wholesale/store/${SELLER}/me`) return reply(state === 'pending' ? { ...ME.none, status: 'pending', businessName: 'Harbor Supply' } : ME[state]);
    if (p === `/api/wholesale/store/${SELLER}/apply` && request.method() === 'POST') { state = 'pending'; return reply({ status: 'pending', businessName: 'Harbor Supply' }, 201); }
    return false;
  };
  const target = `/wholesale-apply?sellerId=${SELLER}&name=Northline%20Studio`;
  {
    const { context, page } = await open(browser, origin, images, { role: 'buyer', target, demo: false, routes });
    await need(page, page.getByText('Business name'), 'apply');
    await shot(page, `after-07-buyer-apply-${TAG}`);
    await textFit(page, 'apply');
    await page.getByLabel('Business name').fill('Harbor Supply');
    await page.getByText('Apply', { exact: true }).click();
    await need(page, page.getByText('Request sent'), 'pending');
    await page.waitForTimeout(600);
    await shot(page, `after-08-buyer-pending-${TAG}`);
    await textFit(page, 'pending');
    await context.close();
  }
  state = 'approved';
  {
    const { context, page } = await open(browser, origin, images, { role: 'buyer', target, demo: true, routes, cold: true });
    await need(page, page.getByText('You’re approved'), 'approved');
    await shot(page, `after-09-buyer-approved-price-list-${TAG}`);
    await textFit(page, 'approved');
    await context.close();
  }
}

async function sellerScreens(browser, origin, images) {
  {
    const { context, page } = await open(browser, origin, images, { role: 'seller', target: '/wholesale', demo: true, cold: true, routes: async (p) => { if (p.includes('wholesale')) console.log('  API', p); return false; } });
    await need(page, page.getByText('Wholesale pricing'), 'wholesale');
    await shot(page, `after-02-wholesale-top-${TAG}`);
    await textFit(page, 'wholesale-top');
    await page.getByText('Approved buyers').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(600);
    await shot(page, `after-03-wholesale-buyer-requests-${TAG}`);
    await textFit(page, 'wholesale-requests');
    await page.getByText('Approve', { exact: true }).first().click();
    await page.waitForTimeout(900);
    await shot(page, `after-03b-wholesale-approved-toast-${TAG}`);
    await context.close();
  }
  {
    const { context, page } = await open(browser, origin, images, { role: 'seller', target: '/wholesale-products', demo: true, cold: true });
    await need(page, page.getByText('Canvas tote'), 'products');
    await shot(page, `after-04-price-list-${TAG}`);
    await textFit(page, 'price-list');
    await page.getByText('Canvas tote').click();
    await page.waitForTimeout(1500);
    await need(page, page.getByText('Minimum quantity'), 'sheet');
    await shot(page, `after-05-price-sheet-${TAG}`);
    await textFit(page, 'price-sheet');
    await context.close();
  }
}

async function run() {
  const server = await serveBuild(BUILD);
  const origin = server.origin;
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  try {
    await moreRow(browser, origin, images, MODE === 'before' ? 'before' : 'after');
    await storeMenu(browser, origin, images, MODE === 'before' ? 'before' : 'after');
    if (MODE !== 'before') {
      await sellerScreens(browser, origin, images);
      await buyerApply(browser, origin, images);
    }
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(path.join(OUT, `text-fit-${MODE}-${TAG}.json`), JSON.stringify({ viewport: VIEWPORT, failures }, null, 2));
  if (failures.length) { console.error('TEXT-FIT FAILURES', JSON.stringify(failures, null, 2)); process.exit(2); }
  console.log('text-fit: all screens clean');
}

run().catch((error) => { console.error(error); process.exit(1); });
