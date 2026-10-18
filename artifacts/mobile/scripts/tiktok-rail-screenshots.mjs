#!/usr/bin/env node
/**
 * Proof captures for the TikTok rail pass (buyer Threads Home at 390x844).
 * Needs an Expo web dev server already running (so __DEV__ preview posts are
 * included), e.g.:
 *   EXPO_PUBLIC_API_BASE_URL=https://api.brandthread.test pnpm exec expo start --web --port 8171
 *   node scripts/tiktok-rail-screenshots.mjs <outDir> [step...]
 * Steps: home, swipe, share, paused, gap. Defaults to all of them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { launchBrowser, openContext, openScreen, WORK_DIR } from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { respond } from './store-screenshots/demo-data.mjs';

const PORT = process.env.PORT || '8171';
const ORIGIN = `http://127.0.0.1:${PORT}`;
const outDir = path.resolve(process.argv[2] || 'docs/screenshots/tiktok-rail');
const steps = process.argv.slice(3);
const want = (s) => steps.length === 0 || steps.includes(s);

async function openFeed(browser, { role = 'buyer', images } = {}) {
  const { context, page, activity } = await openContext(browser, {
    device: { viewport: { width: 390, height: 844 }, scale: 2, isMobile: true },
    role, origin: ORIGIN, images,
  });
  await context.addInitScript(() => {
    try {
      for (const id of ['user_jordan', 'anon', 'user_demo_buyer', 'user_demo_seller']) {
        localStorage.setItem(`feed_gesture_guide_seen:${id}`, '1');
        localStorage.setItem(`feed_gesture_guide_seen_version:${id}`, '1');
      }
    } catch {}
  });
  // Test fixtures for this capture only (the demo API's feed has only
  // single-photo posts): a 3-photo slideshow with a long caption and a photo
  // post, so the swipe proof crosses video -> slideshow -> photo -> video.
  await context.route('https://api.brandthread.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (!/\/(public\/posts|posts\/feed)$/.test(url.pathname) || route.request().method() !== 'GET') return route.fallback();
    const rows = respond({ method: 'GET', path: url.pathname, query: url.searchParams, role, options: {} });
    if (!Array.isArray(rows) || rows.length === 0 || Number(url.searchParams.get('offset') ?? 0) > 0) return route.fallback();
    const [a, b, c] = rows;
    const slideshow = {
      ...a, id: 'post_demo_slideshow', mediaType: 'slideshow',
      mediaUrls: [a.mediaUrl, b?.mediaUrl ?? a.mediaUrl, c?.mediaUrl ?? a.mediaUrl],
      caption: 'Three looks from the new drop, layered for the cold snap. Swipe through for the coat, the knit and the boots, then tap Shop to see every size in stock.',
    };
    const photo = { ...b, id: 'post_demo_photo', mediaType: 'photo', caption: 'Short caption.' };
    // A buyer's post: no tagged product, so no Shop button.
    const buyerPost = {
      ...c, id: 'post_demo_buyer', mediaType: 'photo', taggedProducts: [],
      seller: { displayName: 'Maya Chen', brandName: null, avatarUrl: null }, authorAccountType: 'buyer',
      caption: 'Wore the wool coat to the gallery opening and got stopped three times. Sizing runs true, I took my usual M.',
    };
    return route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([slideshow, photo, buyerPost, ...rows.slice(3)]),
      headers: { 'access-control-allow-origin': ORIGIN, 'access-control-allow-credentials': 'true' },
    });
  });
  await openScreen(page, activity, ORIGIN, role, '/(buyer)', { extraQuery: '&demo=1' });
  await page.waitForSelector('[data-testid^="like-btn-"]', { timeout: 90_000 });
  await page.waitForTimeout(2500);
  return { context, page };
}

async function shot(page, name, clip) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', ...(clip ? { clip } : {}) });
  console.log('saved', path.relative(process.cwd(), file));
}

async function railBox(page) {
  return page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; };
    const pick = (sel) => [...document.querySelectorAll(sel)].find(visible);
    const out = {};
    for (const [k, sel] of Object.entries({
      avatar: '[data-testid^="avatar-btn-"]', like: '[data-testid^="like-btn-"]', comment: '[data-testid^="comment-btn-"]',
      save: '[data-testid^="save-btn-"]', share: '[data-testid^="share-btn-"]', disc: '[data-testid^="sound-disc-"]',
      repost: '[data-testid^="repost-btn-"]', caption: '[data-testid="caption-block"]', tabbar: '[data-testid="buyer-bottom-tab-bar"]',
      progress: '[aria-label="Video progress"] > div', captionText: '[data-testid="caption-text"]',
    })) {
      const el = pick(sel);
      if (el) { const r = el.getBoundingClientRect(); out[k] = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
    }
    return out;
  });
}

/** A fast real touch swipe (CDP touch events, ~110ms), calling `onFrame`
 *  between moves so frames are captured mid-swipe. */
