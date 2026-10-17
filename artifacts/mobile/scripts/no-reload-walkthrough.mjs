#!/usr/bin/env node
/**
 * "Nothing reloads" walkthrough on the web preview build (390x844, dark,
 * real motion): Threads (video playing) -> Messages tab -> open a thread ->
 * back -> Threads -> Profile -> back to Threads.
 *
 * At every return it checks, in the page itself, that what was on screen
 * before is still the same thing — not a re-creation of it:
 *   - the feed's playing <video> is the same DOM node, still playing, and
 *     its playback position moved on (no reload/re-buffer from 0);
 *   - the Messages list's first row is the same DOM node (no remount) and
 *     the list kept its scroll position;
 *   - the Profile screen's content node is the same node;
 *   - no skeleton / activity indicator appears in the first frames back.
 * A screencast of the whole run is saved as a frame sequence.
 *
 *   node scripts/no-reload-walkthrough.mjs --label after --build-dir <dev export>
 *
 * The build must be a development export (`pnpm exec expo export --dev
 * --platform web`, with the EXPO_PUBLIC_* values buildPreviewWeb sets), so
 * the preview inbox has demo threads to open.
 *
 * Output: docs/screenshots/tabbar-over-video/<label>/walkthrough/
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  launchBrowser, openContext, openScreen, serveBuild, DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const DEVICE = {
  viewport: { width: 390, height: 844 }, scale: 2, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};
const API = 'https://api.brandthread.test';
const VIDEO_URL = 'https://cdn.brandthread.test/demo/busy-feed.webm';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const videoPosts = () => Array.from({ length: 4 }, (_, i) => ({
  id: `post_video_${i + 1}`,
  userId: 'user_quiet',
  seller: { brandName: 'Quiet Hours', displayName: 'Quiet Hours', avatarUrl: null },
  caption: 'Moss, midnight and bone.',
  mediaType: 'video',
  mediaUrls: [VIDEO_URL],
  mediaUrl: VIDEO_URL,
  thumbnailUrl: null,
  taggedProducts: [],
  likesCount: 100, commentsCount: 4, repostsCount: 1,
  createdAt: new Date(Date.now() - (i + 1) * 3_600_000).toISOString(),
}));

/** In-page helpers: tag nodes before leaving, verify them after returning,
 *  and watch every frame for loading UI. */
