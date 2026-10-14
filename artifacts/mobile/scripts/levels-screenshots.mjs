#!/usr/bin/env node
/**
 * Brand membership levels: before (dev) and after, at 393x852, with the
 * store-screenshots harness and fake brand-membership / day-one responses.
 * Scenes: the buyer's own profile brands row with levels, a brand's store
 * header for that buyer, and the seller's Membership levels settings.
 *
 *   node scripts/levels-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/levels/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/levels');
const BASELINE_DIR = '/home/user/baseline-web-build';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: UA };
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

const brand = (sellerId, name, initials, level, spendCents) => ({ sellerId, name, handle: '', initials, avatarUrl: null, level, spendCents, next: null });

async function setup(browser, images, origin) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  const is = (url, re) => re.test(url.pathname);
  const ok = (route, body) => (route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, body)));
  await context.route((url) => is(url, /\/api(\/v1)?\/brand-membership\/mine$/), (r) => ok(r, { brands: [
    brand('user_northline', 'Northline Studio', 'NS', 'inner_circle', 142_000),
    brand('user_quiet', 'Quiet Hours', 'QH', 'insider', 31_000),
    brand('user_fieldoffice', 'Field Office', 'FO', 'member', 8_800),
  ] }));
  await context.route((url) => is(url, /\/api(\/v1)?\/brand-membership\/brand\//), (r) => ok(r, { sellerId: 'x', level: 'insider', spendCents: 31_000, next: { level: 'inner_circle', remainingCents: 69_000 } }));
  await context.route((url) => is(url, /\/api(\/v1)?\/brand-membership\/settings$/), (r) => ok(r, { insiderCents: 25_000, innerCircleCents: 100_000, innerCircleEarlyAccessMinutes: 60 }));
  // The demo data has no store pages; a plain public seller profile for Quiet Hours.
  await context.route((url) => is(url, /\/api(\/v1)?\/public\/sellers\/user_quiet$/), (r) => ok(r, { profile: {
    clerkId: 'user_quiet', brandName: 'Quiet Hours', username: 'quiethours', bio: 'Heavyweight basics, made slowly.',
    category: 'Basics', productsCount: 12, videosCount: 0, followersCount: 2140, followingCount: 18, likesCount: 9300,
  } }));
  await context.route((url) => is(url, /\/api(\/v1)?\/day-one\//), (r) => ok(r, { brands: [
    { sellerId: 'user_northline', name: 'Northline Studio', handle: '', initials: 'NS', avatarUrl: null, rank: 18, since: '2026-03-01T00:00:00Z' },
  ] }));
  return { context, page, activity };
}

async function open(page, activity, origin, target, waitText) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', target);
    // Some routes settle back on the home tab after sign-in; navigate again once it has.
    await page.waitForTimeout(3000);
    if (!page.url().includes(target.split('?')[0].replace(/[()]/g, '').split('/').pop())) {
      await page.evaluate((url) => {
        history.pushState(history.state, '', url);
        window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
      }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=buyer`);
    }
    try { await page.getByText(waitText).first().waitFor({ timeout: 30_000 }); break; } catch (e) {
      await page.screenshot({ path: path.join(WORK_DIR, 'levels-fail.png') });
      if (attempt >= 3) throw e;
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(800);
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const o = server.origin;
  try {
    const { context, page, activity } = await setup(browser, images, o);
    if (!process.argv.includes('--store-only')) {
      await open(page, activity, o, '/(buyer)/profile', 'Edit profile');
      await page.screenshot({ path: path.join(OUT, `${label}-own-profile-393x852.png`) });
    }
    await open(page, activity, o, '/seller-profile?sellerId=user_quiet', label === 'after' ? 'Your level: Insider' : 'Quiet Hours');
    await page.screenshot({ path: path.join(OUT, `${label}-store-header-393x852.png`) });
    if (label === 'after' && !process.argv.includes('--store-only')) {
      // The seller preview is offline by design (lib/devPreview.ts); the settings screen is shown under the signed-in session.
      await open(page, activity, o, '/membership-levels', 'Membership levels');
      await page.screenshot({ path: path.join(OUT, `${label}-seller-settings-393x852.png`) });
    }
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
