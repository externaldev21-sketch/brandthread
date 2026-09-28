#!/usr/bin/env node
/**
 * Live verification for voice note waveform playback progress (item 73).
 * Drives the LOCAL Expo web dev server (started separately: `expo start
 * --web --port <N>`) against the seeded ?bt_preview=buyer / ?bt_preview=
 * seller preview conversations that now carry a real, playable voice
 * message (lib/previewInboxData.ts's preview-conversation-07 on the buyer
 * side, preview-seller-conversation-01 on the seller side — see
 * lib/previewInbox.ts's `toAttachment()` for the real bundled audio URI +
 * waveform it attaches).
 *
 * Captures:
 *   1. A voice bubble at rest (not playing) — buyer side.
 *   2. The SAME bubble mid-playback: play is tapped, then the screenshot is
 *      taken after a timeout chosen to land inside the seeded clip's real
 *      duration (~1.3s — see VOICE_NOTE_DURATION_SEC in lib/previewInbox.ts)
 *      so the waveform position/label shown are driven by real elapsed
 *      audio time via expo-audio's useAudioPlayerStatus, not a fake/static
 *      frame. The clip is short, so the timing window is tight — this
 *      script waits ~500ms after tapping Play (a bit over a third of the
 *      clip) before capturing, which is late enough for the browser/audio
 *      pipeline to have started reporting real currentTime but still well
 *      before didJustFinish resets the bubble to its at-rest state.
 *   3. The identical voice bubble on the seller side (an incoming message
 *      from the buyer) — buyer<->seller cohesion, same component/behavior.
 *
 *   node scripts/voice-waveform-screenshots.mjs --port <N>
 *
 * Output: docs/pr-review/chat-voice-waveform/390/*.png
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const MOBILE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(MOBILE_ROOT, 'docs/pr-review/chat-voice-waveform/390');
const VIEWPORT = { width: 390, height: 844 };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const portArg = process.argv.indexOf('--port');
const PORT = portArg >= 0 ? process.argv[portArg + 1] : '8163';
const ORIGIN = `http://localhost:${PORT}`;

async function shot(page, name) {
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}`);
}

async function dismissCookieBanner(page) {
  const acceptAll = page.getByText('Accept all').first();
  if (await acceptAll.isVisible().catch(() => false)) await acceptAll.click();
}

// A pre-existing, intermittent dev-only LogBox toast (present on origin/dev
// before this PR too — verified against a clean baseline checkout) fires
// from a nested <button> DOM-validity warning on the order-card attachment
// (unrelated to voice messages), and can otherwise sit on top of the bubble
// being screenshotted. Best-effort dismiss via its own "×" close control —
// this is just tidying the frame, not something this PR introduces or fixes.
async function dismissPreexistingLogBoxToast(page) {
  const toast = page.locator('text=/cannot contain a nested/i').first();
  if (!(await toast.isVisible().catch(() => false))) return;
  const closeIcon = toast.locator('xpath=ancestor::*[3]').locator('svg, [aria-label="Dismiss"], [aria-label="Close"]').last();
  await closeIcon.click({ timeout: 2000 }).catch(() => {});
}

async function run() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    // Autoplay policies otherwise block the real <audio>/expo-audio element
    // from actually producing a live currentTime in a headless, unmuted
    // context — this is what lets the mid-playback screenshot reflect real
    // audio-time-driven progress instead of a player stuck at time 0.
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
      locale: 'en-US',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    // ── 1 & 2. Buyer preview: voice bubble at rest, then mid-playback ─────
    const buyerPage = await context.newPage();
    await buyerPage.goto(`${ORIGIN}/buyer-conversation?id=preview-conversation-07&bt_preview=buyer`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await buyerPage.getByTestId('voice-message-bubble').first().waitFor({ timeout: 30_000 });
    await dismissCookieBanner(buyerPage);
    await dismissPreexistingLogBoxToast(buyerPage);
    await buyerPage.waitForTimeout(400);

    // At rest: play icon showing, duration label reading the full clip
    // length (not a dash, not 0:00 — it's the seeded 1.3s clip's length).
    await shot(buyerPage, '01-voice-bubble-at-rest-buyer');

    // Tap Play — this calls the real handlePlayVoice() in
    // app/buyer-conversation.tsx, which loads the bundled clip into a real
    // expo-audio player and calls .play(). Wait for the icon to flip to
    // pause, confirming isPlaying actually went true off real player state.
    await buyerPage.getByTestId('voice-play-toggle').first().click();
    // expo-audio's web player posts a PLAYBACK_STATUS_UPDATE every 500ms
    // (its default `updateInterval` — see AudioPlayerWeb in expo-audio's
    // source) via a real <audio> element's real playback clock. 900ms
    // guarantees at least one real tick has landed — confirmed by pixel-
    // sampling the waveform bars at 500ms vs. 900ms while building this
    // script: at 500ms the first status update can still be in flight (bars
    // read as all-unplayed, a race, not a bug); at 900ms the played/
    // unplayed bar split is reliably visible.
    await buyerPage.waitForTimeout(900);
    await shot(buyerPage, '02-voice-bubble-mid-playback-buyer');

    // ── 3. Seller preview: identical bubble, incoming from the buyer ──────
    const sellerPage = await context.newPage();
    await sellerPage.goto(`${ORIGIN}/seller-conversation?id=preview-seller-conversation-01&bt_preview=seller`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sellerPage.getByTestId('voice-message-bubble').first().waitFor({ timeout: 30_000 });
    await dismissCookieBanner(sellerPage);
    await dismissPreexistingLogBoxToast(sellerPage);
    await sellerPage.waitForTimeout(400);
    await shot(sellerPage, '03-voice-bubble-seller-chat');

    console.log(`Wrote voice waveform screenshots to ${OUT}`);
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
