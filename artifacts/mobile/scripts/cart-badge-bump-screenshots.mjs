#!/usr/bin/env node
/**
 * Item 102 — live check of the cart badge bump on add-to-cart at 390×844.
 *
 * Drives the real web build (store-screenshots harness: signed-in demo buyer
 * on the buyer Home feed, fake API; Reduce Motion OFF unless noted) and
 * samples the feed's cart button scale + badge on every animation frame:
 *
 *   A. Load: badge shows the cart count, scale stays 1 (no bump on render).
 *   B. Shop pill → sheet → size → Add to cart: bump (0.78 dip → ~1.18 → 1),
 *      badge +1, cart synced.
 *   C. Product page "Add to bag" → back to the feed: the badge picks up the
 *      new count and bumps (before this PR it kept the stale count).
 *   D. Plain navigate away + back with no add: no bump.
 *   E. Reduce Motion ON: add still updates the badge, no bump.
 *
 *   node scripts/cart-badge-bump-screenshots.mjs [--skip-build]
 *
 * Output: docs/pr-review/cart-badge-bump-102/
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/cart-badge-bump-102');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BUTTON = '[data-testid="feed-cart-button"]';

async function open(browser, images, origin, { reducedMotion }) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  // The first-launch intro splash (components/splash/AppIntroSplash.tsx)
  // plays when motion is allowed; mark it seen so the run starts on Home.
  await page.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
  await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  const syncs = [];
  // The harness's fake API serves a fixed cart; make GET /api/buyer/cart
  // return whatever the app last synced, like the real server does, so a
  // change made on one screen is what the next screen loads.
  let serverCart = null;
  await context.route('https://api.brandthread.test/**', async (route) => {
    const request = route.request();
    const p = new URL(request.url()).pathname.replace(/^\/api\/v1\//, '/api/');
    if (p === '/api/buyer/cart/sync' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      serverCart = { items: body.items ?? [], savedItems: body.savedItems ?? [] };
    }
    if (p === '/api/buyer/cart' && request.method() === 'GET' && serverCart) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
        body: JSON.stringify(serverCart),
      });
    }
    return route.fallback();
  });
  page.on('pageerror', (error) => console.log('  [pageerror]', String(error).slice(0, 400)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) console.log('  [console.error]', m.text().slice(0, 400)); });
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/buyer/cart/sync')) {
      const body = JSON.parse(request.postData() ?? '{}');
      syncs.push((body.items ?? []).reduce((n, i) => n + (i.quantity ?? 0), 0));
    }
  });
  await page.addInitScript((selector) => {
    window.__scale = [];
    const read = () => {
      const el = [...document.querySelectorAll(selector)].find((node) => node.offsetParent !== null);
      if (el) {
        const m = /scale\(([\d.]+)\)/.exec(el.style.transform || '');
        const mm = /matrix\(([-\d.]+)/.exec(getComputedStyle(el).transform);
        const s = m ? Number(m[1]) : mm ? Number(mm[1]) : 1;
        window.__scale.push({ t: performance.now(), s: Math.round(s * 1000) / 1000, badge: el.innerText.trim() });
      }
      requestAnimationFrame(read);
    };
    requestAnimationFrame(read);
  }, BUTTON);
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', '/(buyer)');
    try { await page.getByText('Drop 04 is live').first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  const guide = page.getByTestId('feed-gesture-guide');
  if (await guide.isVisible().catch(() => false)) {
    await guide.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  return { context, page, activity, syncs };
}

const mark = (page) => page.evaluate(() => window.__scale.length);
async function window_(page, from) {
  const trace = (await page.evaluate(() => window.__scale)).slice(from);
  const moving = trace.filter((p) => p.s !== 1);
  const t0 = moving[0]?.t;
  return {
    bumped: moving.length > 0,
    min: moving.length ? Math.min(...moving.map((p) => p.s)) : 1,
    max: moving.length ? Math.max(...moving.map((p) => p.s)) : 1,
    durationMs: moving.length ? Math.round(moving.at(-1).t - t0) : 0,
    settledTo: trace.at(-1)?.s,
    badge: trace.at(-1)?.badge,
    trace: trace.filter((p) => t0 != null && p.t >= t0 - 20 && p.t <= t0 + 900).map((p) => ({ ms: Math.round(p.t - t0), scale: p.s, badge: p.badge })),
  };
}

async function addFromShopSheet(page) {
  // The active post's SHOP pill (virtualized off-screen pages also render one).
  // First tap expands the pill to "Shop <product>, $price"; the second opens the sheet.
  const pill = page.getByTestId('shop-tag-pill').filter({ visible: true }).first();
  await pill.click({ timeout: 8_000 });
  await page.waitForTimeout(700);
  await pill.click({ timeout: 8_000 });
  const sheet = page.getByTestId('shop-product-sheet');
  await sheet.waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  // Multi-product post: the "Shop the post" list comes first → open one product.
  const add = sheet.getByLabel('Add to cart');
  if (!(await add.isVisible().catch(() => false))) {
    await sheet.getByText(/Field Shell Jacket|Heavyweight Hoodie/).first().click();
    await page.waitForTimeout(900);
  }
  await page.screenshot({ path: path.join(OUT, '01b-shop-sheet.jpg'), type: 'jpeg', quality: 82 });
  const size = sheet.getByRole('radio');
  if (await size.count()) await size.first().click();
  await add.click({ timeout: 8_000 });
}

async function frames(page, prefix, count) {
  const box = await page.locator(BUTTON).first().boundingBox();
  const clip = { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 16), width: box.width + 80, height: box.height + 32 };
  for (let i = 0; i < count; i++) await page.screenshot({ path: path.join(OUT, `${prefix}-${String(i).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 90, clip });
}

async function run() {
  if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const report = {};
  try {
    {
      const { context, page, syncs } = await open(browser, images, server.origin, { reducedMotion: false });
      const a = await window_(page, 0);
      report.A_load = { bumped: a.bumped, badge: a.badge };
      await page.screenshot({ path: path.join(OUT, '01-feed-badge-before-add.jpg'), type: 'jpeg', quality: 82 });

      let from = await mark(page);
      await addFromShopSheet(page);
      await frames(page, 'B-frame', 14);
      await page.waitForTimeout(1200);
      const b = await window_(page, from);
      report.B_shopSheetAdd = { ...b, trace: undefined, syncedQty: syncs.at(-1) };
      writeFileSync(path.join(OUT, 'B-scale-trace.json'), JSON.stringify(b.trace, null, 1));
      await page.screenshot({ path: path.join(OUT, '02-after-shop-sheet-add.jpg'), type: 'jpeg', quality: 82 });
      await page.keyboard.press('Escape');
      await page.getByLabel(/close/i).first().click().catch(() => {});
      await page.waitForTimeout(800);

      // C. Add elsewhere (Cart → Saved for later → "Move to cart"), then come
      //    back to the feed with the browser back — real in-app navigation.
      await page.locator(BUTTON).filter({ visible: true }).first().click();
      await page.getByText(/Saved for later/i).first().waitFor({ timeout: 15_000 });
      await page.getByText(/^Move to cart$/).first().click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, '03-cart-moved-saved-item-to-cart.jpg'), type: 'jpeg', quality: 82 });
      from = await mark(page);
      await page.goBack();
      await page.waitForTimeout(250);
      await frames(page, 'C-frame', 10);
      await page.waitForTimeout(1500);
      const c = await window_(page, from);
      report.C_backAfterAddElsewhere = { ...c, trace: undefined, syncedQty: syncs.at(-1) };
      writeFileSync(path.join(OUT, 'C-scale-trace.json'), JSON.stringify(c.trace, null, 1));
      await page.screenshot({ path: path.join(OUT, '04-feed-after-returning.jpg'), type: 'jpeg', quality: 82 });

      // D. Open the cart and come back with no change.
      await page.locator(BUTTON).filter({ visible: true }).first().click();
      await page.getByText(/Saved for later|Order summary/i).first().waitFor({ timeout: 15_000 });
      from = await mark(page);
      await page.goBack();
      await page.waitForTimeout(2000);
      const d = await window_(page, from);
      report.D_refocusNoAdd = { bumped: d.bumped, badge: d.badge };
      await context.close();
    }
    {
      const { context, page, syncs } = await open(browser, images, server.origin, { reducedMotion: true });
      const from = await mark(page);
      await page.screenshot({ path: path.join(OUT, '05-reduce-motion-feed.jpg'), type: 'jpeg', quality: 82 });
      await addFromShopSheet(page).catch((error) => { report.E_error = String(error).split('\n')[0]; });
      await page.waitForTimeout(1500);
      const e = await window_(page, from);
      report.E_reduceMotionAdd = { bumped: e.bumped, badge: e.badge, syncedQty: syncs.at(-1) };
      await context.close();
    }
    for (const [key, value] of Object.entries(report)) console.log(`  ${key}:`, JSON.stringify(value));
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
