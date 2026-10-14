#!/usr/bin/env node
/**
 * PR screenshots for Monthly Wrapped at 393x852, on Oct 2 (inside the 7-day
 * window): the profile card, every recap card, and the share card.
 *
 *   node scripts/wrapped-screenshots.mjs [--build <dir>] [--out <dir>] [--before]
 *
 * --before: the same profile on the same date, for the "before" column (run
 * against a build of origin/dev).
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BEFORE = process.argv.includes('--before');
const BUILD = arg('--build', DEFAULT_BUILD_DIR);
const OUT = path.resolve(arg('--out', path.resolve(MOBILE_ROOT, `../../docs/pr-assets/wrapped/${BEFORE ? 'before' : 'ours'}`)));
const API = 'https://api.brandthread.test';
const OCT_2 = Date.parse('2026-10-02T16:00:00Z');

const WRAPPED = {
  month: '2026-09', available: true, totalPieces: 4, brandCount: 2,
  topBrands: [
    { sellerId: 's1', name: 'Northline', pieces: 3, imageUrl: `${IMAGE_HOST}/jacket-rust.jpg` },
    { sellerId: 's2', name: 'Field Office', pieces: 1, imageUrl: `${IMAGE_HOST}/runner-stone.jpg` },
  ],
  mostPosted: { productId: 'p1', name: 'Field Shell Jacket', brand: 'Northline', imageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, posts: 3 },
  supporter: { brand: 'Northline', topPercent: 4 },
  coverImageUrl: `${IMAGE_HOST}/jacket-rust.jpg`,
};

function rx(rest) {
  const esc = rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${API.replace(/[.]/g, '\\.')}/api(/v1)?${esc}(\\?.*)?$`);
}
async function fulfill(route, origin, body, status = 200) {
  const headers = {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
  return route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await waitForImages(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${name}.png`);
}
async function step(page, label, fn) {
  try { await fn(); } catch (err) {
    console.error(`  ✗ ${label}: ${String(err?.message ?? err).split('\n')[0]}`);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  }
}

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images, installClock: false });
    await context.clock.install({ time: OCT_2 });
    await page.route(rx('/buyer/wrapped'), (r) => fulfill(r, origin, WRAPPED));
    await page.route(rx('/buyer/closet/pieces'), (r) => fulfill(r, origin, { pieces: [] }));
    await page.route(rx('/buyer/closet/outfits'), (r) => fulfill(r, origin, { outfits: [] }));

    await step(page, 'profile', async () => {
      await openScreen(page, activity, origin, 'buyer', '/', { extraQuery: '&demo=1' });
      await page.getByLabel('Profile tab').first().click({ timeout: 15_000 });
      await page.getByTestId(BEFORE ? 'profile-tab-posts' : 'wrapped-profile-card').first().waitFor({ timeout: 15_000 });
      await waitForQuietNetwork(activity, 600, 8000);
      await page.mouse.wheel(0, 160);
      await shot(page, '01-profile-oct-2');
    });
    if (BEFORE) { await context.close(); return; }

    await step(page, 'story', async () => {
      await page.getByTestId('wrapped-profile-card-open').click();
      await page.getByTestId('wrapped-card-intro').waitFor({ timeout: 15_000 });
      const names = ['02-intro', '03-pieces', '04-top-brands', '05-most-posted', '06-top-percent', '07-share-card'];
      for (let i = 0; i < names.length; i += 1) {
        await page.waitForTimeout(700);
        await shot(page, names[i]);
        if (i < names.length - 1) await page.getByTestId('wrapped-next').click();
      }
    });
    await context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Done → ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
