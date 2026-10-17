#!/usr/bin/env node
/**
 * Hands-on QA captures for the App Review fixes on claude/launch-appstore,
 * at 390×844 (iPhone 12–16 logical size).
 *
 *   node scripts/store-screenshots/launch-appstore-verify.mjs --build-dir <web export> --out <dir> [--label before|after]
 *
 * Uses the store-screenshot harness (preview build, signed-in demo account,
 * fake API) and stubs the few endpoints these screens need with real-shaped
 * rows: a real (non-sample) LIVE room, a replay owned by someone else and a
 * replay that fails to load. Each capture is also
 * taken with every text run scaled to 135% (iOS's largest standard Dynamic
 * Type size, xxxLarge) to check the layout holds.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const BUILD_DIR = path.resolve(args['build-dir']);
const OUT = path.resolve(args.out);
const LABEL = args.label ?? 'after';
const API = 'https://api.brandthread.test';
const DEVICE = {
  id: 'iphone-390',
  viewport: { width: 390, height: 844 },
  scale: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  isMobile: true,
};

const LIVE_STREAM = {
  id: 'stream_northline_1', seller_id: 'seller_northline', brand_name: 'Northline Studio', title: 'Drop 04 try-on: Ember hoodies',
  viewer_count: 214, avatar_url: null, thumbnail_url: null,
  product_tags: [{ productId: 'prod_nl_hoodie_ember', productName: 'Heavyweight Hoodie — Ember', priceCents: 9800 }],
};
const REPLAY = {
  streamId: 'stream_northline_0', sellerId: 'seller_northline', postId: null, title: 'Drop 03 restock walkthrough', description: null,
  thumbnailUrl: null, replayUrl: 'https://img.brandthread.test/missing.mp4', peakViewerCount: 512,
  startedAt: '2026-10-10T18:00:00.000Z', endedAt: '2026-10-10T18:42:00.000Z', durationSeconds: 2520, isOwner: false,
};

async function stub(page, origin, pattern, status, body) {
  await page.route(new RegExp(`^${API.replace(/\./g, '\\.')}/api(/v1)?${pattern.replace(/\?/g, '\\?')}(\\?.*)?$`), (route) => route.fulfill({
    status,
    headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context' },
    contentType: 'application/json',
    body: JSON.stringify(body),
  }));
}

/** Scales every text node's font-size and line-height by `factor` (Dynamic Type proxy on web). */
async function scaleText(page, factor) {
  await page.evaluate((f) => {
    for (const el of document.querySelectorAll('div[dir="auto"], span')) {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      if (!fs || el.dataset.btScaled) continue;
      el.dataset.btScaled = '1';
      el.style.fontSize = `${fs * f}px`;
      const lh = parseFloat(cs.lineHeight);
      if (lh) el.style.lineHeight = `${lh * f}px`;
    }
  }, factor);
  await page.waitForTimeout(300);
}

async function shot(page, name, { dynamicType = true } = {}) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}-${LABEL}.png`) });
  if (dynamicType && LABEL === 'after') {
    await scaleText(page, 1.35);
    await page.screenshot({ path: path.join(OUT, `${name}-xxxl-${LABEL}.png`) });
  }
}

const CASES = [
  {
    name: 'live-feed-more-sheet',
    role: 'buyer',
    path: '/live-feed',
    async setup(page, origin) { await stub(page, origin, '/live/active', 200, { streams: [LIVE_STREAM] }); },
    async run(page) {
      await page.getByText('Northline Studio').first().waitFor({ timeout: 20_000 });
      await page.getByLabel('More options').first().click();
      await page.getByTestId('live-more-sheet').waitFor({ timeout: 5_000 });
      await shot(page, 'live-feed-more-sheet', { dynamicType: false });
      await page.getByText('Report', { exact: true }).first().click();
      await page.waitForTimeout(800);
      await shot(page, 'live-feed-report', { dynamicType: false });
    },
  },
  {
    name: 'live-replay',
    role: 'buyer',
    path: '/live-replay?streamId=stream_northline_0',
    async setup(page, origin) { await stub(page, origin, '/live-replays/stream_northline_0', 200, { replay: REPLAY }); },
    async run(page) {
      await page.getByText('Drop 03 restock walkthrough').first().waitFor({ timeout: 20_000 });
      await shot(page, 'live-replay');
      const more = page.getByLabel('More options').first();
      if (await more.count()) {
        await more.click();
        await page.waitForTimeout(600);
        await shot(page, 'live-replay-menu', { dynamicType: false });
      }
    },
  },
  {
    name: 'live-replay-error',
    role: 'buyer',
    path: '/live-replay?streamId=stream_offline',
    async setup(page, origin) { await stub(page, origin, '/live-replays/stream_offline', 503, { error: { code: 'UNAVAILABLE', message: 'Service unavailable' } }); },
    async run(page) {
      await page.getByText("Couldn't load this replay").first().waitFor({ timeout: 20_000 });
      await shot(page, 'live-replay-error');
    },
  },
];

const server = await serveBuild(BUILD_DIR);
const browser = await launchBrowser();
mkdirSync(OUT, { recursive: true });
let failed = 0;
try {
  for (const c of CASES) {
    const { context, page, activity } = await openContext(browser, { device: DEVICE, role: c.role, origin: server.origin, images: {} });
    try {
      await c.setup(page, server.origin);
      // Direct load of the route (deep-link style), so the screen under test is
      // the first thing the router mounts.
      await page.goto(`${server.origin}${c.path}${c.path.includes('?') ? '&' : '?'}bt_preview=${c.role}`);
      await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
      await waitForQuietNetwork(activity, 800, 15_000);
      await c.run(page);
      console.log(`✓ ${c.name}`);
    } catch (error) {
      failed += 1;
      console.log(`✗ ${c.name}: ${String(error?.message ?? error).split('\n')[0]}`);
      await page.screenshot({ path: path.join(OUT, `${c.name}-${LABEL}-failed.png`) }).catch(() => {});
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failed && LABEL === 'after' ? 1 : 0);
