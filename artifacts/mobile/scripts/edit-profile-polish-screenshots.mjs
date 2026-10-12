#!/usr/bin/env node
/**
 * Verification screenshots for the Edit profile polish: the seller Edit
 * profile with ONE avatar control (top, under the banner) and a Logo-only row
 * under the Storefront preview, and the dark "Add banner" placeholder on Edit
 * profile + own profiles when no banner is set (visitors unchanged).
 *
 *   node scripts/edit-profile-polish-screenshots.mjs --build-dir <dir> --out <dir>
 *
 * Uses the signed-out dev web preview with `&demo=1&banner=video`.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, serveBuild,
  waitForImages, waitForQuietNetwork, DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const BUILD_DIR = arg('--build-dir') ?? DEFAULT_BUILD_DIR;
const OUT = path.resolve(arg('--out') ?? path.join(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'edit-profile-polish', 'after'));
const ONLY = arg('--only');
const VIEWPORT = { width: 390, height: 844 };

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function open(page, activity, origin, role, target, query) {
  await page.goto(`${origin}/?bt_preview=${role}${query}`);
  await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 20_000 });
  await waitForQuietNetwork(activity, 800, 15_000);
  await page.waitForTimeout(3000);
  await page.evaluate(() => { localStorage.removeItem('user_role'); });
  const url = `${target}${target.includes('?') ? '&' : '?'}bt_preview=${role}${query}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.evaluate((next) => {
      history.pushState(history.state, '', next);
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    }, url);
    await page.waitForTimeout(1200);
    const here = target.split('?')[0];
    if (await page.evaluate((h) => location.pathname === h && document.querySelectorAll('[data-testid]').length > 2, here)) return;
  }
}

/** Scrolls the screen's main scroll container by `dy` points. */
async function scrollBy(page, dy) {
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(900);
}

const SCENES = [
  { name: '01-seller-edit-profile-no-banner', role: 'seller', target: '/edit-profile', query: '&demo=1' },
  { name: '02-seller-edit-profile-logo-row-no-banner', role: 'seller', target: '/edit-profile', query: '&demo=1', scrollToText: 'Storefront preview' },
  { name: '03-seller-edit-profile-with-banner', role: 'seller', target: '/edit-profile', query: '&demo=1&banner=video' },
  { name: '04-seller-edit-profile-logo-row-with-banner', role: 'seller', target: '/edit-profile', query: '&demo=1&banner=video', scrollToText: 'Storefront preview' },
  { name: '05-buyer-edit-profile-no-banner', role: 'buyer', target: '/edit-profile', query: '&demo=1' },
  { name: '06-own-seller-profile-no-banner', role: 'seller', target: '/profile', query: '&demo=1', ready: 'profile-hero' },
  { name: '07-own-buyer-profile-no-banner', role: 'buyer', target: '/profile', query: '&demo=1', ready: 'buyer-profile' },
  { name: '08-visited-seller-no-banner-unchanged', role: 'buyer', target: '/seller-profile?id=user_northline', query: '&demo=1', ready: 'seller-profile-hero' },
  { name: '09-own-buyer-profile-with-banner-unchanged', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile' },
];

async function run() {
  if (!arg('--build-dir')) buildPreviewWeb(BUILD_DIR);
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const scene of SCENES) {
      if (ONLY && !scene.name.includes(ONLY)) continue;
      console.log(`\n== ${scene.name} ==`);
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
      const { context, page, activity } = await openContext(browser, {
        device, role: scene.role, origin: server.origin, images,
        contextOptions: { reducedMotion: 'no-preference' },
      });
      page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
      try {
        await open(page, activity, server.origin, scene.role, scene.target, scene.query);
        if (scene.ready) await page.getByTestId(scene.ready).first().waitFor({ state: 'attached', timeout: 60_000 });
        await page.waitForTimeout(2500);
        await waitForImages(page).catch(() => {});
        if (scene.scroll) await scrollBy(page, scene.scroll);
        if (scene.scrollToText) {
          await page.getByText(scene.scrollToText, { exact: true }).first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(900);
        }
        await shot(page, scene.name);
      } catch (error) {
        console.log(`  FAILED: ${error.message.split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
