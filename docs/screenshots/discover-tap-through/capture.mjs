/**
 * Before/after captures for the Discover tap-through (390x844).
 *
 * Expects the Expo web dev server already running for artifacts/mobile on
 * PORT (same env as tests/feed-video-plays.web.mjs). The API is mocked at
 * the network layer (with or without the /api/v1 prefix): /api/public/trending returns six real-shaped (UUID)
 * brand video posts, /api/posts/:id returns each one as a real video post,
 * and the media is served locally (VIDEO = a VP9/Opus clip with an audio
 * track, since headless Chromium can't decode H.264 and the bundled runway
 * clips have no audio). Everything else on the API host is aborted, so the
 * rest of Discover falls back to its own preview fixtures (?bt_preview=buyer).
 *
 * Usage: node capture.mjs <before|after> <outDir> <videoPath> <posterDir>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');

const [mode = 'after', outDir = '.', videoPath, posterDir] = process.argv.slice(2);
const PORT = process.env.PORT || '8171';
const API = 'https://api.brandthread.test';
const uuid = (n) => `7d1c0e2a-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BRANDS = ['Ember & Ash', 'Northfold', 'Saint Linen', 'Vanta Studio', 'Okra Supply', 'Fieldwork'];

const trending = BRANDS.map((brand, i) => ({
  rank: i + 1, id: uuid(i + 1), brand, brandId: `brand_${i + 1}`,
  caption: `${brand} — runway drop ${i + 1}`, mediaType: 'video', verified: true,
  imageUri: `${API}/media/poster_${(i % 9) + 1}.jpg`,
  organicScore: 1, finalScore: 1, likesCount: 5000 - i * 100, commentsCount: 300 - i * 10,
  repostsCount: 0, shopClicks: 0, boosted: false, category: 'fashion', hype: 'hot',
}));

function postJson(id) {
  const row = trending.find((r) => r.id === id);
  if (!row) return null;
  return {
    id, userId: row.brandId, mediaType: 'video', surface: 'thread',
    mediaUrl: `${API}/media/clip.webm`, thumbnailUrl: row.imageUri,
    caption: row.caption, hashtags: ['runway'], seller: { brandName: row.brand, username: row.brand.toLowerCase().replace(/[^a-z]/g, '') },
    likesCount: row.likesCount, commentsCount: row.commentsCount, repostsCount: 12, savesCount: 40, sharesCount: 9,
    taggedProducts: [], createdAt: new Date().toISOString(),
  };
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await context.addInitScript(() => {
  const clerkUser = { id: 'user_jordan', primaryEmailAddress: { emailAddress: 'jordan@example.com' } };
  const session = { id: 'sess_demo', user: clerkUser, getToken: async () => 'demo-token' };
  window.Clerk = { loaded: true, user: clerkUser, session, addListener: () => () => {}, load: async () => {}, signOut: async () => {} };
  try {
    localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }));
    localStorage.setItem('feed_gesture_guide_seen:user_jordan', '1');
    localStorage.setItem('feed_gesture_guide_seen:anon', '1');
  } catch {}
});
await context.route(`${API}/**`, async (route) => {
  const url = new URL(route.request().url());
  url.pathname = url.pathname.replace(/^\/api\/v1\//, '/api/');
  if (url.pathname === '/api/healthz') return route.fulfill({ json: { status: 'ok' } });
  if (url.pathname === '/api/public/trending') return route.fulfill({ json: { trending, source: 'cache' } });
  const m = url.pathname.match(/^\/api\/posts\/([0-9a-f-]{36})$/);
  if (m && postJson(m[1])) return route.fulfill({ json: postJson(m[1]) });
  if (url.pathname === '/media/clip.webm') return route.fulfill({ body: readFileSync(videoPath), contentType: 'video/webm' });
  const p = url.pathname.match(/^\/media\/poster_(\d+)\.jpg$/);
  if (p) return route.fulfill({ body: readFileSync(join(posterDir, `fashion_runway_0${p[1]}.jpg`)), contentType: 'image/jpeg' });
  return route.abort();
});

const page = await context.newPage();
const shot = (name) => page.screenshot({ path: join(outDir, `${mode}-${name}.png`) });
const log = (...a) => console.log(`[${mode}]`, ...a);

await page.goto(`http://127.0.0.1:${PORT}/(buyer)/discover?bt_preview=buyer`, { waitUntil: 'load', timeout: 120_000 });
const firstTile = `[data-testid="discover-tile-trend_${uuid(1)}"]`;
await page.waitForSelector(firstTile, { timeout: 120_000 });
await page.waitForTimeout(2500);
// Dismiss a first-run tip if one is up.
await page.keyboard.press('Escape').catch(() => {});

// Scroll the grid so "back restores the same position" is visible.
await page.mouse.move(195, 600);
await page.mouse.wheel(0, Number(process.env.SCROLL || 160));
await page.waitForTimeout(1200);
// The Discover grid's own scroller (the one holding the tiles).
const scrollOf = () => page.evaluate(() => {
  const node = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-testid^="discover-tile-"]'));
  return node ? node.scrollTop : null;
});
const before = await scrollOf();
log('discover scrollTop before tap:', before);
await shot('1-discover');

// Tap a tile that's on screen at its own coordinates — element.click() would
// first scroll it into view and spoil the scroll-restore check.
const hit = await page.evaluate(() => {
  const tiles = Array.from(document.querySelectorAll('[data-testid^="discover-tile-trend_"]'));
  const el = tiles.find((t) => { const r = t.getBoundingClientRect(); return r.top > 120 && r.bottom < 740 && r.width > 0; });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-testid'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
log('tapping', hit?.id, JSON.stringify(await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="discover-tile-trend_"]')).map((t) => Math.round(t.getBoundingClientRect().top)))));
await page.mouse.click(hit?.x ?? 195, hit?.y ?? 520);
await page.waitForTimeout(3500);

const video = await page.evaluate(() => {
  const vids = Array.from(document.querySelectorAll('video'));
  const v = vids.find((x) => !x.paused) ?? vids[0];
  return v ? { count: vids.length, paused: v.paused, muted: v.muted, volume: v.volume, currentTime: v.currentTime, src: v.currentSrc, error: v.error?.code ?? null } : null;
});
log('video:', JSON.stringify(video));
const rail = await page.evaluate(() => ['like-btn-', 'save-btn-', 'repost-btn-'].map((p) => [p, !!document.querySelector(`[data-testid^="${p}"]`)]));
log('rail:', JSON.stringify(rail));
await shot('2-tap-opens');

if (mode === 'after') {
  // Like works in place.
  const like = await page.$('[data-testid^="like-btn-"]');
  if (like) { await like.click(); await page.waitForTimeout(600); }
  await shot('3-liked');
  // Swipe on to the next related post.
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 844);
  await page.waitForTimeout(2500);
  await shot('4-swiped-next');
  await page.click('[data-testid="creator-feed-back"]');
} else {
  await page.click('[data-testid="discover-viewer-close"]').catch(() => page.goBack());
}
await page.waitForTimeout(2000);
const after = await scrollOf();
log('discover scrollTop after back:', after);
await shot('5-back-to-discover');
await browser.close();