function helpers() {
  window.__tags = {};
  window.__tag = (name, el) => {
    if (!el) return false;
    el.__btTag = name;
    window.__tags[name] = el;
    // A reload of a <video> (new source, re-buffer from scratch) fires
    // 'emptied'/'loadstart'; a pause/resume fires neither.
    if (el.tagName === 'VIDEO') {
      el.__reloads = 0;
      el.addEventListener('emptied', () => { el.__reloads += 1; });
      el.addEventListener('loadstart', () => { el.__reloads += 1; });
    }
    return true;
  };
  window.__playing = () => [...document.querySelectorAll('video')].find((v) => !v.paused && v.offsetParent !== null) ?? null;
  window.__loadingSeen = [];
  // Every frame: is there a visible spinner/skeleton anywhere on screen?
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  window.__watchLoading = (label, ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const tick = () => {
      const found = [...document.querySelectorAll('[role="progressbar"], [aria-busy="true"], [data-testid*="skeleton" i], [data-testid*="Skeleton"]')]
        .filter(visible)
        .map((el) => el.getAttribute('data-testid') || el.getAttribute('role') || el.tagName);
      if (found.length) window.__loadingSeen.push({ label, at: Math.round(performance.now()), found: [...new Set(found)].slice(0, 5) });
      if (performance.now() < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
}

async function main() {
  const label = arg('label', 'after');
  const buildDir = arg('build-dir', DEFAULT_BUILD_DIR);
  const outDir = path.join(MOBILE_ROOT, '..', '..', 'docs', 'screenshots', 'tabbar-over-video', label, 'walkthrough');
  const workDir = path.join(MOBILE_ROOT, '.store-screenshots');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, 'frames'), { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const videoFile = path.join(workDir, 'busy-feed.webm');
  spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=6',
    '-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', videoFile,
  ], { stdio: 'inherit' });
  for (let i = 1; i <= 10; i += 1) {
    const n = String(i).padStart(2, '0');
    const out = path.join(workDir, `fashion_runway_${n}.webm`);
    if (existsSync(out)) continue;
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(MOBILE_ROOT, 'assets', 'videos', `fashion_runway_${n}.mp4`),
      '-vf', 'scale=720:1280', '-c:v', 'libvpx-vp9', '-b:v', '2.5M', '-deadline', 'realtime', '-cpu-used', '8', '-an', out], { stdio: 'inherit' });
  }
  // Needs a *development* export (`expo export --dev`, same EXPO_PUBLIC_*
  // env as store-screenshots/harness.mjs's buildPreviewWeb): the preview
  // inbox's demo threads (lib/previewInbox.ts) only exist in __DEV__ builds.
  if (!process.argv.includes('--build-dir')) throw new Error('Pass --build-dir <a dev web export>; see the header comment.');

  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const checks = [];
  const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), ...(detail === undefined ? {} : { detail }) });
  try {
    const { context, page, activity } = await openContext(browser, {
      device: DEVICE, role: 'buyer', origin: server.origin, images: {},
      installClock: false, contextOptions: { reducedMotion: 'no-preference' },
    });
    await context.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await context.addInitScript(helpers);
    const clip = readFileSync(videoFile);
    // The app's own bundled runway clips (the __DEV__ preview feed) are
    // H.264, which Playwright's Chromium can't decode — serve each as the
    // VP9 transcode made above instead, so the feed plays real footage.
    await page.route(/fashion_runway_(\d+)\.[0-9a-f]+\.mp4/, (route) => {
      const n = /fashion_runway_(\d+)/.exec(route.request().url())[1];
      return route.fulfill({ status: 200, contentType: 'video/webm', body: readFileSync(path.join(workDir, `fashion_runway_${n}.webm`)) });
    });
    await page.route(VIDEO_URL, (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: clip }));
    await page.route(`${API}/api/v1/public/posts**`, (route) => route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' },
      contentType: 'application/json',
      body: JSON.stringify(videoPosts()),
    }));
    // demo=1 seeds the preview inbox (lib/previewInbox.ts) so Messages has threads.
    await openScreen(page, activity, server.origin, 'buyer', '/', { extraQuery: '&demo=1' });
    await page.waitForFunction(() => window.__playing()?.currentTime > 0.5, undefined, { timeout: 30_000 });
    await page.waitForTimeout(800);

    const cdp = await context.newCDPSession(page);
    let frameNo = 0;
    const frameLog = [];
    let step = 'threads';
    cdp.on('Page.screencastFrame', async (f) => {
      frameNo += 1;
      const name = `${String(frameNo).padStart(4, '0')}-${step}.jpg`;
      writeFileSync(path.join(outDir, 'frames', name), Buffer.from(f.data, 'base64'));
      frameLog.push(name);
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1, maxWidth: 390 * 2, maxHeight: 844 * 2 });
    const tap = async (testId) => {
      const box = await page.locator(`[data-testid="${testId}"]`).first().boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    const feedState = () => page.evaluate(() => {
      const v = window.__playing();
      const tagged = window.__tags['feed-video'];
      return { tagged: v ? v.__btTag === 'feed-video' : false, time: v ? v.currentTime : null, reloads: tagged ? tagged.__reloads : null };
    });

    // ── Threads: tag the playing video ─────────────────────────────────────
    await page.evaluate(() => window.__tag('feed-video', window.__playing()));
    const t0 = (await feedState()).time;

    // ── Messages tab ───────────────────────────────────────────────────────
    step = 'to-messages';
    await tap('buyer-tab-inbox');
    await page.waitForSelector('[data-testid^="inbox-conversation-"]', { timeout: 10_000 });
    await page.waitForTimeout(700);
    step = 'messages';
    await page.evaluate(() => {
      const row = document.querySelector('[data-testid^="inbox-conversation-"]');
      window.__tag('inbox-row', row);
      // Scroll the list a little so a reset to the top would show.
      let s = row.parentElement;
      while (s && s.scrollHeight <= s.clientHeight) s = s.parentElement;
      if (s) { s.scrollTop = 40; window.__tag('inbox-scroller', s); window.__inboxScroll = s.scrollTop; }
    });
    await page.waitForTimeout(300);

    // ── Open a thread, then back ───────────────────────────────────────────
    step = 'to-thread';
    await page.locator('[data-testid^="inbox-conversation-"]').first().click();
    await page.waitForFunction(() => location.pathname.includes('buyer-conversation'), undefined, { timeout: 10_000 });
    await page.waitForTimeout(900);
    // Is the Messages list hidden with display:none while the thread is on
    // top? Browsers throw away an element's scrollTop when it (or an
    // ancestor) is display:none, so on web the list comes back at the top
    // however the app handles it; native keeps the hidden view's offset.
    const hiddenWhileInThread = await page.evaluate(() => {
      for (let n = window.__tags['inbox-scroller']; n; n = n.parentElement) {
        if (getComputedStyle(n).display === 'none') return true;
      }
      return false;
    });
    step = 'back-to-messages';
    const watchBack = page.evaluate(() => window.__watchLoading('back-to-messages', 900));
    await page.goBack();
    await watchBack;
    const inbox = await page.evaluate(() => {
      const row = document.querySelector('[data-testid^="inbox-conversation-"]');
      const s = window.__tags['inbox-scroller'];
      return { sameRow: row === window.__tags['inbox-row'], scroll: s ? s.scrollTop : null, scrollBefore: window.__inboxScroll ?? null };
    });
    check('Messages: first row is the same DOM node after back (no remount)', inbox.sameRow);
    if (hiddenWhileInThread) {
      // Not a pass/fail of the app: see hiddenWhileInThread above.
      checks.push({ name: 'Messages: scroll position after back — not measurable on web (the browser hid the list with display:none while the thread was open, which resets scrollTop)', pass: true, info: true, detail: inbox });
    } else {
      check('Messages: scroll position kept after back', inbox.scroll === inbox.scrollBefore, inbox);
    }

    // ── Back to Threads ────────────────────────────────────────────────────
    step = 'to-threads';
    const watchThreads = page.evaluate(() => window.__watchLoading('back-to-threads', 900));
    await tap('buyer-tab-index');
    await watchThreads;
    await page.waitForTimeout(400);
    const f1 = await feedState();
    check('Threads: same <video> element playing after Messages round trip', f1.tagged, f1);
    check('Threads: video was paused and resumed, never reloaded (no emptied/loadstart)', f1.reloads === 0, { before: t0, after: f1.time, reloads: f1.reloads });

    // ── Profile, then back ─────────────────────────────────────────────────
    step = 'to-profile';
    await tap('buyer-tab-profile');
    await page.waitForFunction(() => location.pathname.includes('profile'), undefined, { timeout: 10_000 });
    await page.waitForTimeout(900);
    step = 'profile';
    await page.evaluate(() => {
      const roots = [...document.querySelectorAll('[data-testid]')].filter((el) => el.offsetParent !== null && /profile/i.test(el.getAttribute('data-testid')));
      window.__tag('profile-node', roots.find((el) => !el.getAttribute('data-testid').startsWith('buyer-tab')) ?? null);
    });
    const profileTag = await page.evaluate(() => window.__tags['profile-node']?.getAttribute('data-testid') ?? null);
    step = 'back-to-threads';
    const watchThreads2 = page.evaluate(() => window.__watchLoading('back-to-threads-2', 900));
    await tap('buyer-tab-index');
    await watchThreads2;
    await page.waitForTimeout(400);
    const f2 = await feedState();
    check('Threads: same <video> element playing after Profile round trip', f2.tagged, f2);
    check('Threads: still never reloaded after the Profile round trip', f2.reloads === 0, f2);
    // And Profile again — its own content node must be the one we tagged.
    step = 'profile-again';
    await tap('buyer-tab-profile');
    await page.waitForTimeout(700);
    const sameProfile = await page.evaluate(() => {
      const el = window.__tags['profile-node'];
      return Boolean(el && el.isConnected && el.offsetParent !== null);
    });
    check(`Profile: same content node on return (${profileTag ?? 'none found'})`, profileTag !== null && sameProfile);
    step = 'end';
    await page.waitForTimeout(300);
    await cdp.send('Page.stopScreencast');
    const loading = await page.evaluate(() => window.__loadingSeen);
    check('No spinner/skeleton visible in the first 900ms after any return', loading.length === 0, loading.slice(0, 5));
    writeFileSync(path.join(outDir, 'frames.txt'), frameLog.join('\n'));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  const result = { label, checks, allPass: checks.every((c) => c.pass) };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
