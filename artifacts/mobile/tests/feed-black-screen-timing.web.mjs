/**
 * Verification script for the "35s black screen on first load" bug.
 *
 * Simulates the reported failure mode directly: a Clerk `getToken()` that
 * never resolves (a real session-bootstrap/network hang). Before the fix in
 * lib/api.ts, every request made through createApi() — including the
 * feed's initial `loadFeed()` call — awaited that hang with no ceiling, so
 * `feedLoading` never cleared and the app never got past whatever depends
 * on it.
 *
 * Measures wall-clock time from a hard reload until the first feed item's
 * poster/video element is present, decoded, and sized to cover the
 * viewport — i.e. real content is on screen, not just an empty container.
 *
 * Honest scope: this confirms the DOM has real, decoded, correctly-sized
 * media — it does not attempt pixel-level "was the screen visually black"
 * verification. Two things made that unreliable to automate in this
 * sandbox: (1) the bundled fashion-preview photography is itself
 * deliberately dark/moody (monochrome coats, black backgrounds), so a
 * screenshot-brightness heuristic can't reliably distinguish "genuinely
 * dark photo, rendering correctly" from "still blank/covered"; (2) React
 * Native Web layers large, mostly-transparent hit-target Views (the
 * engagement rail, caption block, shop tab) on top of the video for touch
 * handling, which defeats a naive `document.elementsFromPoint` occlusion
 * check (it reports those transparent containers as "on top" even though
 * nothing is visually blocked). The DOM decode/size check below is the
 * reliable signal; see the PR description for what was and wasn't
 * possible to confirm end-to-end in this sandbox.
 *
 * Usage:  node tests/feed-black-screen-timing.web.mjs
 */
import { spawn } from 'node:child_process';

const PORT = process.env.FEED_BLACK_SCREEN_PORT || '8172';
const DEMO_CLERK_KEY = `pk_test_${Buffer.from('clerk.brandthread.test$').toString('base64')}`;

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    if (Date.now() > deadline) throw new Error('Expo web dev server did not come up in time');
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function main() {
  const { chromium } = await import('playwright');
  const env = {
    ...process.env,
    EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: '1',
    // Deliberately unreachable API host — every real network call the app
    // makes (besides the hung getToken() itself) should fail fast/offline,
    // never masking the timing this script measures.
    EXPO_PUBLIC_API_BASE_URL: 'https://api.brandthread.invalid',
    EXPO_PUBLIC_DOMAIN: 'api.brandthread.invalid',
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: DEMO_CLERK_KEY,
    EXPO_PUBLIC_CLERK_PROXY_URL: '',
    EXPO_PUBLIC_SENTRY_DSN: '',
    EXPO_PUBLIC_META_PIXEL_ID: '',
    EXPO_PUBLIC_TIKTOK_PIXEL_ID: '',
    CI: '1',
  };
  const child = spawn('pnpm', ['exec', 'expo', 'start', '--web', '--port', PORT], {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let failed = false;
  try {
    await waitForServer(`http://127.0.0.1:${PORT}`, 180_000);
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });
    await context.addInitScript((user) => {
      // Clerk stub whose getToken() NEVER resolves — reproduces the
      // reported hang (Clerk session-bootstrap/network stall) directly,
      // without needing a real flaky backend. Same shape as the repo's own
      // e2e/clerkStub.ts and tests/feed-video-plays.web.mjs use.
      const clerkUser = { id: user.id, primaryEmailAddress: { emailAddress: user.email } };
      const session = { id: 'sess_demo', user: clerkUser, getToken: () => new Promise(() => {}) };
      window.Clerk = {
        loaded: true, user: clerkUser, session,
        addListener: () => () => {}, load: async () => {},
        signOut: async () => {},
      };
      try {
        localStorage.setItem('bt:cookie-consent', JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }));
        localStorage.setItem('feed_gesture_guide_seen:user_jordan', '1');
        localStorage.setItem('feed_gesture_guide_seen:anon', '1');
      } catch {}
    }, { id: 'user_jordan', email: 'jordan@example.com' });

    const page = await context.newPage();
    const url = `http://127.0.0.1:${PORT}/(buyer)?bt_preview=buyer`;
    // First navigation on a cold Metro dev server pays a one-off bundle
    // compile cost (tens of seconds) unrelated to the bug being measured —
    // the bug report's own numbers were taken after a hard reload with the
    // bundle already warm. Load once to warm the bundle/cache, then do the
    // actual timed hard reload, matching the report's methodology.
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(500);

    const t0 = Date.now();
    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    const loadEventEnd = Date.now() - t0;
    console.log(`[black-screen-timing] hard-reload page load event at ${loadEventEnd}ms`);

    // Poll until the first feed item's poster (an <img> covering >=90% of
    // the viewport area, or a <video> similarly sized) is present and has
    // real decoded content.
    const deadlineMs = Number(process.env.FEED_BLACK_SCREEN_DEADLINE_MS || 20_000);
    const pollStart = Date.now();
    let paintedAtMs = null;
    while (Date.now() - pollStart < deadlineMs) {
      const result = await page.evaluate(() => {
        const viewportArea = window.innerWidth * window.innerHeight;
        const candidates = [...document.querySelectorAll('img, video')];
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const area = Math.max(0, rect.width) * Math.max(0, rect.height);
          if (area < viewportArea * 0.9) continue;
          if (el.tagName === 'IMG') {
            if (el.complete && el.naturalWidth > 0) return true;
          } else if (el.tagName === 'VIDEO') {
            if (el.readyState >= 2) return true;
          }
        }
        return false;
      });
      if (result) { paintedAtMs = Date.now() - t0; break; }
      await page.waitForTimeout(100);
    }

    if (paintedAtMs == null) {
      console.log(`[black-screen-timing] FAIL: no >=90%-viewport poster/video decoded within ${deadlineMs}ms of the hard reload (hanging getToken() case).`);
      failed = true;
    } else {
      console.log(`[black-screen-timing] first-poster-decoded at ${paintedAtMs}ms since reload start (bundle load ~${loadEventEnd}ms).`);
      if (paintedAtMs <= 2000) {
        console.log('[black-screen-timing] PASS: first poster decoded within 2000ms despite a permanently hung getToken().');
      } else {
        console.log(`[black-screen-timing] WARN: decoded, but after the 2000ms target (${paintedAtMs}ms).`);
      }
    }

    await browser.close();
  } catch (err) {
    failed = true;
    console.error('[black-screen-timing] ERROR:', err.message);
  } finally {
    child.kill('SIGTERM');
  }
  process.exit(failed ? 1 : 0);
}

main();
