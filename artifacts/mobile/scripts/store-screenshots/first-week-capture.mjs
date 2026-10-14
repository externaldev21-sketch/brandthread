#!/usr/bin/env node
/**
 * First-week checklist card at 393x852 (fake API): buyer Discover and the
 * new-seller Dashboard, mid-way and done. Same screens on a build without the
 * card for the "before" shots.
 *
 *   node scripts/store-screenshots/first-week-capture.mjs <web-build-dir> <out-dir>
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MOBILE_ROOT, launchBrowser, openContext, serveBuild, waitForQuietNetwork } from './harness.mjs';
import { ensureDemoImages } from './demo-images.mjs';

const [buildDir, outDir] = process.argv.slice(2);
if (!buildDir || !outDir) throw new Error('usage: first-week-capture.mjs <web-build-dir> <out-dir>');
mkdirSync(outDir, { recursive: true });
const device = { viewport: { width: 393, height: 852 }, scale: 3, isMobile: true, userAgent: undefined };

const BUYER = {
  visible: true, role: 'buyer', allDone: false, reward: { cents: 200, granted: false },
  steps: [
    { id: 'follow_brands', label: 'Follow 3 brands', done: true, href: '/(buyer)/discover' },
    { id: 'post_fit', label: 'Post a fit', done: false, href: '/create-post' },
    { id: 'save_item', label: 'Save something you like', done: true, href: '/(buyer)/discover' },
    { id: 'profile_photo', label: 'Add a profile photo', done: false, href: '/(buyer)/edit-profile' },
  ],
};
const SELLER = {
  visible: true, role: 'seller', allDone: false, reward: { cents: 200, granted: false },
  steps: [
    { id: 'add_products', label: 'Add 3 products', done: false, href: '/add-product' },
    { id: 'share_store', label: 'Share your store', done: true, href: '/share-store' },
    { id: 'post_fit', label: 'Post a fit', done: false, href: '/create-post' },
    { id: 'profile_photo', label: 'Add a logo', done: true, href: '/edit-profile' },
  ],
};
const SELLER_DONE = { ...SELLER, allDone: true, reward: { cents: 200, granted: true }, steps: SELLER.steps.map((s) => ({ ...s, done: true })) };

async function fakeFirstWeek(context, appOrigin, body) {
  const cors = {
    'access-control-allow-origin': appOrigin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
  await context.route(/api\.brandthread\.test\/api(\/v1)?\/first-week/, (route) => (route.request().method() === 'OPTIONS'
    ? route.fulfill({ status: 204, headers: cors })
    : route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) })));
}

const browser = await launchBrowser();
const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'demo-images'));
const { origin, close } = await serveBuild(path.resolve(buildDir));
async function capture(name, role, url, body, apiOptions, scrollTo) {
  const { context, page, activity } = await openContext(browser, { device, role, origin, images, apiOptions });
  await fakeFirstWeek(context, origin, body);
  await page.goto(`${origin}${url}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 600, 10_000).catch(() => {});
  if (scrollTo) {
    const el = page.getByTestId(scrollTo);
    await el.waitFor({ timeout: 8_000 }).catch(() => {});
    if (await el.count()) await el.first().scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`  ✓ ${name}`);
  await context.close();
}
try {
  await capture('01-buyer-discover', 'buyer', '/(buyer)/discover', BUYER, {}, null);
  await capture('02-seller-dashboard', 'seller', '/(tabs)/', SELLER, { fresh: true, emptyProducts: true }, 'first-week-card');
  await capture('03-seller-dashboard-done', 'seller', '/(tabs)/', SELLER_DONE, { fresh: true, emptyProducts: true }, 'first-week-card');
} finally {
  await browser.close();
  close();
}
