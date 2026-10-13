#!/usr/bin/env node
/**
 * Verification screenshots for F6 item 89 — save posts to collections
 * (Instagram 1:1). Real component code paths run against the fake API; the
 * demo feed's post ids are rewritten to UUIDs (the app only persists saves for
 * real post ids) and the saved/collections endpoints are answered here.
 *
 *   node scripts/f6-save-collections-screenshots.mjs              # builds first
 *   node scripts/f6-save-collections-screenshots.mjs --skip-build
 *
 * Output: ../../docs/pr-assets/save-collections/ours/<NN-step>.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST, respond } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'save-collections', 'ours');
const API = 'https://api.brandthread.test';
const uuidFor = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FITS = 'c0000000-0000-4000-8000-0000000000f1';
const WEEKEND = 'c0000000-0000-4000-8000-0000000000f2';
const iso = new Date(DEMO_NOW).toISOString();

async function shot(page, index, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(process.cwd(), file)}`);
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = {
    viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

  // State the fake saved/collections API keeps for this run.
  const saved = new Map();
  const collections = [
    { id: FITS, name: 'Fits', coverImageUrl: `${IMAGE_HOST}/demo/look-mono.jpg`, isPublic: false, sortOrder: 0, itemCount: 3, createdAt: iso, updatedAt: iso },
    { id: WEEKEND, name: 'Weekend', coverImageUrl: `${IMAGE_HOST}/demo/runner-rust.jpg`, isPublic: false, sortOrder: 1, itemCount: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ];
  const view = (row) => ({ ...row, collectionId: row.collectionId ?? undefined });

  // 1) Every demo API answer, with post_demo_N ids rewritten to UUIDs.
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    const url = new URL(req.url());
    const body = respond({ method: req.method(), path: url.pathname, query: url.searchParams, role: 'buyer', options: {} });
    if (body === undefined) return route.fallback();
    const text = JSON.stringify(body).replace(/post_demo_(\d+)/g, (_m, n) => uuidFor(Number(n)));
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: text });
  });
  // 2) Saved items + collections.
  await page.route(`${API}/api/**/buyer/saved**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const targetId = decodeURIComponent(url.pathname.split('/buyer/saved/')[1] ?? '');
    if (req.method() === 'GET') return json(route, [...saved.values()].map(view));
    if (req.method() === 'POST') {
      const b = req.postDataJSON();
      const n = Number(b.targetId.slice(-12));
      const row = saved.get(b.targetId) ?? {
        id: `s-${n}`, type: b.type, targetId: b.targetId, title: b.title, subtitle: b.subtitle,
        accentColor: b.accentColor, collectionId: b.collectionId ?? null, savedAt: iso, notifyOnPriceDrop: false,
        image: `${IMAGE_HOST}/demo/${['look-rust', 'jacket-rust', 'hoodie-moss', 'story-mono'][(n - 1) % 4]}.jpg`,
        priceDropped: false, lowStock: false, soldOut: false, backInStock: false,
      };
      saved.set(b.targetId, row);
      return json(route, view(row), 201);
    }
    if (req.method() === 'PATCH') {
      const row = saved.get(targetId);
      if (!row) return json(route, { error: 'Saved item not found' }, 404);
      const prev = row.collectionId;
      row.collectionId = req.postDataJSON().collectionId ?? null;
      for (const c of collections) {
        if (c.id === prev) c.itemCount -= 1;
        if (c.id === row.collectionId) { c.itemCount += 1; c.coverImageUrl = row.image; c.updatedAt = new Date(Date.now()).toISOString(); }
      }
      return json(route, view(row));
    }
    if (req.method() === 'DELETE') { saved.delete(targetId); return json(route, { ok: true }); }
    return route.fallback();
  });
  await page.route(`${API}/api/**/buyer/collections**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const m = url.pathname.match(/buyer\/collections\/([^/]+)\/items/);
    if (m) {
      const c = collections.find((x) => x.id === m[1]);
      if (!c) return json(route, { error: 'Collection not found' }, 404);
      const extra = [
        { id: 'x1', type: 'product', targetId: 'prod_nl_hoodie_ember', title: 'Heavyweight Hoodie — Ember', brand: 'Northline', priceCents: 9800, image: `${IMAGE_HOST}/demo/hoodie-ember.jpg`, savedAt: iso },
        { id: 'x2', type: 'post', targetId: uuidFor(90), title: 'Studio day. Sampling the FW26 cargo in rust.', subtitle: 'Northline', image: `${IMAGE_HOST}/demo/cargo-rust.jpg`, savedAt: iso },
      ];
      const items = [...[...saved.values()].filter((r) => r.collectionId === c.id).map(view), ...extra];
      return json(route, { collection: { ...c, itemCount: items.length }, items });
    }
    if (req.method() === 'GET') return json(route, [...collections].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    return route.fallback();
  });

  let i = 0;
  try {
    // Feed: tap Save on the first post.
    for (let attempt = 0; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', '/');
      const ok = await page.getByLabel(/^Save, /).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
      if (ok) break;
      if (attempt >= 3) throw new Error('feed never loaded');
    }
    await page.waitForTimeout(1500);
    await waitForImages(page, 4000);
    await page.getByLabel(/^Save, /).first().click();
    await page.getByText('Save to collection', { exact: true }).waitFor({ timeout: 10_000 });
    // The bar stays 4s (SaveHeartHost TOAST_MS): shoot right away.
    await page.waitForTimeout(350);
    await shot(page, ++i, 'feed-saved-bar');

    await page.getByText('Save to collection', { exact: true }).click();
    await page.getByTestId('save-to-collection-sheet').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(700);
    await shot(page, ++i, 'save-to-sheet');

    await page.getByTestId('save-to-collection-sheet').getByText('Fits', { exact: true }).click();
    await page.getByText('Saved to Fits').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(350);
    await shot(page, ++i, 'saved-to-collection-view');

    await page.getByText('View', { exact: true }).click();
    await page.waitForTimeout(1500);
    await waitForImages(page);
    await shot(page, ++i, 'collection-with-post');

    await page.evaluate((url) => {
      history.pushState(history.state, '', url);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, '/buyer-saved?bt_preview=buyer');
    await page.waitForTimeout(1500);
    await waitForImages(page);
    await shot(page, ++i, 'saved-all-with-post');
    await page.getByText('Collections', { exact: true }).first().click();
    await page.waitForTimeout(800);
    await waitForImages(page);
    await shot(page, ++i, 'saved-collections-cover');

  } catch (error) {
    console.error(`  failed: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, ++i, 'FAILED-state').catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
