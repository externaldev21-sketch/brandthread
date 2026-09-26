/**
 * Smoke check: the buyer Threads Home feed's active video actually renders
 * at a real, non-zero size and plays on web — not just "the poster loaded".
 *
 * This exists because a real bug shipped where the sharp video wrapper
 * (`sharpClipStyle` in VideoVisual, app/(tabs)/feed.tsx) had no explicit
 * width/height and relied on `StyleSheet.absoluteFill` resolving against an
 * ancestor's height. Inside a virtualized FlatList cell on web that ancestor
 * can measure 0 height, so the whole video area silently collapsed to
 * `390x0` while the separately explicit-sized blurred tab-bar mirror strip
 * kept rendering fine — the exact "feed is all black, nothing plays"
 * symptom, distinct from (and more serious than) any headless-browser
 * codec/decode limitation.
 *
 * Boots the real Expo web dev server (so __DEV__ preview posts are
 * included), opens the buyer feed with the repo's demo Clerk stub, and
 * asserts on the active <video> element:
 *   1. clientHeight > 0 and clientWidth > 0 (the container-sizing bug)
 *   2. not `.paused` shortly after load (the play-effect-wiring bug)
 *   3. `.currentTime` advances over a short wait (it is actually playing,
 *      not just unpaused-but-stuck) — skipped, not failed, when the
 *      browser reports a decode error for the clip (a codec/environment
 *      limitation of the runner, not a product bug); set
 *      FEED_VIDEO_PLAYS_REQUIRED=1 to fail hard on that too.
 *
 * Usage:  node tests/feed-video-plays.web.mjs
 * Env:    FEED_VIDEO_PLAYS_REQUIRED=1  fail (not skip) if playback truly
 *         cannot be verified, e.g. in a CI runner known to support the
 *         codec.
 */
import { spawn } from 'node:child_process';

const PORT = process.env.FEED_VIDEO_PLAYS_PORT || '8171';
const REQUIRED = process.env.FEED_VIDEO_PLAYS_REQUIRED === '1';
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
    EXPO_PUBLIC_API_BASE_URL: 'https://api.brandthread.test',
    EXPO_PUBLIC_DOMAIN: 'api.brandthread.test',
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
      // Minimal inline Clerk stub — enough for useAuth()/Clerk.loaded to
      // report a signed-in demo account without a real Clerk script.
      const clerkUser = { id: user.id, primaryEmailAddress: { emailAddress: user.email } };
      const session = { id: 'sess_demo', user: clerkUser, getToken: async () => 'demo-token' };
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
    const decodeErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /NotSupportedError|no supported source/i.test(msg.text())) {
        decodeErrors.push(msg.text());
      }
    });

    await page.goto(`http://127.0.0.1:${PORT}/(buyer)?bt_preview=buyer`, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction(() => window.Clerk?.loaded === true, undefined, { timeout: 30_000 }).catch(() => {});
    await page.waitForSelector('video', { timeout: 30_000 });
    await page.waitForTimeout(2000);

    // 1) Container sizing — must not be the 390x0 collapse.
    const box = await page.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      const rect = v.getBoundingClientRect();
      return { width: rect.width, height: rect.height, paused: v.paused, hasError: !!v.error, readyState: v.readyState };
    });
    if (!box) throw new Error('No <video> element found on the buyer feed.');
    console.log('[feed-video-plays] active <video>:', box);
    if (box.height <= 0 || box.width <= 0) {
      throw new Error(`Video container collapsed: ${box.width}x${box.height} (expected a real, non-zero size).`);
    }

    // 2 & 3) Playback — tolerate a codec/decode failure as an environment
    // limitation (unless FEED_VIDEO_PLAYS_REQUIRED=1), but never tolerate a
    // correctly-sized, error-free video that simply never plays.
    const t0 = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const v = document.querySelector('video');
      return { currentTime: v?.currentTime ?? 0, paused: v?.paused ?? true, hasError: !!v?.error };
    });
    console.log('[feed-video-plays] after wait:', after, 'decodeErrors:', decodeErrors.length);

    if (after.hasError || decodeErrors.length > 0) {
      const msg = `Video reported a decode error in this runner (${decodeErrors[0] ?? 'video.error set'}) — container sizing is confirmed correct (${box.width}x${box.height}), which is the bug this check exists for; codec support is an environment limitation.`;
      if (REQUIRED) throw new Error(msg);
      console.log(`[feed-video-plays] SKIP (non-fatal): ${msg}`);
    } else if (after.paused || after.currentTime <= t0) {
      throw new Error(`Video is correctly sized (${box.width}x${box.height}) but never started playing (paused=${after.paused}, currentTime ${t0}->${after.currentTime}) — the play-effect wiring bug.`);
    } else {
      console.log('[feed-video-plays] PASS: video is sized, unpaused, and currentTime is advancing.');
    }

    await browser.close();
  } catch (err) {
    failed = true;
    console.error('[feed-video-plays] FAILED:', err.message);
  } finally {
    child.kill('SIGTERM');
  }
  process.exit(failed ? 1 : 0);
}

main();
