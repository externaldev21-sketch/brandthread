#!/usr/bin/env node
/**
 * Verification screenshots for the banner trim + position flow and the
 * bottom fade: profiles (own + visited, buyer + seller), Edit profile and the
 * storefront preview with the banner fading into the page; then a 72s 9:16
 * clip through the trim screen (window slid along the filmstrip) and the crop
 * screen (dragged to reposition), and the saved result.
 *
 *   node scripts/banner-trim-fade-screenshots.mjs --build-dir <dir> --out <dir> --long-video <72s clip.webm>
 *
 * Uses the signed-out dev web preview with `&demo=1&banner=video` (no API calls).
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
const OUT = path.resolve(arg('--out') ?? path.join(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'banner-trim-fade', 'after'));
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

const LONG_VIDEO = arg('--long-video');

const SCENES = [
  { name: '01-own-buyer-profile', role: 'buyer', target: '/profile', query: '&demo=1&banner=video', ready: 'buyer-profile' },
  { name: '02-own-seller-profile', role: 'seller', target: '/profile', query: '&demo=1&banner=video', ready: 'profile-hero' },
  { name: '03-visited-seller-storefront', role: 'buyer', target: '/seller-profile?id=user_northline', query: '&demo=1&banner=video', ready: 'seller-profile-hero' },
  { name: '04-buyer-edit-profile', role: 'buyer', target: '/edit-profile', query: '&demo=1&banner=video' },
  { name: '05-seller-edit-profile-storefront-preview', role: 'seller', target: '/edit-profile', query: '&demo=1&banner=video', scrollToText: 'Storefront preview' },
  { name: '06-seller-edit-profile', role: 'seller', target: '/edit-profile', query: '&demo=1&banner=video', edit: true },
];

/** Press, drag and release with intermediate moves (gesture-handler needs them). */
async function drag(page, from, to, steps = 18) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

async function center(locator) {
  const box = await locator.boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function editFlow(page) {
  if (!LONG_VIDEO) return;
  await page.getByTestId('edit-banner-button').first().click();
  await page.waitForTimeout(800);
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.getByTestId('banner-sheet-video').click();
  await (await chooser).setFiles(LONG_VIDEO);
  const newTrim = page.getByTestId('banner-trim-strip');
  const oldTrim = page.getByTestId('cover-trim');
  await Promise.race([
    newTrim.waitFor({ state: 'visible', timeout: 20_000 }),
    oldTrim.waitFor({ state: 'attached', timeout: 20_000 }),
  ]);
  await page.waitForTimeout(3500);
  await shot(page, '07-long-video-trim');
  if (await newTrim.count()) {
    // Slide the 10s window along the filmstrip (about the middle of the clip).
    const win = await center(page.getByTestId('banner-trim-window'));
    await drag(page, { x: win.x, y: win.y }, { x: win.x + 150, y: win.y });
    await page.waitForTimeout(2500);
    await shot(page, '08-long-video-trim-window-moved');
    await page.getByTestId('banner-trim-next').click();
  } else {
    await page.getByTestId('cover-trim-confirm').click();
  }
  await page.getByTestId('banner-crop-frame').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(2500);
  await shot(page, '09-crop');
  // Reposition: drag the clip up under the banner frame.
  const frame = await center(page.getByTestId('banner-crop-frame'));
  await drag(page, { x: frame.x, y: frame.y }, { x: frame.x, y: frame.y - 120 });
  await page.waitForTimeout(1500);
  await shot(page, '10-crop-repositioned');
  await page.getByTestId('banner-crop-save').click();
  await page.waitForTimeout(3000);
  await shot(page, '11-edit-profile-after-save');
}

async function run() {
  if (!arg('--build-dir')) buildPreviewWeb(BUILD_DIR);
  const server = await serveBuild(BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    for (const scene of SCENES) {
      if (ONLY && !scene.name.includes(ONLY)) continue;
      console.log(`\n== ${scene.name} ==`);
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true, hasTouch: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15' };
      const { context, page, activity } = await openContext(browser, {
        device, role: scene.role, origin: server.origin, images,
        contextOptions: { reducedMotion: 'no-preference' },
      });
      page.on('pageerror', (err) => console.log(`  (page error: ${err.message.split('\n')[0]})`));
      try {
        await open(page, activity, server.origin, scene.role, scene.target, scene.query);
        if (scene.ready) await page.getByTestId(scene.ready).first().waitFor({ state: 'attached', timeout: 60_000 });
        await page.waitForTimeout(3000);
        await waitForImages(page).catch(() => {});
        if (scene.scrollToText) {
          await page.getByText(scene.scrollToText, { exact: true }).first().scrollIntoViewIfNeeded();
          await page.waitForTimeout(900);
        }
        await shot(page, scene.name);
        if (scene.edit) await editFlow(page);
      } catch (error) {
        console.log(`  FAILED: ${error.message.split('\n')[0]}`);
        await shot(page, `${scene.name}-error`).catch(() => {});
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
