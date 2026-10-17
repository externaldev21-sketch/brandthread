#!/usr/bin/env node
/**
 * Buyer tab bar over a playing video, on the web preview build at 390x844
 * (iPhone-sized, dark mode, real motion):
 *
 *   1. Threads feed with a busy, fast-changing video playing under the bar:
 *      a frame sequence of the bar region, a zoomed crop of the bar's top
 *      edge, and how many times BuyerTabBar re-rendered while it played.
 *   2. A non-video screen (Discover) for the "unchanged elsewhere" check.
 *   3. A 10-tap burst across the tabs (~8 taps/s): the pill's position every
 *      animation frame, frame times (fps), press -> route-committed time,
 *      and a frame sequence of the bar.
 *
 *   node scripts/tabbar-over-video-capture.mjs --label after [--clip busy|runway]
 *   node scripts/tabbar-over-video-capture.mjs --label before --build-dir <dir> --skip-build
 *
 * Extra flags: --no-screencast (time the burst without the capture's own
 * cost), --profile (CPU profile of the burst -> burst-profile.txt).
 *
 * Output: docs/screenshots/tabbar-over-video/<label>/
 *
 * Re-render counting uses a minimal React DevTools global hook: React calls
 * `onCommitFiberRoot` after every commit (production builds too), and the bar
 * re-rendered in a commit exactly when its root element's props object was
 * replaced.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
import {
  buildPreviewWeb, launchBrowser, openContext, openScreen, serveBuild,
  DEFAULT_BUILD_DIR, MOBILE_ROOT,
} from './store-screenshots/harness.mjs';

const DEVICE = {
  viewport: { width: 390, height: 844 }, scale: 3, isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
};
const API = 'https://api.brandthread.test';
const VIDEO_URL = 'https://cdn.brandthread.test/demo/busy-feed.webm';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** A 6s, 30fps, high-contrast clip (moving test pattern, a white band
 *  sweeping top to bottom, cycling hue) — worst case for a translucent bar. */
function makeBusyVideo(file) {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=6',
    '-f', 'lavfi', '-i', 'color=c=white:s=720x24:r=30:d=6',
    '-filter_complex', "[0][1]overlay=x=0:y='mod(t*400,1280)',hue=h=t*60",
    '-c:v', 'libvpx-vp9', '-b:v', '2M', '-deadline', 'realtime', '-cpu-used', '8', file,
  ], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ffmpeg failed to make the test clip');
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

/** Installed before the app loads: counts BuyerTabBar commits and samples
 *  the pill + frame times on demand. */
