#!/usr/bin/env node
/**
 * Threads followed-first — first Threads card, before (dev) vs after (branch),
 * signed-in demo buyer, fake API.
 *
 * Fake API: /api/public/posts serves suggested posts with a non-followed brand
 * (Ember) first and Northline last; /api/feed/followed-fresh serves Northline's
 * new post. Dev never calls followed-fresh, so its first card is Ember; the
 * branch leads with Northline.
 *
 *   node scripts/threads-following-first-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Before: /home/user/baseline-web-build (prebuilt dev). After: this branch's
 * .store-screenshots/web-build. Output: docs/pr-assets/threads-following-first/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { respond } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/threads-following-first');
const BASELINE = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICES = [{ width: 390, height: 844 }, { width: 393, height: 852 }];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

const all = () => respond({ method: 'GET', path: '/api/public/posts', query: new URLSearchParams(), role: 'buyer' });
const isNorthline = (post) => /northline/i.test(post.seller?.brandName ?? '');

async function capture(browser, images, buildDir, label, followedFreshCalls) {
  const server = await serveBuild(buildDir);
  try {
    for (const viewport of DEVICES) {
      const device = { viewport, scale: 2, isMobile: true, userAgent: UA };
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
      await context.route((url) => url.pathname.endsWith('/public/posts'), (route) => {
        if (route.request().method() === 'OPTIONS') return route.fallback();
        const offset = Number(new URL(route.request().url()).searchParams.get('offset') ?? 0);
        const posts = all();
        const suggested = [...posts.filter((p) => !isNorthline(p)), ...posts.filter(isNorthline)];
        return route.fulfill(json(server.origin, offset === 0 ? suggested : []));
      });
      await context.route((url) => url.pathname.endsWith('/feed/followed-fresh'), (route) => {
        if (route.request().method() === 'OPTIONS') return route.fallback();
        followedFreshCalls.count += 1;
        return route.fulfill(json(server.origin, all().filter((p) => p.id === 'post_demo_1')));
      });
      await openScreen(page, activity, server.origin, 'buyer', '/(buyer)');
      await page.getByText(/Boxy fleece|Drop 04 is live/).first().waitFor({ timeout: 20_000 });
      await waitForQuietNetwork(activity);
      const guide = page.getByTestId('feed-gesture-guide');
      if (await guide.isVisible().catch(() => false)) { await guide.click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(400); }
      await waitForImages(page);
      await page.waitForTimeout(1200);
      const file = path.join(OUT, `${label}-first-threads-card-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: file });
      console.log('saved', file);
      await context.close();
    }
  } finally {
    server.close();
  }
}

async function run() {
  const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
  if (only !== 'before' && (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html')))) buildPreviewWeb(DEFAULT_BUILD_DIR);
  if (!existsSync(path.join(BASELINE, 'index.html'))) throw new Error(`Missing dev baseline build at ${BASELINE}`);
  mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    const before = { count: 0 };
    const after = { count: 0 };
    if (only !== 'after') await capture(browser, images, BASELINE, 'before', before);
    if (only !== 'before') await capture(browser, images, DEFAULT_BUILD_DIR, 'after', after);
    console.log(`followed-fresh calls: before=${before.count} after=${after.count}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