async function fastSwipe(page, cdp, onFrame) {
  const x = 180;
  const send = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await send('touchStart', 640);
  for (let i = 1; i <= 6; i++) {
    await send('touchMove', 640 - i * 45);
    await onFrame(`move${i}`);
  }
  await send('touchEnd');
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(60);
    await onFrame(`settle${i}`);
  }
}

async function activePostId(page) {
  // The like button that's on screen (on the old per-page rail every page
  // had one; now there's a single overlay rail).
  return page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid^="like-btn-"]')].find((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
    });
    return el?.getAttribute('data-testid')?.slice('like-btn-'.length) ?? null;
  });
}

async function tapVideo(page) {
  await page.mouse.move(160, 420);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
}

async function openShare(page) {
  // New rail: share-btn-<id>; old per-page rail: the on-screen "Share post" button.
  const handle = await page.evaluateHandle(() => [...document.querySelectorAll('[data-testid^="share-btn-"], [aria-label="Share post"]')]
    .find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight; }));
  await handle.asElement().click();
}

async function scrollToPost(page, match, maxPages = 30) {
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('div')];
    window.__pager = all.find((d) => d.scrollHeight > d.clientHeight * 3 && d.clientHeight >= innerHeight - 2 && getComputedStyle(d).overflowY !== 'visible');
  });
  for (let i = 0; i < maxPages; i++) {
    const id = await activePostId(page);
    if (id && match(id, page)) return id;
    await page.evaluate(() => window.__pager.scrollBy({ top: innerHeight, behavior: 'instant' }));
    await page.waitForTimeout(700);
  }
  throw new Error('post not found');
}

