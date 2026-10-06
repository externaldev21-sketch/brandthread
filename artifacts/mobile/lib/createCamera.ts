/**
 * Pure helpers for the camera-first Create screen
 * (components/create-post/CreateCamera.tsx). Kept free of React/native
 * imports so the mode/duration/timer/progress rules are unit-testable.
 */

/** What the capture becomes. `thread` and `post` continue into the existing
 *  create-post editor; `story` hands off to the story composer. */
export type CreateMode = 'thread' | 'post' | 'story';

/** Shutter mode chips, TikTok order (longest first, Photo last). */
export type CaptureChip = '10m' | '60s' | '30s' | '15s' | 'photo';

export const CAPTURE_CHIPS: readonly CaptureChip[] = ['10m', '60s', '30s', '15s', 'photo'] as const;

export const CHIP_LABELS: Record<CaptureChip, string> = {
  '10m': '10m',
  '60s': '60s',
  '30s': '30s',
  '15s': '15s',
  photo: 'Photo',
};

/** Seconds a video chip allows; 0 for the photo chip. */
export const CHIP_SECONDS: Record<CaptureChip, number> = {
  '10m': 600,
  '60s': 60,
  '30s': 30,
  '15s': 15,
  photo: 0,
};

/** Default chip when the screen opens (TikTok's default is 15s; Instagram's
 *  Reel default is 15s too). */
export const DEFAULT_CHIP: CaptureChip = '15s';

export type TimerSetting = 0 | 3 | 10;

/** Off → 3s → 10s → off. */
export function nextTimerSetting(current: TimerSetting): TimerSetting {
  if (current === 0) return 3;
  if (current === 3) return 10;
  return 0;
}

/** Dropdown options for the "Thread ⌄" title. Buyers never see Thread. */
export function createModeOptions(isBuyer: boolean): readonly CreateMode[] {
  return isBuyer ? ['post', 'story'] : ['thread', 'post', 'story'];
}

export const CREATE_MODE_LABELS: Record<CreateMode, string> = {
  thread: 'Thread',
  post: 'Post',
  story: 'Story',
};

/** Chips a mode offers. A Post is photos only (Instagram "POST"); Thread and
 *  Story record video or snap a photo. */
export function chipsForMode(mode: CreateMode): readonly CaptureChip[] {
  return mode === 'post' ? ['photo'] : CAPTURE_CHIPS;
}

/** Keeps the selected chip valid when the mode changes. */
export function coerceChipForMode(chip: CaptureChip, mode: CreateMode): CaptureChip {
  const allowed = chipsForMode(mode);
  return allowed.includes(chip) ? chip : allowed[0];
}

/** 0..1 fill of the progress ring for an elapsed recording. */
export function recordingProgress(elapsedSeconds: number, chip: CaptureChip): number {
  const max = CHIP_SECONDS[chip];
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedSeconds / max));
}

/** True once the recording has reached the chip's max length. */
export function shouldAutoStop(elapsedSeconds: number, chip: CaptureChip): boolean {
  const max = CHIP_SECONDS[chip];
  return max > 0 && elapsedSeconds >= max;
}

/** `mm:ss` readout for the recording indicator. */
export function formatRecordingTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Index of the chip nearest a horizontal scroll offset, for the swipeable
 *  chip row (each chip is `chipWidth` wide; offset 0 centers chip 0). */
export function nearestChipIndex(offsetX: number, chipWidth: number, count: number): number {
  if (chipWidth <= 0 || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / chipWidth)));
}
