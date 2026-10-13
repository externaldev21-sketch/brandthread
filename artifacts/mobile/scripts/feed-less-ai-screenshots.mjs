#!/usr/bin/env node
/**
 * Buyer Threads feed ("less AI" visual pass, V1–12) — captures the For You
 * feed on the store-screenshots harness with a small, script-only fixture:
 * three video posts (one tagging a sold-out product, one by a creator who is
 * live in the `&demo=1` preview cast) plus recommended brands for the end of
 * the feed. Measures the rail/caption/chip/progress-bar geometry.
 *
 *   node scripts/feed-less-ai-screenshots.mjs <buildDir> <outDir> <prefix> [width] [height]
 *
 * Needs ffmpeg once: the bundled runway clips are H.264, which Playwright's
 * Chromium cannot decode, so they are transcoded to VP9 under .store-screenshots.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { IMAGE_HOST } from './store-screenshots/demo-data.mjs';
import { MOBILE_ROOT, WORK_DIR, launchBrowser, openContext, openScreen, serveBuild, waitForImages } from './store-screenshots/harness.mjs';

const BUILD = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] ?? path.join(MOBILE_ROOT, 'docs/pr-review/less-ai-feed'));
const PREFIX = process.argv[4] ?? 'after';
const VIEWPORT = { width: Number(process.argv[5] ?? 390), height: Number(process.argv[6] ?? 844) };
mkdirSync(OUT, { recursive: true });

const MEDIA = path.join(WORK_DIR, 'feed-media');
function ensureMedia() {
  mkdirSync(MEDIA, { recursive: true });
  for (const i of ['01', '02', '03']) {
    const src = path.join(MOBILE_ROOT, `assets/videos/fashion_runway_${i}.mp4`);
    const webm = path.join(MEDIA, `runway_${i}.webm`);
    const jpg = path.join(MEDIA, `runway_${i}.jpg`);
    if (!existsSync(webm)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-t', '8', '-vf', 'scale=540:-2', '-c:v', 'libvpx-vp9', '-b:v', '600k', '-an', webm]);
    if (!existsSync(jpg)) execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '1', '-i', src, '-frames:v', '1', '-vf', 'scale=540:-2', jpg]);
  }
}

const media = (name) => `${IMAGE_HOST}/feedqa/${name}`;
const imgUrl = (name) => `${IMAGE_HOST}/${name}.jpg`;
const POSTS = [
  {
    id: 'feedqa_1', userId: 'user_feedqa_atelier', brand: 'Atelier Noire', clip: '01',
    caption: 'Runway cut from the FW26 show. The rust shell jacket closes the set — sizes S to XL, ships this week.',
    tag: { productId: 'prod_nl_jacket_rust', name: 'Field Shell Jacket — Rust', images: [imgUrl('jacket-rust')], priceCents: 22000 },
    likes: 18400, comments: 612, reposts: 1290,
  },
  {
    id: 'feedqa_2', userId: 'user_feedqa_quiet', brand: 'Quiet Hours', clip: '02',
    caption: 'Last call on the moss hoodie.',
    tag: { productId: 'prod_feedqa_soldout', name: 'Loopback Hoodie — Moss', images: [imgUrl('hoodie-moss')], priceCents: 9800 },
    likes: 7020, comments: 188, reposts: 350,
  },
  {
    id: 'feedqa_3', userId: 'preview-seller-01', brand: 'Maison Vela', clip: '03',
    caption: 'Fittings tonight — come say hi.',
    tag: null,
    likes: 4210, comments: 96, reposts: 120,
  },
];

function feedRows() {
  return POSTS.map((p, i) => ({
    id: p.id,
    userId: p.userId,
    seller: { brandName: p.brand, displayName: p.brand },
    caption: p.caption,
    mediaType: 'video',
    mediaUrls: [media(`runway_${p.clip}.mp4`)],
    mediaUrl: media(`runway_${p.clip}.mp4`),
    thumbnailUrl: media(`runway_${p.clip}.jpg`),
    taggedProducts: p.tag ? [p.tag] : [],
    likesCount: p.likes,
    commentsCount: p.comments,
    repostsCount: p.reposts,
    createdAt: new Date(Date.parse('2026-09-18T20:00:00Z') - i * 3600e3).toISOString(),
  }));
}

const BRANDS = [
  { id: 'rb1', sellerId: 'user_ember', name: 'Ember & Ash', brandType: null, logoUrl: imgUrl('texture-ember'), verified: true, followerCount: 3100, reason: 'Popular right now' },
  { id: 'rb2', sellerId: 'user_field', name: 'Field Office', brandType: null, logoUrl: imgUrl('look-mono'), verified: false, followerCount: 640, reason: 'Matches your style' },
  { id: 'rb3', sellerId: 'user_quiet', name: 'Quiet Hours', brandType: null, logoUrl: imgUrl('texture-mono'), verified: false, followerCount: 1200, reason: 'Matches your style' },
];

async function scrollToPage(page, index) {
  await page.evaluate((i) => {
    const el = [...document.querySelectorAll('div')]
      .filter((d) => d.scrollHeight > d.clientHeight * 1.5 && d.clientHeight > innerHeight * 0.8 && /(auto|scroll)/.test(getComputedStyle(d).overflowY))
      .sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    if (el) el.scrollTop = i * el.clientHeight;
    window.__feedScroller = el ? { sh: el.scrollHeight, ch: el.clientHeight, top: el.scrollTop } : null;
  }, index);
  await page.waitForTimeout(1600);
  console.log('scroller', JSON.stringify(await page.evaluate(() => window.__feedScroller)));
}

async function measure(page) {
  return page.evaluate(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) }; };
    const visible = (el) => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.width > 0; };
    const q = (sel) => [...document.querySelectorAll(sel)].find(visible);
    const like = q('[data-testid^="like-btn-"]');
    const follow = q('[data-testid^="follow-btn-"]');
    const chip = q('[data-testid="shop-tag-pill"]');
    const sound = [...document.querySelectorAll('[aria-label="Mute sound"],[aria-label="Unmute sound"]')].find(visible);
    const share = [...document.querySelectorAll('[aria-label="Share post"]')].find(visible);
    const progress = [...document.querySelectorAll('[aria-label="Video progress"]')].find(visible);
    const tabs = document.querySelector('[data-testid="buyer-home-tabs"]');
    const tabText = tabs ? [...tabs.querySelectorAll('div[dir="auto"]')].map((t) => ({ text: t.textContent, size: getComputedStyle(t).fontSize, weight: getComputedStyle(t).fontWeight, color: getComputedStyle(t).color })) : [];
    const icons = ['buyer-home-live', 'feed-cart-button', 'buyer-home-search-icon'].map((id) => r(document.querySelector(`[data-testid="${id}"]`)));
    return {
      shareCountText: r(share?.querySelector('div[dir="auto"]')),
      soundText: r(sound?.querySelector('div[dir="auto"]')),
      likeBtn: r(like), likeText: like ? [...like.querySelectorAll('div[dir="auto"]')].map((t) => `${t.textContent}@${getComputedStyle(t).opacity}/${getComputedStyle(t).transform}`) : null, followBadge: r(follow), shareBtn: r(share), soundRow: r(sound), chip: r(chip), chipText: chip?.innerText,
      progressHitArea: r(progress), tabs: tabText, headerIcons: icons,
      liveRing: !!q('[data-testid^="live-ring-"]'),
      endRow: r(document.querySelector('[data-testid="feed-end-recommendations"]')),
    };
  });
}

async function run() {
  ensureMedia();
  const server = await serveBuild(BUILD);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'images'));
  const results = {};
  try {
    for (const demo of [false, true]) {
      const device = { viewport: VIEWPORT, scale: 2, isMobile: true };
      const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin: server.origin, images });
      await context.route(`${IMAGE_HOST}/feedqa/**`, (route) => {
        const name = new URL(route.request().url()).pathname.split('/').pop();
        const file = path.join(MEDIA, name.replace(/\.mp4$/, '.webm'));
        return route.fulfill({ status: 200, contentType: name.endsWith('.mp4') ? 'video/webm' : 'image/jpeg', body: readFileSync(file) });
      });
      await context.route('https://api.brandthread.test/**', (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') return route.fallback();
        const url = new URL(req.url());
        const p = url.pathname.replace(/^\/api\/v1\//, '/api/');
        const cors = { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' };
        const json = (body) => route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
        if (p === '/api/public/posts') return json(url.searchParams.get('offset') === '0' ? feedRows() : []);
        if (p === '/api/posts/feed') return json([]);
        const stock = p.match(/^\/api\/catalog-public\/products\/([^/]+)\/stock-info$/);
        if (stock) return json({ soldOut: decodeURIComponent(stock[1]) === 'prod_feedqa_soldout', limited: false, editionSize: null, remaining: null });
        if (p === '/api/buyer/recommended-brands') return json({ brands: BRANDS, followedBrandCount: 1 });
        return route.fallback();
      });
      page.setDefaultNavigationTimeout(240_000);
      await openScreen(page, activity, server.origin, 'buyer', '/', { extraQuery: demo ? '&demo=1' : '' });
      await page.getByText(POSTS[0].brand).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(4500);
      // Pre-existing race (seen on the untouched baseline build too): the
      // first copy of each post sometimes keeps a zeroed like count. Reload
      // (up to 3x) so before/after pairs compare like with like.
      for (let attempt = 0; attempt < 3; attempt++) {
        const label = await page.locator('[data-testid^="like-btn-"]').first().getAttribute('aria-label').catch(() => null);
        if (!label || !/, 0 likes$/.test(label)) break;
        await openScreen(page, activity, server.origin, 'buyer', '/', { extraQuery: demo ? '&demo=1' : '' });
        await page.getByText(POSTS[0].brand).first().waitFor({ timeout: 60_000 });
        await page.waitForTimeout(4500);
      }
      await waitForImages(page);
      const shot = async (name) => { await page.screenshot({ path: path.join(OUT, `${PREFIX}-${name}.png`) }); console.log(`  ✓ ${PREFIX}-${name}`); };
      const tag = `${VIEWPORT.width}x${VIEWPORT.height}`;
      if (!demo) {
        await shot(`01-feed-${tag}`);
        results.first = await measure(page);
        // Single tap = pause (after the 290ms double-tap window).
        await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height * 0.4);
        await page.mouse.down();
        await page.waitForTimeout(90);
        await page.mouse.up();
        await page.waitForTimeout(420);
        await shot(`02-paused-${tag}`);
        await page.waitForTimeout(1200);
        await shot(`03-paused-after-fade-${tag}`);
        results.pausedLater = await page.evaluate(() => document.querySelector('[data-testid="feed-pause-glyph"]') ? getComputedStyle(document.querySelector('[data-testid="feed-pause-glyph"]')).opacity : null);
        await scrollToPage(page, 1);
        await shot(`04-sold-out-chip-${tag}`);
        results.soldOut = await measure(page);
        await scrollToPage(page, 3);
        await shot(`05-end-of-feed-${tag}`);
        results.end = await measure(page);
      } else {
        await scrollToPage(page, 2);
        await shot(`06-live-ring-demo-${tag}`);
        results.live = await measure(page);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results, null, 2));
}

run().catch((error) => { console.error(error); process.exit(1); });
