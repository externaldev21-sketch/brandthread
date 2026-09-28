/**
 * Pure math behind a voice-message bubble's waveform playback progress
 * (item 73) — extracted out of components/chat/VoiceMessageBubble.tsx so it
 * can be unit tested directly (no react-native/expo-* imports here, same
 * "pure data module" pattern lib/previewInboxData.ts and lib/chatGrouping.ts
 * already use).
 *
 * The bubble itself never runs a timer of its own: `progress` is derived
 * every render from the real `expo-audio` player's live
 * `currentTime / duration` (see app/buyer-conversation.tsx and
 * app/seller-conversation.tsx's `handlePlayVoice`/`voicePlayerStatus`), so
 * these are pure functions of that real, audio-time-driven fraction — never
 * a fake clock.
 */

/** Clamps a playthrough fraction to the valid `[0, 1]` range — a player can
 *  briefly report `currentTime` a hair past `duration` right before
 *  `didJustFinish` fires, or `NaN`/negative values before playback starts. */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

/**
 * Given a 0..1 playthrough fraction and the total number of waveform bars,
 * returns how many bars (from the left) count as "played" — those render in
 * the brighter/"played" color, the rest in the dim/"unplayed" one. This is
 * the whole visual position indicator: no separate playhead dot, matching
 * this app's monochrome bar-fill treatment (the closer of the two Mobbin
 * references' visual language — see the component's doc comment).
 */
export function playedBarCount(progress: number, totalBars: number): number {
  if (totalBars <= 0) return 0;
  return Math.round(clampProgress(progress) * totalBars);
}

/** Whether waveform bar index `i` (0-based, left to right) should render in
 *  the "played" color for a given playthrough fraction. */
export function isBarPlayed(index: number, progress: number, totalBars: number): boolean {
  return index < playedBarCount(progress, totalBars);
}

/** Formats a seconds value as `m:ss` (no leading zero on minutes, matching
 *  the durations Instagram/WhatsApp voice bubbles show, e.g. "0:08"). */
export function formatVoiceClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const mm = Math.floor(whole / 60);
  const ss = String(whole % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** The label shown next to the waveform: counts DOWN from the full duration
 *  as playback advances (WhatsApp's "remaining time" treatment — the closer
 *  match for "playback progress" per this item's Mobbin research), landing
 *  on `0:00` exactly as the clip finishes rather than a hair before/after. */
export function remainingTimeLabel(durationSec: number, progress: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '0:00';
  const remaining = durationSec * (1 - clampProgress(progress));
  return formatVoiceClock(remaining);
}
