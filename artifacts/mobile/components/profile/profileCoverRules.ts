/**
 * Profile cover video — client-side rules (pure; the server re-enforces the
 * limits, these only shape the UI).
 */

export const COVER_MAX_SECONDS = 30;
export const COVER_SUGGESTED_TRIM_SECONDS = 20;
export const COVER_TRIM_LENGTHS = [10, 15, 20, 30] as const;

/** The coach mark shows once: own profile, server says unseen, no cover yet. */
export function shouldShowCoverCoachmark({
  own,
  status,
  dismissedLocally,
}: {
  own: boolean;
  status: { seen: boolean; hasCover: boolean } | null;
  dismissedLocally: boolean;
}): boolean {
  if (!own || !status || dismissedLocally) return false;
  return !status.seen && !status.hasCover;
}

/** A clip over 30s needs trimming; the suggested window is the first 20s. */
export function needsTrim(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === 'number' && durationSeconds > COVER_MAX_SECONDS + 0.25;
}

export function defaultTrim(durationSeconds: number): { start: number; duration: number } {
  return { start: 0, duration: Math.min(COVER_SUGGESTED_TRIM_SECONDS, durationSeconds) };
}

/** Keep a trim window inside the clip. */
export function clampTrim(start: number, duration: number, total: number): { start: number; duration: number } {
  const length = Math.max(1, Math.min(duration, COVER_MAX_SECONDS, total));
  const maxStart = Math.max(0, total - length);
  return { start: Math.min(Math.max(0, start), maxStart), duration: length };
}

/** expo-image-picker reports duration in milliseconds (null when unknown). */
export function pickerDurationSeconds(duration: number | null | undefined): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
  return duration / 1000;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
