#!/usr/bin/env node
/**
 * Verification screenshots for F6 item 77 — polls in Threads (X poll pattern).
 *
 *   node scripts/f6-thread-polls-screenshots.mjs
 *   node scripts/f6-thread-polls-screenshots.mjs --skip-build
 *
 * Seller: Thread composer → Poll row → poll editor (empty, filled, poll length open) → row summary.
 * Buyer: feed Thread with a poll before voting, after voting; post viewer with final results.
 * The poll endpoints are faked with page routes (the demo API has no polls).
 *
 * Output: docs/pr-assets/thread-polls/ours/<NN-step>.png (repo root)
 */
import { mkdirSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW } from './store-screenshots/demo-data.mjs';

const OUTPUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'thread-polls', 'ours');
const API = 'https://api.brandthread.test';
const device = { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };

function png(w, h, rgb) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

const iso = (ms) => new Date(DEMO_NOW + ms).toISOString();
const OPTIONS = ['Ember', 'Graphite', 'Bone', 'Moss'];
function poll(postId, { voted = null, ended = false } = {}) {
  const counts = [412, 268, 133, 87];
  const total = counts.reduce((a, b) => a + b, 0) + (voted !== null ? 1 : 0);
  const shown = voted !== null || ended;
  const withMine = counts.map((c, i) => c + (voted === i ? 1 : 0));
  const pct = [46, 29, 15, 10];
  return {
    postId,
    options: OPTIONS.map((text, i) => ({ text, votes: shown ? withMine[i] : null, percent: shown ? pct[i] : null })),
    totalVotes: total,
    durationMinutes: 1440,
    endsAt: ended ? iso(-3_600_000) : iso((23 * 60 + 12) * 60_000),
    isEnded: ended,
    myVote: voted,
    isAuthor: false,
    canVote: voted === null && !ended,
    showResults: shown,
    winner: ended ? 0 : null,
  };
}

async function routePolls(page, origin, state) {
  await page.route(`${API}/api/**/posts/polls**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const ids = (new URL(route.request().url()).searchParams.get('ids') ?? '').split(',').filter(Boolean);
    const polls = Object.fromEntries(ids.filter((id) => id === 'post_demo_1').map((id) => [id, poll(id, state)]));
    return route.fulfill({ status: 200, headers: cors(origin), contentType: 'application/json', body: JSON.stringify({ polls }) });
  });
  await page.route(`${API}/api/**/posts/*/poll/vote`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(origin) });
    const { optionIndex } = JSON.parse(route.request().postData() ?? '{}');
    state.voted = optionIndex;
    return route.fulfill({ status: 201, headers: cors(origin), contentType: 'application/json', body: JSON.stringify({ poll: poll('post_demo_1', state) }) });
  });
}

async function seller(browser, origin) {
  console.log('\n== seller composer ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'seller', origin, images: {} });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  try {
    await openReliably(page, activity, origin, 'seller', '/create-post?mode=thread&capture=0');
    await page.getByTestId('create-post-screen').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: /accept all/i }).click({ timeout: 2000 }).catch(() => {});
    await page.getByRole('button', { name: 'Allow access' }).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('[data-testid="gallery-file-input"]').setInputFiles([
      { name: 'photo0.png', mimeType: 'image/png', buffer: png(240, 320, [70, 70, 74]) },
    ]);
    await page.getByTestId('gallery-tab-photos').click().catch(() => {});
    await page.locator('[data-testid^="gallery-tile-"]').first().click();
    await page.getByTestId('gallery-next').click();
    await page.getByTestId('slide-editor').waitFor({ timeout: 15_000 });
    await page.getByTestId('edit-next').click();
    await page.getByTestId('post-screen').waitFor({ timeout: 15_000 });
    await page.getByTestId('caption-input').fill('Which colour should we restock first?');
    await page.waitForTimeout(300);
    await shot(page, '01-composer-poll-row');

    await page.getByTestId('row-poll').click();
    await page.getByTestId('poll-page').waitFor();
    await page.waitForTimeout(300);
    await shot(page, '02-poll-editor-empty');

    await page.getByTestId('poll-choice-input-0').fill('Ember');
    await page.getByTestId('poll-choice-input-1').fill('Graphite');
    await page.getByTestId('poll-add-choice').click();
    await page.getByTestId('poll-choice-input-2').fill('Bone');
    await page.getByTestId('poll-add-choice').click();
    await page.getByTestId('poll-choice-input-3').fill('Moss');
    await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => {});
    await page.waitForTimeout(300);
    await shot(page, '03-poll-editor-filled');

    await page.getByTestId('poll-length').click();
    await page.waitForTimeout(300);
    await shot(page, '04-poll-length-open');

    await page.getByTestId('poll-done').click();
    await page.waitForTimeout(400);
    await shot(page, '05-composer-poll-added');
  } catch (error) {
    console.error(`  ✗ seller: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-seller').catch(() => {});
  } finally {
    await context.close();
  }
}

async function buyer(browser, origin, images) {
  console.log('\n== buyer feed ==');
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  const state = { voted: null, ended: false };
  await routePolls(page, origin, state);
  try {
    await openReliably(page, activity, origin, 'buyer', '/feed');
    await page.waitForSelector('[data-testid="poll-post_demo_1"]', { timeout: 20_000 });
    await waitForQuietNetwork(activity, 600, 8_000);
    // The For You list opens on the High Demand card; swipe to the first Thread.
    await page.getByTestId('poll-post_demo_1').scrollIntoViewIfNeeded();
    await waitForImages(page);
    await page.waitForTimeout(800);
    await shot(page, '06-feed-poll-before-vote');

    await page.getByTestId('poll-choice-0').first().click();
    await page.waitForSelector('[data-testid="poll-result-0"]', { timeout: 10_000 });
    await page.waitForTimeout(400);
    await shot(page, '07-feed-poll-after-vote');
  } catch (error) {
    console.error(`  ✗ buyer feed: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, 'FAILED-buyer-feed').catch(() => {});
  } finally {
    await context.close();
  }

  console.log('\n== buyer post viewer (ended) ==');
  const second = await openContext(browser, { device, role: 'buyer', origin, images });
  const endedState = { voted: null, ended: true };
  await routePolls(second.page, origin, endedState);
  try {
    await openReliably(second.page, second.activity, origin, 'buyer', '/buyer-post-viewer?postId=post_demo_1');
    await second.page.waitForSelector('[data-testid="poll-post_demo_1"]', { timeout: 20_000 });
    await waitForImages(second.page);
    await second.page.waitForTimeout(600);
    await second.page.getByTestId('poll-post_demo_1').scrollIntoViewIfNeeded().catch(() => {});
    await shot(second.page, '08-post-viewer-final-results');
  } catch (error) {
    console.error(`  ✗ viewer: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(second.page, 'FAILED-viewer').catch(() => {});
  } finally {
    await second.context.close();
  }
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  rmSync(OUTPUT, { recursive: true, force: true });
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  try {
    const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
    await seller(browser, origin);
    await buyer(browser, origin, images);
  } finally {
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
