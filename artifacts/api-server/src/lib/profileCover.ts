/**
 * Profile cover video rules — pure, so they're unit-testable without ffmpeg,
 * object storage or a database.
 *
 * - A cover is at most 30 seconds (validated server-side on the probed
 *   duration of what was actually uploaded, after any requested trim).
 * - A cover can change at most once per 24 hours. Setting a cover and
 *   removing one BOTH count as a change, so "remove, then re-add" can't be
 *   used to cycle covers faster than once a day.
 */

export const COVER_MAX_SECONDS = 30;
/** Container durations are rarely exact; allow a few frames of slack. */
export const COVER_DURATION_TOLERANCE_SECONDS = 0.25;
export const COVER_SUGGESTED_TRIM_SECONDS = 20;
export const COVER_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COVER_MAX_UPLOAD_BYTES = 120 * 1024 * 1024;

export type CoverChangeCheck =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number; retryAfterHours: number; message: string };

/** Friendly copy for the 24h limit ("…again in 5 hours"). Always ≥ 1 hour. */
export function coverChangeMessage(retryAfterMs: number): string {
  const hours = Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000)));
  return `You can change your cover again in ${hours} hour${hours === 1 ? '' : 's'}`;
}

export function checkCoverChangeAllowed(lastChangedAt: Date | null | undefined, now: Date = new Date()): CoverChangeCheck {
  if (!lastChangedAt) return { allowed: true };
  const elapsed = now.getTime() - new Date(lastChangedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed >= COVER_CHANGE_WINDOW_MS) return { allowed: true };
  const retryAfterMs = COVER_CHANGE_WINDOW_MS - Math.max(0, elapsed);
  return {
    allowed: false,
    retryAfterMs,
    retryAfterHours: Math.max(1, Math.ceil(retryAfterMs / (60 * 60 * 1000))),
    message: coverChangeMessage(retryAfterMs),
  };
}

export type TrimRequest = { start: number; duration: number } | null;

/**
 * Parse an optional client trim (`trimStart`, `trimDuration` seconds). The
 * client shows a trim UI for clips over 30s; the server applies the trim and
 * then re-validates the result, so a client can never skip the limit.
 */
export function parseTrim(startRaw: unknown, durationRaw: unknown): TrimRequest | { error: string } {
  if (startRaw === undefined && durationRaw === undefined) return null;
  const start = Number(startRaw ?? 0);
  const duration = Number(durationRaw);
  if (!Number.isFinite(start) || start < 0) return { error: 'trimStart must be a non-negative number of seconds' };
  if (!Number.isFinite(duration) || duration <= 0) return { error: 'trimDuration must be a positive number of seconds' };
  if (duration > COVER_MAX_SECONDS + COVER_DURATION_TOLERANCE_SECONDS) {
    return { error: `Cover videos can be at most ${COVER_MAX_SECONDS} seconds` };
  }
  return { start, duration };
}

export function coverDurationError(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Could not read this video';
  if (seconds > COVER_MAX_SECONDS + COVER_DURATION_TOLERANCE_SECONDS) {
    return `Cover videos can be at most ${COVER_MAX_SECONDS} seconds — trim it and try again`;
  }
  return null;
}

/** Cover URLs are only exposed while the cover is visible (not moderated away). */
export function publicCoverFields(row: {
  coverVideoUrl?: string | null;
  coverPosterUrl?: string | null;
  coverVideoModerationStatus?: string | null;
}): { coverVideoUrl: string | null; coverPosterUrl: string | null } {
  const visible = (row.coverVideoModerationStatus ?? 'visible') === 'visible';
  return {
    coverVideoUrl: visible ? row.coverVideoUrl ?? null : null,
    coverPosterUrl: visible ? row.coverPosterUrl ?? null : null,
  };
}
