// Discover tap → the real Threads feed at that post (390x844), against the Expo web dev server on :8171 (env as tests/feed-video-plays.web.mjs).
// Run from artifacts/mobile: node <this> <outDir> <clip.webm> $PWD/assets/videos [demo]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(join(process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const [outDir, videoPath, posterDir, demo] = process.argv.slice(2);
const API = 'https://api.brandthread.test';
const uuid = (n) => `7d1c0e2a-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BRANDS = ['Ember & Ash', 'Northfold', 'Saint Linen', 'Vanta Studio', 'Okra Supply', 'Fieldwork'];
const trending = BRANDS.map((brand, i) => ({
  rank: i + 1, id: uuid(i + 1), brand, brandId: `brand_${i + 1}`, caption: `${brand} — runway drop ${i + 1}`, mediaType: 'video', verified: true,
  imageUri: `${API}/media/poster_${(i % 9) + 1}.jpg`, organicScore: 1, finalScore: 1, likesCount: 5000 - i * 100, commentsCount: 300 - i * 10,
  repostsCount: 0, shopClicks: 0, boosted: false, category: 'fashion', hype: 'hot',
}));
const row = (id, brand, caption, poster) => ({
  id, userId: `seller_${brand.replace(/\W/g, '')}`, mediaType: 'video', surface: 'thread', mediaUrl: `${API}/media/clip.webm`, thumbnailUrl: `${API}/media/poster_${poster}.jpg`,
  caption, hashtags: ['feed'], seller: { brandName: brand, username: brand.toLowerCase().replace(/[^a-z]/g, '') },
  likesCount: 120, commentsCount: 8, repostsCount: 1, savesCount: 4, sharesCount: 2, taggedProducts: [], createdAt: new Date().toISOString(),
});
// The real Threads For You content (distinct from the Discover grid).
const FEED = [row(uuid(101), 'Feedhouse One', 'FEED POST ONE', 7), row(uuid(102), 'Feedhouse Two', 'FEED POST TWO', 8), row(uuid(103), 'Feedhouse Three', 'FEED POST THREE', 9)];
const postJson = (id) => { const t = trending.find((r) => r.id === id); if (t) return row(id, t.brand, t.caption, (trending.indexOf(t) % 9) + 1); const f = FEED.find((x) => x.id === id); if (f) return f; const k = Number(id.slice(-3)) - 200; return k >= 0 && k < 12 ? row(id, 'Grid Brand ' + k, 'grid ' + k, (k % 9) + 1) : null; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
const { clerkStubScript } = await import(join(process.cwd(), 'scripts/store-screenshots/clerk-stub.mjs'));
await context.addInitScript({ content: clerkStubScript({ id: 'user_jordan', email: 'jordan@example.com', firstName: 'Jordan', lastName: 'Lee', username: 'jordan', imageUrl: '' }) });
await context.addInitScript(() => { try {
  localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }));
  localStorage.setItem('feed_gesture_guide_seen:user_jordan', '1'); localStorage.setItem('feed_gesture_guide_seen:anon', '1');
} catch {} });
const hits = [];
await context.route(`${API}/**`, async (route) => {
  const req = route.request(); const url = new URL(req.url());
  url.pathname = url.pathname.replace(/^\/api\/v1\//, '/api/');
  if (url.pathname === '/api/healthz') return route.fulfill({ json: { status: 'ok' } });
  if (url.pathname === '/api/public/trending') return route.fulfill({ json: { trending, source: 'cache' } });
  if (demo && url.pathname === '/api/public/discover') return route.fulfill({ json: { items: [], nextCursor: null } }); if (demo && url.pathname === '/api/public/posts') return route.fulfill({ json: [] });
  if (url.pathname === '/api/public/discover') return route.fulfill({ json: { items: trending.map((t, i) => ({ id: t.id, author: { userId: t.brandId, name: t.brand, accountType: 'seller' }, mediaType: 'video', imageUrl: t.imageUri, caption: t.caption, likesCount: t.likesCount, commentsCount: t.commentsCount, createdAt: new Date().toISOString() })).concat(Array.from({ length: 12 }, (_, k) => ({ id: uuid(200 + k), author: { userId: 'brand_x' + k, name: 'Grid Brand ' + k, accountType: 'seller' }, mediaType: 'video', imageUrl: API + '/media/poster_' + ((k % 9) + 1) + '.jpg', caption: 'grid ' + k, likesCount: 10, commentsCount: 1, createdAt: new Date().toISOString() }))), nextCursor: null } });
  if (demo && url.pathname === '/api/public/discover') return route.fulfill({ json: { items: [], nextCursor: null } }); if (demo && url.pathname === '/api/public/posts') return route.fulfill({ json: [] });
  if (url.pathname === '/api/public/discover') return route.fulfill({ json: { items: trending.map((t, i) => ({ id: t.id, author: { userId: t.brandId, name: t.brand, accountType: 'seller' }, mediaType: 'video', imageUrl: t.imageUri, caption: t.caption, likesCount: t.likesCount, commentsCount: t.commentsCount, createdAt: new Date().toISOString() })).concat(Array.from({ length: 12 }, (_, k) => ({ id: uuid(200 + k), author: { userId: 'brand_x' + k, name: 'Grid Brand ' + k, accountType: 'seller' }, mediaType: 'video', imageUrl: API + '/media/poster_' + ((k % 9) + 1) + '.jpg', caption: 'grid ' + k, likesCount: 10, commentsCount: 1, createdAt: new Date().toISOString() }))), nextCursor: null } });
  if (url.pathname === '/api/public/posts') return route.fulfill({ json: url.searchParams.get('offset') === '0' ? FEED : [] });
  const m = url.pathname.match(/^\/api\/posts\/([0-9a-f-]{36})$/);
  if (m && postJson(m[1])) return route.fulfill({ json: postJson(m[1]) });
  const like = url.pathname.match(/^\/api\/posts\/([0-9a-f-]{36})\/(like|save)$/);
  if (like) { hits.push(`${req.method()} ${url.pathname}`); return route.fulfill({ json: { ok: true, liked: true, likesCount: 1 } }); }
  if (url.pathname === '/media/clip.webm') return route.fulfill({ body: readFileSync(videoPath), contentType: 'video/webm' });
  const p = url.pathname.match(/^\/media\/poster_(\d+)\.jpg$/);
  if (p) return route.fulfill({ body: readFileSync(join(posterDir, `fashion_runway_0${p[1]}.jpg`)), contentType: 'image/jpeg' });
  if (req.method() !== 'GET') { hits.push(`${req.method()} ${url.pathname}`); return route.fulfill({ json: { ok: true, liked: true, likesCount: 121 } }); }
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 200)));
const tag = demo ? 'demo' : 'api';
const shot = (n) => page.screenshot({ path: join(outDir, `${tag}-${n}.png`) });
const q = demo ? '?bt_preview=buyer&demo=1' : '?bt_preview=buyer';
await page.goto(`http://127.0.0.1:8171/(buyer)/discover${q}`, { waitUntil: 'load', timeout: 180_000 });
await page.waitForSelector(demo ? '[data-testid^="discover-tile-"]' : `[data-testid="discover-tile-${uuid(1)}"]`, { timeout: 180_000 });
await page.waitForTimeout(2500);
await page.waitForTimeout(2500);
await page.keyboard.press('Escape').catch(() => {});
await page.mouse.move(195, 600); await page.mouse.wheel(0, 160); await page.waitForTimeout(1200);
const scrollOf = () => page.evaluate(() => {
  const n = Array.from(document.querySelectorAll('div')).find((d) => d.scrollHeight > d.clientHeight + 50 && d.querySelector('[data-testid^="discover-tile-"]'));
  return n ? n.scrollTop : null;
});
console.log(tag, 'discover scrollTop before tap:', await scrollOf());
await shot('1-discover');
const sel = demo ? '[data-testid^="discover-tile-"]' : '[data-testid^="discover-tile-7d1c"]';
const hit = await page.evaluate((sel) => {
  const el = Array.from(document.querySelectorAll(sel)).find((t) => { const r = t.getBoundingClientRect(); return r.top > 120 && r.bottom < 740 && r.width > 0; });
  if (!el) return null; const r = el.getBoundingClientRect();
  return { id: el.getAttribute('data-testid'), x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel);
console.log(tag, 'tapping', hit?.id);
await page.mouse.click(hit.x, hit.y);
await page.waitForTimeout(4000);
console.log(tag, 'url:', page.url());
const header = () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < 120 && r.bottom > 0; };
  const texts = Array.from(document.querySelectorAll('div,span')).filter((e) => e.children.length === 0 && vis(e)).map((e) => e.textContent.trim()).filter(Boolean);
  return { topTexts: [...new Set(texts)], creatorBack: !!document.querySelector('[data-testid="creator-feed-back"]'), discoverTitle: texts.includes('Discover') };
});
console.log(tag, 'header:', JSON.stringify(await header()));
const activeCaption = () => page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('div,span')).filter((e) => { const r = e.getBoundingClientRect(); return e.children.length === 0 && r.top > 0 && r.bottom < 844 && r.width > 0 && r.height > 0; });
  return els.map((e) => e.textContent.trim()).filter((t) => /runway drop|FEED POST|preview|demo/i.test(t)).slice(0, 4);
});
console.log(tag, 'on screen:', JSON.stringify(await activeCaption()));
const video = await page.evaluate(() => { const v = Array.from(document.querySelectorAll('video')).find((x) => !x.paused); return v ? { paused: v.paused, t: v.currentTime } : null; });
console.log(tag, 'playing video:', JSON.stringify(video));
await shot('2-opened');
if (await page.$('[data-testid="feed-gesture-guide"]')) { console.log(tag, 'feed gesture guide shown (first run) — dismissing'); await page.click('[aria-label="Tap to keep watching"]'); await page.waitForTimeout(800); await shot('2b-opened'); }
// Like on the opened post.
const like = await page.evaluateHandle(() => Array.from(document.querySelectorAll('[data-testid^="like-btn-"]')).find((el) => { const r = el.getBoundingClientRect(); return r.top > 0 && r.bottom < 844 && r.width > 0; }) ?? null);
const likeId = await like.evaluate((el) => el?.getAttribute('data-testid'));
if (likeId) { await like.asElement().click(); await page.waitForTimeout(800); }
console.log(tag, 'liked', likeId, 'writes:', JSON.stringify(hits));
await shot('3-liked');
for (let i = 1; i <= 3; i++) {
  await page.mouse.move(195, 420); await page.mouse.wheel(0, 844); await page.waitForTimeout(2200);
  console.log(tag, `after swipe ${i}:`, JSON.stringify(await activeCaption()));
  if (i === 1) await shot('4-swiped');
}
// Comments / share / profile on the current feed post.
const visibleClick = async (prefix) => {
  const h = await page.evaluateHandle((prefix) => Array.from(document.querySelectorAll(`[data-testid^="${prefix}"]`)).find((el) => { const r = el.getBoundingClientRect(); return r.top > 0 && r.bottom < 844 && r.width > 0; }) ?? null, prefix);
  const id = await h.evaluate((el) => el?.getAttribute('data-testid'));
  if (id) await h.asElement().click();
  await page.waitForTimeout(2000);
  return id;
};
const cId = await visibleClick('comment-btn-');
console.log(tag, 'comment', cId, '->', page.url(), (await page.evaluate(() => /comment/i.test(document.body.innerText))) ? '(comments UI up)' : '');
await shot('6-comments');
await page.mouse.click(361, 237); await page.waitForTimeout(1200);
const sId = await visibleClick('share-btn-');
console.log(tag, 'share', sId, '->', (await page.evaluate(() => document.body.innerText.match(/Share to|Copy link|Send to/i)?.[0] ?? 'no share sheet text')));
await shot('7-share');
await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
if (await page.evaluate(() => /Share to|Copy link|Send to/i.test(document.body.innerText))) { await page.mouse.click(195, 150); await page.waitForTimeout(1200); }
const aId = await visibleClick('avatar-btn-');
console.log(tag, 'avatar', aId, '->', page.url());
await shot('8-profile');
await page.goBack(); await page.waitForTimeout(1500);
console.log(tag, 'back on feed:', page.url(), JSON.stringify(await activeCaption()));
await page.goBack();
await page.waitForTimeout(2500);
console.log(tag, 'url after back:', page.url(), 'discover scrollTop after back:', await scrollOf());
await shot('5-back');
await browser.close();
