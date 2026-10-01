#!/usr/bin/env node
/**
 * Verification script for the save heart + Recently viewed row (not part of the
 * store screenshot pipeline). Uses the demo harness (stub Clerk account + fake
 * API) and layers a small stateful /buyer/saved, /buyer/collections and
 * /buyer/recently-viewed on top so taps really save and unsave.
 *
 * Usage (after buildPreviewWeb()):
 *   node scripts/store-screenshots/save-heart-verify.mjs [outDir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
  launchBrowser, openContext, openScreen, serveBuild, waitForQuietNetwork, waitForImages,
} from './harness.mjs';
import { checkTextFitDetailed, formatTextFitReport } from '../textFitCheck.mjs';
import { ensureDemoImages } from './demo-images.mjs';
import { PUBLIC_PRODUCTS } from './demo-data.mjs';

const OUT = path.resolve(process.argv[2] ?? path.join(MOBILE_ROOT, '.save-heart-verify'));
mkdirSync(OUT, { recursive: true });

const DEMO_API = 'https://api.brandthread.test';
const log = [];

const COLLECTIONS = [
  { id: 'col_fits', name: 'Fall fits', isPublic: false, sortOrder: 0, itemCount: 4, coverImageUrl: null, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z' },
  { id: 'col_gifts', name: 'Gift ideas', isPublic: true, sortOrder: 1, itemCount: 2, coverImageUrl: null, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z' },
];

async function installSavedApi(context, origin, { recentlyViewed }) {
  const saved = [];
  await context.route(`${DEMO_API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api\/v\d+/, '').replace(/^\/api/, '');
    const cors = {
      'access-control-allow-origin': origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'authorization,content-type,x-store-context',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
    const method = request.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (p === '/buyer/saved' && method === 'GET') { log.push('GET saved'); return json(saved); }
    if (p === '/buyer/saved' && method === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}');
      log.push(`POST saved ${body.targetId}`);
      if (!saved.find((s) => s.targetId === body.targetId)) saved.unshift({ id: `s_${saved.length}`, type: body.type, targetId: body.targetId, title: body.title, subtitle: body.subtitle, savedAt: new Date().toISOString(), collectionId: body.collectionId ?? undefined });
      return json(saved[0], 201);
    }
    let m;
    if ((m = p.match(/^\/buyer\/saved\/([^/]+)$/)) && method === 'DELETE') {
      log.push(`DELETE saved ${decodeURIComponent(m[1])}`);
      const i = saved.findIndex((s) => s.targetId === decodeURIComponent(m[1]));
      if (i >= 0) saved.splice(i, 1);
      return json({ ok: true });
    }
    if ((m = p.match(/^\/buyer\/saved\/([^/]+)$/)) && method === 'PATCH') {
      const body = JSON.parse(request.postData() ?? '{}');
      log.push(`PATCH saved ${decodeURIComponent(m[1])} -> ${body.collectionId}`);
      const row = saved.find((s) => s.targetId === decodeURIComponent(m[1]));
      if (row) row.collectionId = body.collectionId ?? undefined;
      return json(row ?? {});
    }
    if (p === '/buyer/collections' && method === 'GET') return json(COLLECTIONS);
    if (p === '/buyer/recently-viewed' && method === 'GET') return json(recentlyViewed);
    if (p === '/buyer/recently-viewed' && method === 'POST') return route.fulfill({ status: 204, headers: cors });
    return route.fallback();
  });
  return saved;
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  try {
    const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: undefined };
    const recentlyViewed = PUBLIC_PRODUCTS.slice(3, 8).map((p, i) => ({
      productId: p.id, name: p.name, brand: p.sellerDisplayName, image: p.images[0], priceCents: p.priceCents,
      viewedAt: new Date(Date.now() - i * 3600_000).toISOString(),
    }));
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    const saved = await installSavedApi(context, origin, { recentlyViewed });
    page.on('pageerror', (e) => console.log('pageerror', e.message));

    const shot = async (name) => {
      await waitForImages(page); await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(formatTextFitReport(name, await checkTextFitDetailed(page, { minPadX: 12 })));
    };

    const zoom = async (name, locator, { up, down, pad = 0 }) => {
      const b = await locator.boundingBox();
      if (!b) return;
      const vp = page.viewportSize();
      const y = Math.max(0, b.y - up);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x: pad, y, width: vp.width - pad * 2, height: Math.min(vp.height - y, up + b.height + down) } });
    };

    // ── Discover: hearts on the rails, then save one ────────────────────
    await openScreen(page, activity, origin, 'buyer', '/discover');
    await page.getByText('For You').first().waitFor({ timeout: 20000 });
    await waitForQuietNetwork(activity, 800, 12000);
    await page.waitForTimeout(800);
    const heartCount = await page.locator('[data-testid^="save-heart-"]').count();
    console.log('hearts on discover:', heartCount);
    await shot('01-discover-unsaved');

    const first = page.locator('[data-testid^="save-heart-"]').first();
    const firstId = (await first.getAttribute('data-testid')).replace('save-heart-', '');
    await first.click();
    await page.waitForTimeout(700);
    await shot('02-discover-saved-toast');
    await zoom('zoom-discover-card-hearts', page.locator('[data-testid^="save-heart-"]').first(), { up: 215, down: 120 });
    console.log('server saved after tap:', saved.map((s) => s.targetId), 'first', firstId);

    // ── Long-press on a second heart → Save to… sheet ───────────────────
    const second = page.locator('[data-testid^="save-heart-"]').nth(1);
    const box = await second.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(900);
    await shot('03-save-to-collection-sheet');
    await page.getByText('Fall fits').first().click();
    await page.waitForTimeout(900);
    await shot('04-after-filing');
    console.log('server saved after sheet:', saved.map((s) => `${s.targetId}:${s.collectionId ?? '-'}`));

    // ── Un-save by tapping the first heart again ────────────────────────
    await page.locator(`[data-testid="save-heart-${firstId}"]`).first().click();
    await page.waitForTimeout(700);
    console.log('server saved after un-save:', saved.map((s) => s.targetId));

    // ── Recently viewed row at the bottom of Discover ───────────────────
    await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('div')].filter((n) => n.scrollHeight > n.clientHeight + 200 && getComputedStyle(n).overflowY !== 'visible');
      nodes.forEach((n) => { n.scrollTop = n.scrollHeight; });
    });
    await page.waitForTimeout(900);
    await shot('05-discover-recently-viewed');
    console.log('recently viewed visible:', await page.getByText('Recently viewed').count());

    // ── Product detail: unsaved, then saved ─────────────────────────────
    await openScreen(page, activity, origin, 'buyer', '/thread-product-detail?productId=prod_nl_jacket_rust');
    await waitForQuietNetwork(activity, 800, 12000);
    await page.waitForTimeout(1200);
    await shot('06-detail-saved-from-cache');
    const detailHeart = page.locator('[data-testid="product-save-heart"]').first();
    console.log('detail heart present:', await detailHeart.count());
    await detailHeart.click();
    await page.waitForTimeout(700);
    await shot('07-detail-toggled');
    await zoom('zoom-detail-chrome-row', detailHeart, { up: 40, down: 40 });

    // ── Search results grid ─────────────────────────────────────────────
    await openScreen(page, activity, origin, 'buyer', '/buyer-search');
    await waitForQuietNetwork(activity, 800, 12000);
    await page.getByPlaceholder('Search').first().fill('hoodie');
    await page.waitForTimeout(900);
    await page.getByPlaceholder('Search').first().press('Enter');
    await page.waitForTimeout(1200);
    const productsTab = page.getByText('Products', { exact: true }).first();
    if (await productsTab.count()) await productsTab.click();
    await page.locator('[data-testid^="save-heart-"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    await waitForQuietNetwork(activity, 800, 12000);
    await page.waitForTimeout(1000);
    await shot('08-search-results');
    await zoom('zoom-search-card-hearts', page.locator('[data-testid^="save-heart-"]').first(), { up: 260, down: 120 });
    console.log('hearts on search:', await page.locator('[data-testid^="save-heart-"]').count());

    console.log('api log:', log.join(' | '));
    await context.close();
  } finally {
    await close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
