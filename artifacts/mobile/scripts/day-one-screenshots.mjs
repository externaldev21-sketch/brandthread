#!/usr/bin/env node
/**
 * "Day 1" badge: before (dev) and after, at 393x852, with the
 * store-screenshots harness (signed-in demo buyer) and fake comments /
 * day-one responses. Scenes: a brand's comments (one Day 1 commenter) and the
 * buyer's own profile. (Another buyer's profile is a not-found screen in the
 * preview build by design, so it isn't captured; it renders the same row.)
 *
 *   node scripts/day-one-screenshots.mjs [--skip-build] [--only=before|after]
 *
 * Output: docs/pr-assets/day-one/
 */
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import {
  DEFAULT_BUILD_DIR, MOBILE_ROOT, WORK_DIR, buildPreviewWeb, launchBrowser, openContext, openScreen,
  serveBuild, waitForImages, waitForQuietNetwork,
} from './store-screenshots/harness.mjs';
import { BUYER_USER, DEMO_NOW } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '../../docs/pr-assets/day-one');
const BASELINE_DIR = '/home/user/baseline-web-build';
const POST = '0b1c2d3e-4f50-4617-8899-aabbccddeeff';
const BRAND = 'user_northline';
const OTHER = 'user_maya';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DEVICE = { viewport: { width: 393, height: 852 }, scale: 2, isMobile: true, userAgent: UA };
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const MIN = 60_000;

const json = (origin, body) => ({
  status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' },
  body: JSON.stringify(body),
});

const author = (userId, name, handle, initials) => ({ userId, name, handle, initials, avatarUrl: null, accountType: 'buyer', suspended: false, deleted: false });
const comment = (id, a, body, minsAgo, extra = {}) => ({
  id, postId: POST, parentId: null, body, createdAt: new Date(DEMO_NOW - minsAgo * MIN).toISOString(), author: a,
  likesCount: 0, likedByMe: false, isMine: false, canDelete: false, pendingReview: false, pinned: false,
  creatorLiked: false, mentions: [], dayOne: false, replies: [], hasMoreReplies: false, repliesNextCursor: null, ...extra,
});
const COMMENTS = [
  comment('c1', author(OTHER, 'Maya Chen', '@mayac', 'MC'), 'Had the first run of this. Still my most worn jacket.', 12, { dayOne: true, likesCount: 41, creatorLiked: true }),
  comment('c2', author('user_devon', 'Devon Park', '@devonp', 'DP'), 'Does the rust run warm or cool in daylight?', 34, { likesCount: 6 }),
  comment('c3', author(BRAND, 'Northline Studio', '@northlinestudio', 'NS'), 'Warm. Closer to the second photo.', 30, { likesCount: 12 }),
  comment('c4', author('user_sam', 'Sam Ortiz', '@samo', 'SO'), 'Size chart please', 52),
];
const BRANDS = [
  { sellerId: BRAND, name: 'Northline Studio', handle: '@northlinestudio', initials: 'NS', avatarUrl: null, rank: 18, since: new Date(DEMO_NOW - 200 * 24 * 60 * MIN).toISOString() },
  { sellerId: 'user_fieldoffice', name: 'Field Office', handle: '@fieldoffice', initials: 'FO', avatarUrl: null, rank: 73, since: new Date(DEMO_NOW - 90 * 24 * 60 * MIN).toISOString() },
];

async function setup(browser, images, origin) {
  const { context, page, activity } = await openContext(browser, { device: DEVICE, role: 'buyer', origin, images });
  const is = (url, re) => re.test(url.pathname);
  await context.route((url) => is(url, new RegExp(`/api(/v1)?/posts/${POST}/comments$`)), (route) => route.request().method() === 'OPTIONS' ? route.fallback() : route.fulfill(json(origin, {
    comments: COMMENTS, total: COMMENTS.length, hiddenByMutedWords: 0, commentsDisabled: false, canComment: true, isPostOwner: false, nextCursor: null,
  })));
  await context.route((url) => is(url, /\/api(\/v1)?\/day-one\//), (route) => {
    if (route.request().method() === 'OPTIONS') return route.fallback();
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill(json(origin, { brands: id === OTHER ? [BRANDS[0]] : id === BUYER_USER.id ? BRANDS : [] }));
  });
  return { context, page, activity };
}

async function open(page, activity, origin, target, waitFor) {
  for (let attempt = 0; ; attempt++) {
    await openScreen(page, activity, origin, 'buyer', target);
    try { await page.getByText(waitFor).first().waitFor({ timeout: 30_000 }); break; } catch (e) {
      await page.screenshot({ path: path.join(WORK_DIR, 'day-one-fail.png') });
      if (attempt >= 3) throw e;
    }
  }
  await waitForQuietNetwork(activity);
  await waitForImages(page);
  await page.waitForTimeout(800);
}

async function capture(label, buildDir) {
  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(WORK_DIR, 'demo-images'));
  const o = server.origin;
  try {
    const { context, page, activity } = await setup(browser, images, o);
    await open(page, activity, o, `/buyer-post-comments?postId=${POST}&postAuthorName=Northline%20Studio&postAuthorId=${BRAND}`, 'Maya Chen');
    await page.screenshot({ path: path.join(OUT, `${label}-comments-393x852.png`) });
    await open(page, activity, o, '/(buyer)/profile', 'Edit profile');
    await page.screenshot({ path: path.join(OUT, `${label}-own-profile-393x852.png`) });
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  if (only !== 'after') {
    if (!existsSync(path.join(BASELINE_DIR, 'index.html'))) throw new Error(`Baseline build missing at ${BASELINE_DIR}`);
    await capture('before', BASELINE_DIR);
  }
  if (only !== 'before') {
    if (!process.argv.includes('--skip-build') || !existsSync(path.join(DEFAULT_BUILD_DIR, 'index.html'))) buildPreviewWeb(DEFAULT_BUILD_DIR);
    await capture('after', DEFAULT_BUILD_DIR);
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
