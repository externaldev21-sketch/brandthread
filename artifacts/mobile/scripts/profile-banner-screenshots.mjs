#!/usr/bin/env node
/**
 * Verification screenshots for the TikTok-style profile banner (buyer +
 * seller): own profile with a GIF banner, own profile with a video
 * banner, another seller's profile with a banner, Edit profile (banner
 * preview + "Edit banner" sheet + GIF crop + video trim) and the no-banner
 * fallback.
 *
 * Uses the signed-out dev web preview; the sample banner only appears under
 * the explicit `&demo=1&banner=gif|video` opt-in (lib/previewProfileBanner.ts).
 *
 *   node scripts/profile-banner-screenshots.mjs                # build + shoot
 *   node scripts/profile-banner-screenshots.mjs --build-dir <dir> --out <dir> \
 *     --gif <sample.gif> --long-video <clip over 10s.mp4>      # also shoot crop + trim
 *
 * Output (default): docs/polish/screenshots/profile-banner/after/390x844/<NN-name>.jpg
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
const OUT = path.resolve(arg('--out') ?? path.join(MOBILE_ROOT, 'docs', 'polish', 'screenshots', 'profile-banner', 'after', '390x844'));
const ONLY = arg('--only');
const VIEWPORT = { width: 390, height: 844 };
const SAMPLE_GIF = arg('--gif');
const LONG_VIDEO = arg('--long-video');

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${name}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 85, animations: 'disabled', caret: 'hide' });
  console.log(`  saved ${path.relative(MOBILE_ROOT, file)}`);
}

async function settle(page, ms = 1500) {
  await page.waitForTimeout(ms);
}

/** Same navigation as scripts/profile-owner-visitor-screenshots.mjs (the preview flags ride on both URLs). */
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

const SCENES = [
  { name: '01-own-buyer-gif-banner', role: 'buyer', target: '/profile', query: '&demo=1&banner=gif', ready: 'buyer-profile' },
  { name: '02-own-seller-video-banner', role: 'seller', target: '/profile', query: '&demo=1&banner=video', ready: 'profile-hero' },
  { name: '03-other-seller-banner', role: 'buyer', target: '/seller-profile?id=user_northline', query: '&demo=1&banner=video', ready: 'seller-profile-hero' },
  { name: '04-own-buyer-no-banner-fallback', role: 'buyer', target: '/profile', query: '&demo=1', ready: 'buyer-profile' },
  { name: '05-own-seller-no-banner-fallback', role: 'seller', target: '/profile', query: '&demo=1', ready: 'profile-hero' },
  { name: '06-edit-profile-buyer', role: 'buyer', target: '/edit-profile', query: '&demo=1&banner=gif', edit: 'gif' },
  { name: '09-edit-profile-seller', role: 'seller', target: '/edit-profile', query: '&demo=1&banner=video', edit: 'video' },
  { name: '12-other-seller-no-banner-fallback', role: 'buyer', target: '/seller-profile?id=user_northline', query: '&demo=1', ready: 'seller-profile-hero' },
];

async function run() {
  if (!process.argv.includes('--skip-build') && !arg('--build-dir')) buildPreviewWeb(BUILD_DIR);
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
        await settle(page, 2500);
        await waitForImages(page).catch(() => {});
        await shot(page, scene.name);
        if (scene.edit) {
          const editBanner = page.getByTestId('edit-banner-button');
          // The "before" build has no banner editor — nothing more to shoot there.
          if (!(await editBanner.count())) continue;
          await editBanner.click();
          await settle(page, 800);
          if (scene.edit === 'gif') await shot(page, '07-edit-banner-action-sheet');
          const file = scene.edit === 'gif' ? SAMPLE_GIF : LONG_VIDEO;
          if (file) {
            const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
            await page.getByTestId(scene.edit === 'gif' ? 'banner-sheet-gif' : 'banner-sheet-video').click();
            await (await chooser).setFiles(file);
            if (scene.edit === 'video') {
              await page.waitForSelector('[data-testid="cover-trim"]', { timeout: 15_000 });
              await settle(page, 1500);
              await shot(page, '10-video-trim-10s-window');
              await page.getByTestId('cover-trim-confirm').click();
            }
            await page.waitForSelector('[data-testid="banner-crop"]', { timeout: 15_000 });
            await settle(page, 1500);
            await shot(page, scene.edit === 'gif' ? '08-gif-crop' : '11-video-crop');
            await page.getByTestId('banner-crop-save').click();
            await settle(page, 1500);
            await shot(page, scene.edit === 'gif' ? '08b-edit-profile-after-gif-save' : '11b-edit-profile-after-video-save');
          }
        }
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