async function main() {
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const { page } = await openFeed(browser, { images });
  const report = {};

  if (want('home')) {
    report.home = await railBox(page);
    await shot(page, 'rail-390x844');
  }

  if (want('caption')) {
    await shot(page, 'caption-seller-shop');
    await scrollToPost(page, (id) => id === 'post_demo_buyer');
    await page.waitForTimeout(800);
    await shot(page, 'caption-buyer');
    await scrollToPost(page, (id) => id.includes('post_demo_slideshow'));
    await page.waitForTimeout(800);
    await shot(page, 'caption-slideshow');
    await page.evaluate(() => window.__pager.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(900);
  }

  if (want('gap')) {
    // Progress line vs the floating tab bar's top, zoomed (2x device pixels).
    await shot(page, 'gap-above-tab-bar', { x: 0, y: 730, width: 390, height: 60 });
  }

  if (want('rail')) {
    // A post whose creator isn't live, so the + follow badge shows.
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('div')];
      window.__pager = all.find((d) => d.scrollHeight > d.clientHeight * 3 && d.clientHeight >= innerHeight - 2 && getComputedStyle(d).overflowY !== 'visible');
    });
    for (let i = 0; i < 12; i++) {
      if (await page.$('[data-testid^="follow-btn-preview"]')) break;
      await page.evaluate(() => window.__pager.scrollBy({ top: innerHeight, behavior: 'instant' }));
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(800);
    report.rail = await railBox(page);
    await shot(page, 'rail-390x844');
  }

  if (want('paused')) {
    await tapVideo(page);
    await page.waitForTimeout(900);
    await shot(page, 'paused-icon');
    await page.waitForTimeout(3000);
    await shot(page, 'paused-icon-after-3s');
    await tapVideo(page);
    await page.waitForTimeout(900);
  }

  if (want('share')) {
    await openShare(page);
    await page.waitForTimeout(900);
    await shot(page, 'share-sheet-repost-first');
    const repost = await page.$('[data-testid="thread-share-repost"]');
    if (repost) {
      await repost.click();
      await page.waitForTimeout(1200);
      await shot(page, 'repost-education');
      const ok = await page.$('[aria-label="Got it"]');
      if (ok) { await ok.click(); await page.waitForTimeout(1200); }
      await openShare(page);
      await page.waitForTimeout(900);
      await shot(page, 'share-sheet-remove-repost');
      await page.click('[data-testid="thread-share-close"]').catch(() => {});
      await page.waitForTimeout(900);
      await shot(page, 'caption-you-reposted');
    }
  }

  if (want('swipe')) {
    // Fast swipes through the feed: the preview videos, then the slideshow
    // and photo fixtures, then back to video (the feed loops). Every frame
    // records the rail's on-screen boxes; they must never change.
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    const crops = path.join(outDir, 'swipe-frames');
    mkdirSync(crops, { recursive: true });
    const capture = async (n, tag, from, keepShot) => {
      const box = await railBox(page);
      const post = await activePostId(page);
      frames.push({ swipe: n, tag, from, post, box });
      if (keepShot) {
        await page.screenshot({ path: path.join(crops, `${String(frames.length).padStart(3, '0')}-${post}-${tag}.png`), animations: 'disabled' });
      }
    };
    // 1) A few real fast touch flings on the videos.
    for (let n = 0; n < 4; n++) {
      const from = await activePostId(page);
      await fastSwipe(page, cdp, (tag) => capture(n, tag, from, false));
      await page.waitForTimeout(250);
      console.log(`fling ${n + 1}: ${from} -> ${await activePostId(page)}`);
    }
    // 2) Then page-by-page smooth scrolls of the pager itself (the same
    //    animated scroll a swipe ends in) through the rest of the videos,
    //    the slideshow, the photos and back to video, capturing mid-scroll.
    await page.evaluate(() => {
      const all = [...document.querySelectorAll('div')];
      const el = all.find((d) => d.scrollHeight > d.clientHeight * 3 && d.clientHeight >= innerHeight - 2 && getComputedStyle(d).overflowY !== 'visible');
      window.__pager = el;
      el.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.waitForTimeout(600);
    let seenSlideshow = false;
    let after = 0;
    for (let n = 0; n < 30 && after < 3; n++) {
      const from = await activePostId(page);
      const keep = seenSlideshow || after > 0 || from?.startsWith('preview-fashion-1') || from?.includes('post_demo');
      await page.evaluate(() => window.__pager.scrollBy({ top: innerHeight, behavior: 'smooth' }));
      for (let f = 0; f < 8; f++) {
        await capture(100 + n, `scroll${f}`, from, keep && f % 2 === 1);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(500);
      await capture(100 + n, 'settled', from, keep);
      const now = await activePostId(page);
      if (now?.includes('post_demo_slideshow')) seenSlideshow = true;
      if (seenSlideshow && !now?.includes('post_demo')) after++;
      console.log(`page ${n + 1}: ${from} -> ${now}`);
    }

    const keys = ['avatar', 'like', 'comment', 'save', 'share', 'disc'];
    const ref = frames.find(f => keys.every(k => f.box[k]))?.box;
    let maxShift = 0;
    let framesWithRail = 0;
    for (const f of frames) {
      if (!keys.every(k => f.box[k])) continue;
      framesWithRail++;
      for (const k of keys) {
        maxShift = Math.max(maxShift, Math.abs(f.box[k].x - ref[k].x), Math.abs(f.box[k].y - ref[k].y), Math.abs(f.box[k].w - ref[k].w), Math.abs(f.box[k].h - ref[k].h));
      }
    }
    report.swipe = { frames: frames.length, framesWithRail, maxShiftPt: maxShift, reference: ref, posts: [...new Set(frames.map(f => f.post))] };
    report.swipeFrames = frames;
    console.log('rail max shift across', framesWithRail, 'frames:', maxShift, 'pt');
  }

  writeFileSync(path.join(outDir, 'measurements.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
