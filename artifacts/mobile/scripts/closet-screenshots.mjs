#!/usr/bin/env node
/**
 * PR screenshots for the Digital Closet at 393x852 (iPhone 15/16):
 *   profile → Closet tab (Pieces), Outfits, New outfit picker, board,
 *   saved outfit, create flow with the pieces pre-tagged.
 *
 *   node scripts/closet-screenshots.mjs [--build <dir>] [--out <dir>] [--before]
 *
 * --before shoots only the profile, for the "before" column (run it against
 * a build of origin/dev). Output defaults to docs/pr-assets/closet/ours.
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
const OUT = path.resolve(arg('--out', path.resolve(MOBILE_ROOT, `../../docs/pr-assets/closet/${BEFORE ? 'before' : 'ours'}`)));
const API = 'https://api.brandthread.test';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const day = (d) => `2026-${d}T15:00:00.000Z`;
export const PIECES = [
  { id: uuid(11), orderId: uuid(1), productId: uuid(21), name: 'Heavyweight Hoodie', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 9800, imageUrl: `${IMAGE_HOST}/hoodie-ember.jpg`, orderedAt: day('10-01'), deliveredAt: day('10-06') },
  { id: uuid(12), orderId: uuid(1), productId: uuid(22), name: 'Field Shell Jacket', brand: 'Northline', sellerId: 's1', size: 'M', priceCents: 18_500, imageUrl: `${IMAGE_HOST}/jacket-rust.jpg`, orderedAt: day('10-01'), deliveredAt: day('10-06') },
  { id: uuid(13), orderId: uuid(2), productId: uuid(23), name: 'Utility Cargo', brand: 'Field Office', sellerId: 's2', size: '32', priceCents: 12_000, imageUrl: `${IMAGE_HOST}/cargo-rust.jpg`, orderedAt: day('09-20'), deliveredAt: day('09-25') },
  { id: uuid(14), orderId: uuid(2), productId: uuid(24), name: 'Trail Runner 02', brand: 'Field Office', sellerId: 's2', size: '10', priceCents: 14_000, imageUrl: `${IMAGE_HOST}/runner-stone.jpg`, orderedAt: day('09-20'), deliveredAt: day('09-25') },
  { id: uuid(15), orderId: uuid(3), productId: uuid(25), name: 'Heavyweight Hoodie', brand: 'Northline', sellerId: 's1', size: 'L', priceCents: 9800, imageUrl: `${IMAGE_HOST}/hoodie-graphite.jpg`, orderedAt: day('08-28'), deliveredAt: day('09-02') },
  { id: uuid(16), orderId: uuid(3), productId: uuid(26), name: 'Coach Jacket', brand: 'Quiet Label', sellerId: 's3', size: 'M', priceCents: 16_000, imageUrl: `${IMAGE_HOST}/jacket-onyx.jpg`, orderedAt: day('08-28'), deliveredAt: day('09-02') },
];
const OUTFIT = { id: uuid(31), createdAt: day('10-07'), pieces: [PIECES[1], PIECES[2], PIECES[3]] };

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

async function installRoutes(page, origin) {
  await page.route(rx('/buyer/closet/pieces'), (r) => fulfill(r, origin, { pieces: PIECES }));
  await page.route(rx('/buyer/closet/outfits'), (r) => (r.request().method() === 'POST'
    ? fulfill(r, origin, { outfit: OUTFIT }, 201)
    : fulfill(r, origin, { outfits: [OUTFIT] })));
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(400);
  await waitForImages(page);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${name}.png`);
}

async function go(page, activity, origin, target, waitTestId) {
  if (target === '/profile') {
    // The profile is a tab: open the app, then tap it like a person would.
    await openScreen(page, activity, origin, 'buyer', '/', { extraQuery: '&demo=1' });
    await page.getByLabel('Profile tab').first().click({ timeout: 15_000 });
  } else {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', target, { extraQuery: '&demo=1' });
      await page.waitForTimeout(800);
      if ((await page.evaluate(() => window.location.pathname)).startsWith(target.split('?')[0])) break;
    }
  }
  if (waitTestId) await page.getByTestId(waitTestId).first().waitFor({ timeout: 15_000 });
  await waitForQuietNetwork(activity, 600, 8000);
  await page.waitForTimeout(600);
}

async function step(page, label, fn) {
  try { await fn(); } catch (err) {
    console.error(`  ✗ ${label}: ${String(err?.message ?? err).split('\n')[0]}`);
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `FAILED-${label}.png`) }).catch(() => {});
  }
}

async function scrollToTabs(page) {
  await page.getByTestId('profile-tab-posts').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(500);
}

async function main() {
  if (!existsSync(path.join(BUILD, 'index.html'))) buildPreviewWeb(BUILD);
  const { origin, close } = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
  try {
    const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
    page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
    await installRoutes(page, origin);

    if (BEFORE) {
      await step(page, 'profile', async () => {
        await go(page, activity, origin, '/profile', 'profile-tab-posts');
        await scrollToTabs(page);
        await shot(page, '01-profile-tabs');
      });
      return;
    }

    await step(page, 'closet-pieces', async () => {
      await go(page, activity, origin, '/profile', 'profile-tab-closet');
      await page.getByTestId('profile-tab-closet').click();
      await page.getByTestId(`closet-piece-${PIECES[0].id}`).waitFor({ timeout: 10_000 });
      await scrollToTabs(page);
      await shot(page, '01-closet-pieces');
      await page.getByTestId('closet-view-outfits').click();
      await page.getByTestId(`closet-outfit-${OUTFIT.id}`).waitFor({ timeout: 10_000 });
      await shot(page, '02-closet-outfits');
    });

    await step(page, 'picker', async () => {
      await go(page, activity, origin, '/closet-outfit', 'closet-outfit-pick');
      for (const p of [PIECES[1], PIECES[2], PIECES[3]]) await page.getByTestId(`closet-pick-${p.id}`).click();
      await shot(page, '03-new-outfit-pick');
      await page.getByTestId('closet-outfit-next').click();
      await page.getByTestId('closet-outfit-board').waitFor({ timeout: 10_000 });
      await shot(page, '04-new-outfit-board');
    });

    await step(page, 'saved', async () => {
      await go(page, activity, origin, `/closet-outfit?id=${OUTFIT.id}`, 'closet-outfit-board');
      await shot(page, '05-saved-outfit');
    });

    await step(page, 'post-fit', async () => {
      await page.getByTestId('closet-outfit-post').click();
      // Existing create flow: camera → Upload → pick a photo → Next until the post step.
      await page.getByTestId('create-camera-roll').click({ timeout: 15_000 });
      await page.getByTestId('post-picker').waitFor({ timeout: 10_000 });
      const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
      await page.getByTestId('picker-browse').click({ force: true, timeout: 8000 });
      await (await chooser).setFiles(images['look-rust'] ?? Object.values(images)[0]);
      await page.waitForTimeout(1500);
      // The picked file lands as a tile; tap it to select it.
      await page.locator('[data-testid^="picker-tile-"]').last().click({ force: true, timeout: 8000 });
      await page.waitForTimeout(800);
      for (let i = 0; i < 4 && !(await page.getByTestId('row-closet-tags').isVisible().catch(() => false)); i += 1) {
        const next = page.getByRole('button', { name: /^next$/i }).first();
        if (await next.isVisible().catch(() => false)) await next.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1500);
      }
      await page.getByTestId('row-closet-tags').waitFor({ timeout: 8000 });
      await shot(page, '06-post-step-pieces-tagged');
    });
    await context.close();
  } finally {
    await browser.close();
    close();
  }
  console.log(`Done → ${OUT}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
