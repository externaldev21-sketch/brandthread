#!/usr/bin/env node
/**
 * Saved products + alerts, at 390×844 on the store-screenshots harness:
 * product page heart (unsaved → saved), hearts on product grids (search,
 * seller profile Products tab, discover tiles), Saved with Price drop / Back
 * in stock badges, the per-item alert switches, Activity rows for back in
 * stock / price drop, and the seller's Saves & alerts row. The fake API
 * answers the new endpoints with the exact JSON the real routes return.
 *
 *   node scripts/saved-product-alerts-screenshots.mjs [buildDir]
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { PUBLIC_PRODUCTS } from './store-screenshots/demo-data.mjs';

const BUILD = path.resolve(process.argv[2] ?? DEFAULT_BUILD_DIR);
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/saved-product-alerts');
mkdirSync(OUT, { recursive: true });
const API = 'https://api.brandthread.test';
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true };
const NOW = Date.parse('2026-09-18T23:30:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const HOUR = 3600_000;

const [hoodie, jacket, graphite, runner] = PUBLIC_PRODUCTS;

/** GET /api/buyer/saved — routes/saved.ts → adaptSavedRows shape. */
function savedRows(saved) {
  const row = (p, extra) => ({
    id: `saved_${p.id}`, type: 'product', targetId: p.id, title: p.name, subtitle: p.sellerDisplayName,
    savedAt: iso(3 * 24 * HOUR), notifyOnPriceDrop: true, notifyOnBackInStock: true,
    image: p.images[0], brand: p.sellerDisplayName, priceCents: p.priceCents, priceDropped: false,
    inStock: true, lowStock: false, soldOut: false, backInStock: false, ...extra,
  });
  const rows = [
    row(jacket, { priceCents: 17600, oldPriceCents: 22000, priceDropped: true }),
    row(graphite, { backInStock: true }),
    row(runner, { inStock: false, soldOut: true, notifyOnPriceDrop: false }),
    row(hoodie, {}),
  ];
  return rows.filter((r) => saved.has(r.targetId));
}

/** GET /api/buyer/notifications — notifications-feed.ts adapt() shape for the rows lib/savedProductAlerts.ts writes. */
const activityRows = [
  {
    id: 'n-bis-1', category: 'stock', type: 'back_in_stock', title: 'Back in stock',
    body: `${graphite.name} is back in stock — get it before it's gone again.`, isRead: false, isMuted: false,
    targetId: graphite.id, targetType: 'product', targetImageUrl: graphite.images[0], cta: 'Shop now', createdAt: iso(20 * 60_000),
  },
  {
    id: 'n-pd-1', category: 'stock', type: 'price_drop', title: 'Price drop',
    body: `${jacket.name} just dropped to $176.00.`, isRead: false, isMuted: false,
    targetId: jacket.id, targetType: 'product', targetImageUrl: jacket.images[0], cta: 'Shop now', createdAt: iso(2 * HOUR),
  },
];

/** GET /api/products/:id/save-stats — lib/savedProductAlerts.ts productSaveStats(). */
const saveStats = { saves: 184, priceAlertsOn: 171, restockAlertsOn: 176, backInStockReached: 139, priceDropReached: 58, lastAlertAt: iso(5 * HOUR) };

async function routeApi(context, origin, saved) {
  await context.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fallback();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    if (p === '/api/buyer/saved' && request.method() === 'GET') return json(savedRows(saved));
    if (p === '/api/buyer/saved' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      saved.add(body.targetId);
      return json(savedRows(saved).find((r) => r.targetId === body.targetId) ?? { id: 'new', type: 'product', targetId: body.targetId, title: body.title }, 201);
    }
    let m;
    if ((m = p.match(/^\/api\/buyer\/saved\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      if (request.method() === 'DELETE') { saved.delete(id); return json({ ok: true }); }
      return json({ ...(savedRows(saved).find((r) => r.targetId === id) ?? {}), ...JSON.parse(request.postData() ?? '{}') });
    }
    if (p === '/api/buyer/notifications') return json(activityRows);
    if (/^\/api\/products\/[^/]+\/save-stats$/.test(p)) return json(saveStats);
    return route.fallback();
  });
}

/** openScreen, retrying the client-side push until `ready` resolves (the preview nav tree can remount once and drop it). */
async function go(page, activity, origin, role, target, ready) {
  await openScreen(page, activity, origin, role, target);
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await ready(15_000); return; } catch (error) {
      if (attempt === 3) throw error;
      await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); },
        `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}`);
    }
  }
}

async function session(browser, origin, images, role, saved, fn) {
  try { return await sessionInner(browser, origin, images, role, saved, fn); } catch (error) { console.warn(`  ✗ ${error.message.split('\n')[0]}`); }
}

