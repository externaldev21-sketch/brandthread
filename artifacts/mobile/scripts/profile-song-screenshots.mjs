#!/usr/bin/env node
/**
 * Profile song — own profile line, Edit profile → Music row, and the Music
 * picker, at 393x852 on the store-screenshots harness (signed-in demo buyer,
 * fake API). Profile music ships OFF; this script turns it on in the fake API
 * only (feature flag + /api/profile-music/*), with demo artwork, to show the
 * UI that appears once a licensed provider is configured.
 *
 *   node scripts/profile-song-screenshots.mjs --build <web export dir> --tag <before|after> [--off]
 *
 * --off leaves the flag off (what ships today): nothing new renders.
 * Output: docs/pr-assets/profile-song/<tag>-*.jpg
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';
import {
  MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BUILD = path.resolve(arg('build', path.join(WORK_DIR, 'web-build')));
const TAG = arg('tag', 'after');
const ON = !process.argv.includes('--off');
const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/profile-song');
const VIEWPORT = { width: 393, height: 852 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const art = (name) => `${IMAGE_HOST}/demo/${name}.jpg`;
const track = (id, title, artist, image) => ({
  provider: 'apple_music', id, title, artist, artworkUrl: art(image),
  previewUrl: `${IMAGE_HOST}/demo/preview-${id}.m4a`, url: null,
});
const TRACKS = [
  track('1001', 'Slow Burn', 'Northline', 'texture-ember'),
  track('1002', 'Slow Burn (Live)', 'Northline', 'texture-mono'),
  track('1003', 'Burnt Orange', 'Mara Vale', 'look-rust'),
  track('1004', 'Afterglow', 'The Seams', 'story-mono'),
];
const MINE = TRACKS[0];

const json = (origin, body, status = 200) => ({
  status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

async function setup(browser, images, origin) {
  const device = { viewport: VIEWPORT, scale: 2, isMobile: true, userAgent: UA };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  if (ON) {
    await context.route((url) => url.pathname.endsWith('/config/features'), (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();
      return route.fulfill(json(origin, { flags: { profileMusic: true }, updatedAt: null }));
    });
    await context.route((url) => url.pathname.includes('/profile-music/'), (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fallback();
      const p = new URL(req.url()).pathname;
      if (p.endsWith('/config')) return route.fulfill(json(origin, { enabled: true }));
      if (p.endsWith('/search')) return route.fulfill(json(origin, { tracks: TRACKS }));
      if (p.includes('/user/')) return route.fulfill(json(origin, { song: MINE }));
      return route.fulfill(json(origin, { song: MINE }));
    });
  }
  return { context, page, activity };
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log('wrote', `${TAG}-${name}.jpg`);
}

async function open(browser, images, origin, target, waitText) {
  const ctx = await setup(browser, images, origin);
  for (let attempt = 0; ; attempt++) {
    await openScreen(ctx.page, ctx.activity, origin, 'buyer', target);
    try { await ctx.page.getByText(waitText).first().waitFor({ timeout: 15_000 }); break; } catch (e) { if (attempt >= 3) throw e; }
  }
  await waitForQuietNetwork(ctx.activity); await waitForImages(ctx.page); await ctx.page.waitForTimeout(1200);
  return ctx;
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  try {
    {
      const { context, page } = await open(browser, images, server.origin, '/(buyer)/profile', 'Edit profile');
      await shot(page, 'profile');
      await context.close();
    }
    {
      const { context, page } = await open(browser, images, server.origin, '/(buyer)/edit-profile', 'Bio');
      await page.evaluate(() => document.querySelector('[data-testid="edit-profile-music"]')?.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await shot(page, 'edit-profile');
      await context.close();
    }
    if (ON) {
      const { context, page, activity } = await open(browser, images, server.origin, '/profile-music-picker', 'Music');
      await page.getByTestId('music-search').fill('slow burn');
      await page.getByTestId('music-track-1001').waitFor({ timeout: 15_000 });
      await waitForQuietNetwork(activity); await waitForImages(page); await page.waitForTimeout(500);
      await shot(page, 'picker');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
