#!/usr/bin/env node
/**
 * Verifies how POST carousels render after posting: the profile Posts grid
 * (3:4 tiles, carousel badge) and the full-screen viewer (3:4, dots, swipe).
 * API responses are stubbed in the browser with a photo/photo/video carousel.
 *
 *   node scripts/store-screenshots/post-carousel-profile-verify.mjs <mediaDir> <outDir> [--role seller|buyer] [--skip-build]
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { findTextFitViolations } from './text-fit.mjs';
import { DEFAULT_BUILD_DIR, buildPreviewWeb, openContext, openScreen, serveBuild } from './harness.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const roleArg = process.argv.includes('--role') ? process.argv[process.argv.indexOf('--role') + 1] : 'seller';
const [mediaDir, outDir] = args.filter((a) => a !== roleArg);
mkdirSync(outDir, { recursive: true });
const device = { id: 'iphone-393', viewport: { width: 393, height: 852 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' };
if (!process.argv.includes('--skip-build')) buildPreviewWeb();
const server = await serveBuild(DEFAULT_BUILD_DIR);
const browser = await chromium.launch();
const API = 'https://api.brandthread.test';
const M = 'https://media.test';

const slides = [
  { kind: 'photo', url: `${M}/port1.jpg`, thumbnailUrl: `${M}/port1.jpg` },
  { kind: 'photo', url: `${M}/land1.jpg`, thumbnailUrl: `${M}/land1.jpg` },
  { kind: 'video', url: `${M}/clip1.webm`, thumbnailUrl: `${M}/port2.jpg`, duration: 6 },
];
const now = new Date().toISOString();
const base = (id, extra) => ({
  id, userId: 'demo', mediaUrl: `${M}/port1.jpg`, mediaUrls: slides.map((s) => s.url), thumbnailUrl: `${M}/port1.jpg`, mediaType: 'slideshow',
  aspectRatio: '3:4', surface: 'profile', slides, caption: 'Weekend views! Who likes hiking?', hashtags: [], styleTags: [],
  postStatus: 'published', visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
  createdAt: now, updatedAt: now, seller: { displayName: 'Demo', brandName: 'Demo Brand' }, taggedProducts: [], likesCount: 12, commentsCount: 3, repostsCount: 1, ...extra,
});
const posts = [
  base('11111111-1111-4111-8111-111111111111', {}),
  base('22222222-2222-4222-8222-222222222222', { slides: [slides[1]], mediaUrls: [slides[1].url], mediaUrl: slides[1].url, thumbnailUrl: slides[1].url }),
  base('33333333-3333-4333-8333-333333333333', { mediaType: 'video', slides: [slides[2]], mediaUrls: [slides[2].url], mediaUrl: slides[2].url, thumbnailUrl: slides[2].thumbnailUrl }),
];
const buyerPosts = posts.map((p) => ({ ...p, authorId: 'demo', authorName: 'Demo', authorHandle: '@demo', authorInitials: 'DE', authorColor: '#333', authorAccountType: 'buyer', feedEligibility: 'profile_only', profileVisibility: 'friends_only', type: p.mediaType, mediaColors: [], savedByMe: false, likedByMe: false, repostedByMe: false, isArchived: false, isDraft: false }));

let n = 0;
const shot = async (page, name) => { n += 1; const f = path.join(outDir, `${String(n).padStart(2, '0')}-${name}.png`); await page.waitForTimeout(900); await page.screenshot({ path: f, animations: 'disabled' }); console.log('shot', f); for (const v of await findTextFitViolations(page)) console.log(`  TEXTFIT ${name}: [${v.kind}] "${v.text}" — ${v.detail}`); };

try {
  const { context, page, activity } = await openContext(browser, { device, role: roleArg, origin: server.origin, images: {} });
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).split('\n')[0]));
  page.on('request', (r) => { if (r.url().startsWith(API)) console.log('REQ', r.method(), r.url().replace(API, '')); });
  page.on('response', async (r) => { if (r.url().includes('/posts/mine')) console.log('RESP', r.status(), (await r.text().catch(() => '')).slice(0, 120)); });
  const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' }, body: JSON.stringify(body) });
  await page.route(`${M}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    return route.fulfill({ status: 200, contentType: file.endsWith('.webm') ? 'video/webm' : 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: readFileSync(path.join(mediaDir, file)) });
  });
  await page.route(`${API}/**/public/users/*/videos*`, (route) => route.fulfill(json({ user: { userId: 'demo', accountType: 'seller', displayName: 'Demo Brand', username: 'demo' }, total: posts.length, hasMore: false, videos: posts })));
  await page.route(`${API}/**/posts/mine*`, (route) => route.fulfill(json(posts)));
  await page.route(`${API}/**/social/profile/*/posts*`, (route) => route.fulfill(json(buyerPosts)));
  await page.route(`${API}/**/posts/11111111-*`, (route) => route.fulfill(json(posts[0])));
  await page.route(`${API}/**/social/posts/*`, (route) => route.fulfill(json(buyerPosts[0])));
  const target = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : '/seller-profile?sellerId=demo&isOwner=false';
  await openScreen(page, activity, server.origin, roleArg, target);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ok = await page.locator('[data-testid^="profile-video-tile-"]').first().waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
    if (ok) break;
    await page.evaluate((url) => { history.pushState(history.state, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); }, `${target}${target.includes('?') ? '&' : '?'}bt_preview=${roleArg}`);
  }
  await page.waitForTimeout(3500);
  await page.mouse.move(200, 500); await page.mouse.wheel(0, 900); await page.waitForTimeout(800);
  await shot(page, `${roleArg}-profile-posts-grid`);
  const tile = page.locator('[data-testid^="profile-video-tile-"]').first();
  await tile.click({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await shot(page, `${roleArg}-post-viewer-slide1`);
  await page.getByTestId('carousel-next').click();
  await shot(page, `${roleArg}-post-viewer-slide2`);
  await page.getByTestId('carousel-next').click();
  await shot(page, `${roleArg}-post-viewer-slide3-video`);
} catch (error) {
  console.log('FAILED:', String(error.message).split('\n')[0]);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: path.join(outDir, 'FAILED.png') }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
