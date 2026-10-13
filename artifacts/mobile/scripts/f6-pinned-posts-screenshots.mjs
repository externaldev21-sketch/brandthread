#!/usr/bin/env node
/**
 * Verification screenshots for F6 item 76 — "Pin to your profile" (Instagram).
 *
 *   node scripts/f6-pinned-posts-screenshots.mjs
 *   node scripts/f6-pinned-posts-screenshots.mjs --skip-build
 *
 * 01: a profile grid with three pinned posts first, pushpin glyph top-right.
 * 02: owner's post viewer with the ••• (More options) header button.
 * 03/05: the ••• sheet with Pin to your profile / Unpin from profile; 04: pinned toast.
 * Then pinning at the 3-pin cap asks to replace the oldest pin (web confirm text logged).
 * The pin endpoints and the pinned grid are faked with page routes.
 *
 * Output: docs/pr-assets/pinned-posts/ours/<NN-step>.png (repo root)
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW, respond, SELLER_USER } from './store-screenshots/demo-data.mjs';

const OUTPUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'pinned-posts', 'ours');
const API = 'https://api.brandthread.test';
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
const POST_ID = '7d3f6f5e-4b1a-4c55-9d8e-2f1a0c9b7e11';

async function shot(page, name) {
  mkdirSync(OUTPUT, { recursive: true });
  const file = path.join(OUTPUT, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(path.resolve(MOBILE_ROOT, '..', '..'), file)}`);
}

async function openReliably(page, activity, origin, role, target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await openScreen(page, activity, origin, role, target);
    await page.waitForTimeout(600);
    const pathname = await page.evaluate(() => window.location.pathname);
    if (pathname.startsWith(target.split('?')[0])) return;
  }
  throw new Error(`Navigation to ${target} never took effect`);
}

const cors = (origin) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'authorization,content-type,x-store-context',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
});
const json = (origin, status, body) => ({ status, headers: cors(origin), contentType: 'application/json', body: JSON.stringify(body) });

/** Northline's grid: the two demo posts repeated to six tiles, the first three pinned. */
function pinnedGrid() {
  const base = respond({ method: 'GET', path: `/api/public/users/${SELLER_USER.id}/videos`, query: new URLSearchParams(), role: 'buyer', options: {} });
  const src = base.videos;
  const videos = Array.from({ length: 6 }, (_, i) => ({
    ...src[i % src.length],
    id: `pin-demo-${i + 1}`,
    pinnedAt: i < 3 ? new Date(DEMO_NOW - i * 3_600_000).toISOString() : null,
  }));
  return { ...base, total: videos.length, videos };
}

async function grid(browser, origin, images) {
  console.log('\n== profile grid ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  await page.route(`${API}/api/**/public/users/${SELLER_USER.id}/videos**`, (route) => (
    route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors(origin) }) : route.fulfill(json(origin, 200, pinnedGrid()))
  ));
  try {
    await openReliably(page, activity, origin, 'buyer', `/seller-profile?id=${SELLER_USER.id}`);
    await page.waitForSelector('[data-testid="profile-tile-pinned-pin-demo-1"]', { state: 'attached', timeout: 30_000 });
    await waitForQuietNetwork(activity, 600, 8_000);
    // Bring both rows (3 pinned, then 3 unpinned) into view.
    await page.evaluate(() => document.querySelector('[data-testid="profile-video-tile-pin-demo-4"]')?.scrollIntoView({ block: 'end' }));
    await page.waitForTimeout(500);
    await waitForImages(page);
    await shot(page, '01-profile-grid-pinned-first');
  } catch (error) {
    console.error(`  ✗ grid: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-grid').catch(() => {});
  } finally {
    await context.close();
  }
}

async function viewer(browser, origin, images) {
  console.log('\n== owner post viewer ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  const state = { full: false };
  await page.route(`${API}/api/**/posts/*/pin`, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    if (req.method() === 'DELETE') return route.fulfill(json(origin, 200, { pinned: false, pins: [] }));
    const body = JSON.parse(req.postData() ?? '{}');
    if (state.full && !body.replaceOldest) return route.fulfill(json(origin, 409, { error: 'You can pin up to 3 posts. Replace your oldest pinned post?', code: 'PIN_LIMIT', max: 3, pinned: ['a', 'b', 'c'] }));
    return route.fulfill(json(origin, 201, { pinned: true, pinnedAt: new Date(DEMO_NOW).toISOString(), replaced: body.replaceOldest ? 'a' : null, pins: [POST_ID] }));
  });
  try {
    await openReliably(page, activity, origin, 'buyer', `/buyer-post-viewer?postId=${POST_ID}`);
    const more = page.getByRole('button', { name: 'More options' });
    const pinRow = page.getByTestId('post-owner-sheet-pin');
    await more.waitFor({ timeout: 30_000 });
    await waitForImages(page);
    await page.waitForTimeout(400);
    await shot(page, '02-post-viewer-more-button');

    await more.click();
    await pinRow.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '03-owner-sheet-pin');

    await pinRow.click();
    await page.getByText('Post pinned to your profile').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '04-post-viewer-pinned-toast');

    // Sheet now offers Unpin.
    await more.click();
    await page.getByText('Unpin from profile').waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, '05-owner-sheet-unpin');
    await pinRow.click();
    await page.getByText('Post unpinned').waitFor({ timeout: 10_000 });

    // With 3 pins already used, pinning asks to replace the oldest.
    state.full = true;
    await page.waitForTimeout(400);
    await more.click();
    await pinRow.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    const dialog = page.waitForEvent('dialog');
    await pinRow.click();
    const d = await dialog;
    console.log(`    replace prompt: ${JSON.stringify(d.message())}`);
    await d.accept();
    await page.getByText('Post pinned to your profile').waitFor({ timeout: 10_000 });
    console.log('    replaced oldest pin: ok');
  } catch (error) {
    console.error(`  ✗ viewer: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-viewer').catch(() => {});
  } finally {
    await context.close();
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  rmSync(OUTPUT, { recursive: true, force: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
    await grid(browser, origin, images);
    await viewer(browser, origin, images);
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