async function sessionInner(browser, origin, images, role, saved, fn) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images });
  await routeApi(context, origin, saved);
  page.setDefaultTimeout(60_000);
  try {
    await fn(page, activity);
  } catch (error) {
    if (process.env.SHOT_DEBUG_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DEBUG_DIR, `fail-${Date.now()}.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

async function settle(page, activity, ms = 600) {
  await waitForQuietNetwork(activity, 800, 20_000);
  await waitForImages(page);
  await page.waitForTimeout(ms);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function run() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const origin = server.origin;
  try {
    // Product page: unsaved, then tap the heart.
    await session(browser, origin, images, 'buyer', new Set(), async (page, activity) => {
      await go(page, activity, origin, 'buyer', `/buyer-product-detail?productId=${hoodie.id}`,
        (timeout) => page.getByTestId('product-save-heart').waitFor({ state: 'visible', timeout }));
      await settle(page, activity, 1200);
      await shot(page, '01-product-heart-unsaved');
      await page.getByTestId('product-save-heart').click();
      // After the "Saved" toast has gone.
      await page.waitForTimeout(5500);
      await shot(page, '02-product-heart-saved');
    });

    // Grids with hearts.
    await session(browser, origin, images, 'buyer', new Set([hoodie.id, jacket.id]), async (page, activity) => {
      // Search is pushed from the feed's search icon (top right).
      await openScreen(page, activity, origin, 'buyer', '/');
      await settle(page, activity, 800);
      await page.mouse.click(330, 81);
      await page.getByPlaceholder('Search').first().waitFor({ state: 'visible' });
      await page.getByPlaceholder('Search').first().fill('hoodie');
      await page.keyboard.press('Enter');
      await page.getByText('Products', { exact: true }).first().click();
      await page.locator('[data-testid^="save-heart-"]').first().waitFor({ state: 'visible' });
      await settle(page, activity, 800);
      await shot(page, '03-search-grid-hearts');
    });
    await session(browser, origin, images, 'buyer', new Set([hoodie.id]), async (page, activity) => {
      await go(page, activity, origin, 'buyer', '/seller-profile?id=user_northline',
        (timeout) => page.getByTestId('seller-profile-hero').waitFor({ state: 'attached', timeout }));
      await settle(page, activity);
      await page.getByTestId('profile-tab-shop').click();
      await settle(page, activity, 1000);
      await page.mouse.move(195, 600);
      await page.mouse.wheel(0, 560);
      await settle(page, activity, 900);
      await shot(page, '04-seller-profile-products-hearts');
    });
    await session(browser, origin, images, 'buyer', new Set([jacket.id]), async (page, activity) => {
      await openScreen(page, activity, origin, 'buyer', '/(buyer)/discover');
      await settle(page, activity, 1200);
      const tile = page.locator('[data-testid^="save-heart-"]').first();
      if (await tile.count()) {
        await tile.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 120);
        await settle(page, activity, 600);
      }
      await shot(page, '05-discover-tiles-hearts');
    });

    // Saved: badges + alert switches.
    await session(browser, origin, images, 'buyer', new Set([hoodie.id, jacket.id, graphite.id, runner.id]), async (page, activity) => {
      await go(page, activity, origin, 'buyer', '/buyer-saved',
        (timeout) => page.getByText('Price drop', { exact: true }).first().waitFor({ state: 'visible', timeout }));
      await settle(page, activity, 1000);
      await shot(page, '06-saved-badges');
      // Long-press the Trail Runner tile — the row's quick-actions sheet.
      const box = await page.getByText('Trail Runner 02 — Clay').first().boundingBox();
      await page.mouse.move(box.x + 40, box.y - 120);
      await page.mouse.down();
      await page.waitForTimeout(900);
      await page.mouse.up();
      await page.getByTestId('saved-alert-price-drop').waitFor({ state: 'visible' });
      await page.waitForTimeout(900);
      await shot(page, '07-saved-alert-toggles');
    });

    // Activity rows.
    await session(browser, origin, images, 'buyer', new Set(), async (page, activity) => {
      await openScreen(page, activity, origin, 'buyer', '/activity-center');
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await page.getByText('Back in stock').first().waitFor({ state: 'visible', timeout: 12_000 }); break; } catch (error) {
          if (attempt === 3) throw error;
          await page.evaluate(() => { history.pushState(history.state, '', '/activity-center?bt_preview=buyer'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
        }
      }
      await settle(page, activity, 1000);
      await shot(page, '08-activity-back-in-stock-price-drop');
    });

    // Seller: Saves & alerts on product Analytics.
    await session(browser, origin, images, 'seller', new Set(), async (page, activity) => {
      const target = '/product-detail?id=preview-product-1&tab=analytics&demo=1';
      await openScreen(page, activity, origin, 'seller', target);
      for (let attempt = 0; attempt < 4; attempt++) {
        try { await page.getByText('Saves & alerts').first().waitFor({ state: 'attached', timeout: 15_000 }); break; } catch (error) {
          if (attempt === 3) throw error;
          await page.evaluate((url) => { history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, `${target}&bt_preview=seller`);
        }
      }
      await page.getByText('Saves & alerts').first().scrollIntoViewIfNeeded();
      await settle(page, activity, 800);
      await shot(page, '09-seller-product-saves-alerts');
    });
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
