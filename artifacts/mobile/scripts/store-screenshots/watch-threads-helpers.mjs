/** Shared steps for the Watch Threads verification scripts. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { respond } from './demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR } from './harness.mjs';

const CLIP_URL = 'https://media.brandthread.test/watch-threads-clip.webm';

/**
 * A 30s VP9 + Opus clip (long enough that a position check never sees a loop wrap) (real picture and a real audio track) cut from the
 * repo's own fashion_walk.mp4 — Playwright's Chromium cannot decode H.264, so
 * the app's .mp4 demo clips never play in this harness.
 */
function ensureClip() {
  const out = path.join(WORK_DIR, 'watch-threads-clip.webm');
  if (existsSync(out)) return out;
  const src = path.resolve(MOBILE_ROOT, '../../attached_assets/generated_videos/fashion_walk.mp4');
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-stream_loop', '7', '-i', src, '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '30',
    '-vf', 'scale=360:-2', '-c:v', 'libvpx-vp9', '-b:v', '600k', '-c:a', 'libopus', '-b:a', '64k', '-shortest', out], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg could not build the test clip');
  return out;
}

/**
 * The fake API seeds the Threads feed for its buyer account only; the real
 * GET /api/posts/feed serves any signed-in account (api-server
 * seller-as-buyer.integration.test.ts), so serve the seller the same posts.
 */
export async function serveFeedToSeller(context, { videoFirst = false } = {}) {
  if (videoFirst) {
    const clip = readFileSync(ensureClip());
    await context.route(CLIP_URL, (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: clip, headers: { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' } }));
  }
  await context.route((url) => url.origin === 'https://api.brandthread.test' && /^\/api(\/v1)?\/(posts\/feed|public\/posts)\/?$/.test(url.pathname), (route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': req.headers().origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization,content-type,x-store-context', 'access-control-allow-methods': 'GET,OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const posts = respond({ method: 'GET', path: url.pathname, query: url.searchParams, role: 'buyer' });
    // videoFirst: the first post becomes a playing clip (with sound) so playback can be checked.
    if (videoFirst && Array.isArray(posts) && posts[0]) posts[0] = { ...posts[0], mediaType: 'video', mediaUrls: [CLIP_URL], mediaUrl: CLIP_URL };
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(posts) });
  });
}

/** Seller: Studio button → the menu's first card, exactly as a seller gets there. */
export async function openWatchThreadsFromStudio(page) {
  await page.getByText('Continue setup later').click({ timeout: 3000 }).catch(() => {});
  const studio = page.getByLabel('Open Studio tools').first();
  for (let i = 0; i < 3 && !(await page.getByTestId('seller-control-center-item-watch-threads').count()); i++) {
    await studio.tap({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
  }
  for (let i = 0; i < 3 && !/watch-threads/.test(page.url()); i++) {
    await page.getByTestId('seller-control-center-item-watch-threads').tap({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForURL(/watch-threads/, { timeout: 4000 }).catch(() => {});
  }
  if (!/watch-threads/.test(page.url())) throw new Error('could not open Watch Threads');
}


/** The post actually on screen: its shop-chip label, from whichever chip is topmost (retained tabs keep other copies in the DOM). */
export async function currentPost(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('[aria-label^="Shop "]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (top && (top === el || el.contains(top))) return el.getAttribute('aria-label');
    }
    return null;
  });
}

/** One finger swipe up the feed through CDP touch events (the vertical pager). */
export async function swipeUp(page, cdp) {
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', 200, 620);
  for (let i = 1; i <= 14; i++) { await touch('touchMove', 200, 620 - (440 * i) / 14); await page.waitForTimeout(16); }
  await touch('touchEnd', 200, 180);
  await page.waitForTimeout(2500);
}
