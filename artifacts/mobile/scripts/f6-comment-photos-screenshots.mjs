#!/usr/bin/env node
/**
 * Verification screenshots for F6 item 83 — photo replies in comments
 * (Threads 1:1). Real component code paths run against the fake API; the
 * comment + upload endpoints are answered here.
 *
 *   node scripts/f6-comment-photos-screenshots.mjs              # builds first
 *   node scripts/f6-comment-photos-screenshots.mjs --skip-build
 *
 * Output: ../../docs/pr-assets/comment-photos/ours/<NN-step>.png
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  waitForImages, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';
import { ensureDemoImages } from './store-screenshots/demo-images.mjs';
import { DEMO_NOW, IMAGE_HOST } from './store-screenshots/demo-data.mjs';

const OUT = path.resolve(MOBILE_ROOT, '..', '..', 'docs', 'pr-assets', 'comment-photos', 'ours');
const API = 'https://api.brandthread.test';
const STORAGE = 'https://storage.googleapis.com/bt-demo/comment-media';
const POST_ID = '6f1c7d4e-2b9a-4c3d-8e5f-0a1b2c3d4e5f';

const now = new Date(DEMO_NOW).getTime();
const ago = (min) => new Date(now - min * 60_000).toISOString();
const person = (userId, name, handle, img) => ({
  userId, name, handle, initials: name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase(),
  avatarUrl: img ? `${IMAGE_HOST}/demo/${img}.jpg` : null, accountType: 'buyer', suspended: false, deleted: false,
});
const base = (id, author, body, createdAt, extra = {}) => ({
  id, postId: POST_ID, parentId: null, body, createdAt, author,
  likesCount: 0, likedByMe: false, isMine: false, canDelete: false, pendingReview: false,
  pinned: false, creatorLiked: false, mentions: [], media: null, replies: [], ...extra,
});

const maya = person('u_maya', 'Maya Chen', 'maya', 'portrait-rust');
const jules = person('u_jules', 'Jules Park', 'jules', 'portrait-mono');
const me = person('user_demo_buyer', 'You', 'you', null);

function thread(extra = []) {
  const root = base('c0000000-0000-4000-8000-000000000001', maya, 'Wore mine to the gallery opening last night', ago(95), {
    likesCount: 42,
    media: { id: 'm1', url: `${STORAGE}/look.jpg`, width: 900, height: 1200 },
    replies: [
      base('c0000000-0000-4000-8000-000000000002', jules, '', ago(60), {
        parentId: 'c0000000-0000-4000-8000-000000000001', likesCount: 6,
        media: { id: 'm2', url: `${STORAGE}/hoodie.jpg`, width: 900, height: 900 },
      }),
    ],
  });
  const text = base('c0000000-0000-4000-8000-000000000003', jules, 'Does the Ember run true to size?', ago(30), { likesCount: 3 });
  return {
    comments: [...extra, root, text], total: 3 + extra.length, hiddenByMutedWords: 0,
    commentsDisabled: false, canComment: true, isPostOwner: false, nextCursor: null,
  };
}

async function scrollTop(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = 0;
    }
  });
  await page.waitForTimeout(300);
}

async function shot(page, index, name) {
  mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  console.log(`    saved ${path.relative(process.cwd(), file)}`);
}

async function main() {
  if (!process.argv.includes('--skip-build')) buildPreviewWeb();
  const { origin, close } = await serveBuild(DEFAULT_BUILD_DIR);
  const browser = await launchBrowser();
  const images = await ensureDemoImages(browser, path.join(MOBILE_ROOT, '.store-screenshots', 'images'));
  const device = {
    viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
  };
  const { context, page, activity } = await openContext(browser, { device, role: 'buyer', origin, images });
  page.on('pageerror', (err) => console.log(`    (page error: ${err.message.split('\n')[0]})`));
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'authorization,content-type,x-store-context',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  const json = (route, body, status = 200) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });

  const posted = [];
  await page.route('https://storage.googleapis.com/**', (route) => {
    const name = route.request().url().includes('hoodie') ? 'hoodie-ember' : route.request().url().includes('mine') ? 'jacket-rust' : 'look-rust';
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: readFileSync(images[name]) });
  });
  await page.route(`${API}/api/**/comment-media/upload`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    await new Promise((r) => setTimeout(r, 400));
    return json(route, { media: { id: 'm-new', url: `${STORAGE}/mine.jpg`, width: 900, height: 900 } }, 201);
  });
  await page.route(`${API}/api/**/posts/${POST_ID}/comments**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      const c = base('c0000000-0000-4000-8000-0000000000aa', me, body.body ?? '', new Date(now).toISOString(), {
        isMine: true, canDelete: true,
        media: body.media ? { id: 'm-new', url: `${STORAGE}/mine.jpg`, width: 900, height: 900 } : null,
      });
      posted.unshift(c);
      return json(route, { comment: c, moderation: { status: 'visible' } }, 201);
    }
    return json(route, thread(posted));
  });

  let i = 0;
  try {
    const target = `/buyer-post-comments?postId=${POST_ID}&postType=photo&postMediaUri=${encodeURIComponent(`${IMAGE_HOST}/demo/look-mono.jpg`)}`;
    for (let attempt = 0; ; attempt += 1) {
      await openScreen(page, activity, origin, 'buyer', target);
      const ok = await page.waitForSelector('[data-testid="comment-photo"]', { timeout: 12_000 }).then(() => true, () => false);
      if (ok) break;
      if (attempt >= 3) throw new Error('comments never loaded');
    }
    await page.waitForTimeout(800);
    await waitForImages(page);
    await scrollTop(page);
    await shot(page, ++i, 'comments-with-photos');

    // Expand the reply thread so the photo reply shows.
    const viewReplies = page.getByLabel('View 1 reply').first();
    if (await viewReplies.count()) {
      await viewReplies.click();
      await page.waitForTimeout(500);
      await waitForImages(page);
      await shot(page, ++i, 'photo-reply-expanded');
    }

    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.getByTestId('comment-photo-button').click();
    await (await chooser).setFiles(images['jacket-rust']);
    await page.waitForSelector('[data-testid="comment-photo-uploading"]', { timeout: 10_000 }).catch(() => {});
    await shot(page, ++i, 'draft-uploading');
    await page.waitForSelector('[data-testid="comment-photo-uploading"]', { state: 'detached', timeout: 10_000 });
    await page.getByTestId('composer-input').fill('Same fit, size M');
    await page.waitForTimeout(300);
    await shot(page, ++i, 'draft-ready-with-remove');

    await page.getByTestId('composer-send').click();
    await page.waitForTimeout(1200);
    await waitForImages(page);
    await scrollTop(page);
    await shot(page, ++i, 'posted-photo-comment');

    await page.getByTestId('comment-photo').first().click();
    await page.waitForTimeout(800);
    await waitForImages(page);
    await shot(page, ++i, 'full-screen-viewer');
  } catch (error) {
    console.error(`  failed: ${String(error?.message ?? error).split('\n')[0]}`);
    await shot(page, ++i, 'FAILED-state').catch(() => {});
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