function instrument() {
  const stats = { barRenders: 0, commits: 0 };
  window.__tabBarStats = stats;
  const findBar = (fiber) => {
    // Iterative DFS for the outermost fiber whose props carry the bar's testID.
    const stack = [fiber];
    while (stack.length) {
      const f = stack.pop();
      if (!f) continue;
      if (f.memoizedProps && f.memoizedProps.testID === 'buyer-bottom-tab-bar') return f;
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    return null;
  };
  let cached = null;
  let seenAny = false;
  const seen = new WeakSet();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      stats.commits += 1;
      // Find the bar's fiber once, then only look at it and its alternate
      // (React's double buffer) — a full tree walk per commit would itself
      // cost more than the frames being measured.
      if (!cached || (!cached.return && !(cached.alternate && cached.alternate.return))) {
        cached = findBar(root.current);
        if (!cached) return;
      }
      for (const f of [cached, cached.alternate]) {
        const props = f && f.memoizedProps;
        if (props && !seen.has(props)) {
          // A props object this element never had before = BuyerTabBar
          // rendered it again.
          if (seenAny) stats.barRenders += 1;
          seen.add(props);
          seenAny = true;
        }
      }
    },
  };

  /** The pill: the absolutely positioned child of the capsule whose inline
   *  transform carries both translateX and scaleY. */
  let pill = null;
  window.__pillX = () => {
    if (!pill || !pill.isConnected) {
      pill = null;
      const bar = document.querySelector('[data-testid="buyer-bottom-tab-bar"]');
      if (!bar) return null;
      for (const el of bar.querySelectorAll('div')) {
        const t = el.style.transform;
        if (t && t.includes('translateX') && t.includes('scaleY')) { pill = el; break; }
      }
      if (!pill) return null;
    }
    const m = /translateX\(([-\d.]+)px\)/.exec(pill.style.transform);
    return { x: m ? Number(m[1]) : null, opacity: Number(pill.style.opacity || 1) };
  };

  window.__startSampling = () => {
    const samples = [];
    window.__samples = samples;
    window.__sampling = true;
    const tick = (t) => {
      samples.push({ t, pill: window.__pillX(), path: location.pathname });
      if (window.__sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  window.__stopSampling = () => { window.__sampling = false; return window.__samples; };

  // Every tab press: when it went down, and the first frame the URL showed
  // the pressed tab's route.
  window.__presses = [];
  document.addEventListener('pointerdown', (e) => {
    const tab = e.target.closest?.('[data-testid^="buyer-tab-"]');
    if (!tab) return;
    const route = tab.getAttribute('data-testid').replace('buyer-tab-', '');
    const press = { route, down: performance.now(), visible: null };
    window.__presses.push(press);
    const want = route === 'index' ? '/' : `/${route}`;
    const check = () => {
      if (location.pathname === want || (route === 'index' && location.pathname === '/index')) {
        press.visible = performance.now();
        return;
      }
      if (performance.now() - press.down < 2000) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, true);
}

function cropPng(src, clip, scale = DEVICE.scale) {
  const x0 = Math.round(clip.x * scale);
  const y0 = Math.round(clip.y * scale);
  const w = Math.min(src.width - x0, Math.round(clip.width * scale));
  const h = Math.min(src.height - y0, Math.round(clip.height * scale));
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(src, out, x0, y0, w, h, 0, 0);
  return out;
}

/** Mean absolute per-channel change (0-255) between two screenshots inside
 *  a CSS-px rect: how much that area visibly changes frame to frame. */
function regionDelta(a, b, rect, scale = DEVICE.scale) {
  let sum = 0;
  let n = 0;
  for (let y = Math.round(rect.y * scale); y < Math.round((rect.y + rect.height) * scale); y += 2) {
    for (let x = Math.round(rect.x * scale); x < Math.round((rect.x + rect.width) * scale); x += 2) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

const spread = (values) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean: Number(mean.toFixed(1)), sd: Number(sd.toFixed(1)), range: Number((Math.max(...values) - Math.min(...values)).toFixed(1)) };
};

async function clipBar(page) {
  const box = await page.locator('[data-testid="buyer-bottom-tab-bar"]').boundingBox();
  // A margin around the bar so the shadow, the edge and anything drawn
  // just above it are all in frame.
  return { x: 0, y: Math.max(0, box.y - 40), width: DEVICE.viewport.width, height: Math.min(DEVICE.viewport.height - (box.y - 40), box.height + 80) };
}

async function main() {
  const label = arg('label', 'after');
  const buildDir = arg('build-dir', DEFAULT_BUILD_DIR);
  const outDir = path.join(MOBILE_ROOT, '..', '..', 'docs', 'screenshots', 'tabbar-over-video', label + (arg('clip', 'busy') === 'busy' ? '' : `-${arg('clip')}`));
  const workDir = path.join(MOBILE_ROOT, '.store-screenshots');
  mkdirSync(workDir, { recursive: true });
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  // --clip busy (default): the synthetic worst case above. --clip runway:
  // the app's own bundled runway footage (assets/videos/fashion_runway_01,
  // H.264, which Playwright's Chromium can't decode — transcoded to VP9).
  const clipName = arg('clip', 'busy');
  const videoFile = path.join(workDir, `${clipName}-feed.webm`);
  if (clipName === 'runway') {
    const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(MOBILE_ROOT, 'assets', 'videos', 'fashion_runway_01.mp4'),
      '-vf', 'scale=720:1280', '-c:v', 'libvpx-vp9', '-b:v', '2.5M', '-deadline', 'realtime', '-cpu-used', '8', '-an', videoFile], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('ffmpeg failed to transcode the runway clip');
  } else {
    makeBusyVideo(videoFile);
  }
  if (!process.argv.includes('--skip-build')) buildPreviewWeb(buildDir);

  const server = await serveBuild(buildDir);
  const browser = await launchBrowser();
  const result = { label, clip: clipName, viewport: '390x844@3x', engine: 'Chromium (web preview build)' };
  try {
    const { context, page, activity } = await openContext(browser, {
      device: DEVICE, role: 'buyer', origin: server.origin, images: {},
      installClock: false, contextOptions: { reducedMotion: 'no-preference' },
    });
    await context.addInitScript(() => localStorage.setItem('bt:intro-splash:launched:v1', 'true'));
    await context.addInitScript(instrument);
    const { readFileSync } = await import('node:fs');
    const clip = readFileSync(videoFile);
    await page.route(VIDEO_URL, (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: clip }));
    await page.route(`${API}/api/v1/public/posts**`, (route) => route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': server.origin, 'access-control-allow-credentials': 'true' },
      contentType: 'application/json',
      body: JSON.stringify(videoPosts()),
    }));

    await openScreen(page, activity, server.origin, 'buyer', '/');
    await page.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => !v.paused && v.currentTime > 0.5), undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);

    // ── 1. Over a playing video ────────────────────────────────────────────
    const barClip = await clipBar(page);
    const before = await page.evaluate(() => ({ ...window.__tabBarStats, t: performance.now(), video: [...document.querySelectorAll('video')].find((v) => !v.paused)?.currentTime ?? null }));
    const frameDir = path.join(outDir, 'over-video-frames');
    mkdirSync(frameDir, { recursive: true });
    // Regions: the capsule's and the Profile circle's glass (inset 6pt from
    // their edges), and a same-height strip of bare video just above the
    // bar for comparison.
    const regions = await page.evaluate(() => {
      const r = (id) => document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
      const first = r('buyer-tab-index');
      const last = r('buyer-tab-activity');
      const profile = r('buyer-tab-profile');
      const bar = r('buyer-bottom-tab-bar');
      const inset = 6;
      return {
        capsule: { x: first.left + inset, y: first.top + inset, width: last.right - first.left - inset * 2, height: first.height - inset * 2 },
        circle: { x: profile.left + inset, y: profile.top + inset, width: profile.width - inset * 2, height: profile.height - inset * 2 },
        video: { x: first.left, y: bar.top - 70, width: last.right - first.left, height: first.height - 12 },
      };
    });
    const surfaceDeltas = { capsule: [], circle: [], video: [] };
    let previous = null;
    for (let i = 0; i < 24; i += 1) {
      const shot = await page.screenshot();
      const png = PNG.sync.read(shot);
      writeFileSync(path.join(frameDir, `${String(i + 1).padStart(2, '0')}.png`), PNG.sync.write(cropPng(png, barClip)));
      if (previous) {
        for (const key of Object.keys(surfaceDeltas)) surfaceDeltas[key].push(regionDelta(previous, png, regions[key]));
      }
      previous = png;
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({ ...window.__tabBarStats, t: performance.now(), video: [...document.querySelectorAll('video')].find((v) => !v.paused)?.currentTime ?? null }));
    result.overVideo = {
      seconds: Number(((after.t - before.t) / 1000).toFixed(2)),
      videoPlaying: after.video !== null,
      reactCommits: after.commits - before.commits,
      tabBarRenders: after.barRenders - before.barRenders,
      // Mean per-channel change (0-255) between consecutive frames: how much
      // of the video's motion shows through the bar's surface — the visible
      // "flicker" — next to the bare video right above the bar.
      frameDeltaCapsule: spread(surfaceDeltas.capsule),
      frameDeltaProfileCircle: spread(surfaceDeltas.circle),
      frameDeltaVideoAboveBar: spread(surfaceDeltas.video),
    };
    await page.screenshot({ path: path.join(outDir, 'feed-full.png') });
    // Zoomed: the bar's top edge and everything just above it, 4x.
    const barBox = await page.locator('[data-testid="buyer-bottom-tab-bar"]').boundingBox();
    await page.screenshot({
      path: path.join(outDir, 'feed-bar-edge-zoom-src.png'),
      clip: { x: barBox.x, y: barBox.y - 24, width: 200, height: 48 },
    });
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(outDir, 'feed-bar-edge-zoom-src.png'),
      '-vf', 'scale=iw*4:ih*4:flags=neighbor', path.join(outDir, 'feed-bar-edge-zoom-4x.png')]);
    rmSync(path.join(outDir, 'feed-bar-edge-zoom-src.png'));

    // ── 2. Non-video screen ────────────────────────────────────────────────
    await page.locator('[data-testid="buyer-tab-discover"]').click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, 'discover-full.png') });
    await page.screenshot({ path: path.join(outDir, 'discover-bar.png'), clip: await clipBar(page) });
    await page.locator('[data-testid="buyer-tab-index"]').click();
    await page.waitForTimeout(1500);

    // ── 3. Rapid 10-tap burst ──────────────────────────────────────────────
    const order = ['discover', 'inbox', 'activity', 'index', 'discover', 'activity', 'inbox', 'index', 'activity', 'discover'];
    const rendersBeforeBurst = await page.evaluate(() => window.__tabBarStats.barRenders);
    await page.evaluate(() => {
      window.__presses.length = 0;
      window.__longTasks = [];
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__longTasks.push(Math.round(entry.duration));
        }).observe({ type: 'longtask' });
      } catch { /* not supported */ }
      window.__startSampling();
    });
    const burstDir = path.join(outDir, 'burst-frames');
    mkdirSync(burstDir, { recursive: true });
    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', async (f) => {
      frames.push(f.data);
      await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    // --no-screencast: measure frame times without the capture's own cost.
    const screencast = !process.argv.includes('--no-screencast');
    if (screencast) await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 390 * 2, maxHeight: 844 * 2 });
    const profiling = process.argv.includes('--profile');
    if (profiling) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    for (const route of order) {
      const box = await page.locator(`[data-testid="buyer-tab-${route}"]`).boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900);
    if (screencast) await cdp.send('Page.stopScreencast');
    if (profiling) {
      // Self time and inclusive time per function, for the burst only.
      const { profile } = await cdp.send('Profiler.stop');
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const parent = new Map();
      for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
      const dt = profile.timeDeltas;
      const self = new Map();
      const total = new Map();
      profile.samples.forEach((id, i) => {
        const ms = (dt[i + 1] ?? dt[i] ?? 0) / 1000;
        const n = byId.get(id);
        const key = (fn) => `${fn.functionName || '(anon)'} ${fn.url.split('/').pop()}:${fn.lineNumber + 1}`;
        self.set(key(n.callFrame), (self.get(key(n.callFrame)) ?? 0) + ms);
        const seen = new Set();
        for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
          const k = key(byId.get(cur).callFrame);
          if (seen.has(k)) continue;
          seen.add(k);
          total.set(k, (total.get(k) ?? 0) + ms);
        }
      });
      const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([k, v]) => `${v.toFixed(1)}ms  ${k}`);
      writeFileSync(path.join(outDir, 'burst-profile.txt'), `SELF\n${top(self).join('\n')}\n\nTOTAL\n${top(total).join('\n')}\n`);
    }
    const samples = await page.evaluate(() => window.__stopSampling());
    const presses = await page.evaluate(() => window.__presses);
    // Positive control for the render counter: switching tabs must render the bar.
    const burstRenders = await page.evaluate((n) => window.__tabBarStats.barRenders - n, rendersBeforeBurst);
    frames.forEach((data, i) => writeFileSync(path.join(burstDir, `${String(i + 1).padStart(3, '0')}.png`), Buffer.from(data, 'base64')));

    const deltas = samples.slice(1).map((s, i) => s.t - samples[i].t);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const pressMs = presses.map((p) => (p.visible === null ? null : p.visible - p.down));
    const lastPill = samples.at(-1)?.pill;
    result.burst = {
      taps: order.length,
      tabBarRenders: burstRenders,
      screencast,
      longTasksMs: await page.evaluate(() => window.__longTasks),
      tapIntervalMs: 120,
      finalRoute: samples.at(-1)?.path,
      expectedRoute: `/${order.at(-1)}`,
      finalPillX: lastPill?.x ?? null,
      frames: samples.length,
      avgFps: Number((1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length)).toFixed(1)),
      frameMsP50: Number(pct(0.5).toFixed(1)),
      frameMsP95: Number(pct(0.95).toFixed(1)),
      frameMsMax: Number(sorted.at(-1).toFixed(1)),
      framesOver20ms: deltas.filter((d) => d > 20).length,
      pressToRouteMs: pressMs.map((v) => (v === null ? null : Math.round(v))),
      pressToRouteMaxMs: Math.round(Math.max(...pressMs.filter((v) => v !== null))),
      // Pill direction reversals that aren't at a tap: the "snaps back to an
      // older tab mid-burst" glitch shows up here.
      pillTrace: samples.map((s) => (s.pill ? Math.round(s.pill.x) : null)),
    };
    writeFileSync(path.join(outDir, 'burst-samples.json'), JSON.stringify({ presses, samples }, null, 2));
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, burst: { ...result.burst, pillTrace: undefined } }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
