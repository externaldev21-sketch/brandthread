/**
 * Profile cover video rules — pure, so they're unit-testable without ffmpeg,
 * object storage or a database.
 *
 * - A cover is at most 10 seconds (the profile banner limit; validated server-side on the probed
 *   duration of what was actually uploaded, after any requested trim).
 * - A cover can change at most once per 24 hours. Setting a cover and
 *   removing one BOTH count as a change, so "remove, then re-add" can't be
 *   used to cycle covers faster than once a day.
 */

export const COVER_MAX_SECONDS = 10;
/** Container durations are rarely exact; allow a few frames of slack. */
export const COVER_DURATION_TOLERANCE_SECONDS = 0.25;
export const COVER_SUGGESTED_TRIM_SECONDS = 10;
export const COVER_CHANGE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const COVER_MAX_UPLOAD_BYTES = 120 * 1024 * 1024;
/** GIF banners are capped at ~15MB (converted server-side to a looping MP4). */
export const COVER_GIF_MAX_BYTES = 15 * 1024 * 1024;

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
 * client shows a trim screen for clips over 10s; the server applies the trim and
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

export type CropRequest = { x: number; y: number; width: number; height: number } | null;

/**
 * Parse an optional normalized (0–1) crop rect from the banner crop screen
 * (`cropX`, `cropY`, `cropW`, `cropH`). All four or none; the rect must sit
 * inside the source.
 */
export function parseCrop(xRaw: unknown, yRaw: unknown, wRaw: unknown, hRaw: unknown): CropRequest | { error: string } {
  if (xRaw === undefined && yRaw === undefined && wRaw === undefined && hRaw === undefined) return null;
  const [x, y, width, height] = [xRaw, yRaw, wRaw, hRaw].map((value) => Number(value));
  const finite = [x, y, width, height].every((value) => Number.isFinite(value));
  const EPS = 0.001;
  if (!finite || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 + EPS || y + height > 1 + EPS) {
    return { error: 'crop must be a normalized rect (cropX, cropY, cropW, cropH) inside the source' };
  }
  return { x, y, width: Math.min(width, 1 - x), height: Math.min(height, 1 - y) };
}

/**
 * `url` is what plays: the MP4 rendition (video, and GIFs that converted) or
 * the original GIF. `gifUrl` is a GIF banner's original file (fallback).
 */
export type ProfileBanner = { type: 'video' | 'gif'; url: string; posterUrl: string | null; gifUrl?: string | null };

/**
 * The profile banner a row carries, or null. Rows written before migration
 * 261 have no `coverMediaType`; a set `coverVideoUrl` means a video banner.
 */
export function profileBannerFromRow(row: {
  coverVideoUrl?: string | null;
  coverPosterUrl?: string | null;
  coverImageUrl?: string | null;
  coverMediaType?: string | null;
}): ProfileBanner | null {
  if (row.coverMediaType === 'gif') {
    const playable = row.coverVideoUrl ?? row.coverImageUrl ?? null;
    return playable
      ? { type: 'gif', url: playable, posterUrl: row.coverPosterUrl ?? null, gifUrl: row.coverImageUrl ?? null }
      : null;
  }
  return row.coverVideoUrl ? { type: 'video', url: row.coverVideoUrl, posterUrl: row.coverPosterUrl ?? null } : null;
}

/** Cover URLs are only exposed while the cover is visible (not moderated away). */
export function publicCoverFields(row: {
  coverVideoUrl?: string | null;
  coverPosterUrl?: string | null;
  coverImageUrl?: string | null;
  coverMediaType?: string | null;
  coverVideoModerationStatus?: string | null;
}): { coverVideoUrl: string | null; coverPosterUrl: string | null; profileBanner: ProfileBanner | null } {
  const visible = (row.coverVideoModerationStatus ?? 'visible') === 'visible';
  return {
    coverVideoUrl: visible ? row.coverVideoUrl ?? null : null,
    coverPosterUrl: visible ? row.coverPosterUrl ?? null : null,
    profileBanner: visible ? profileBannerFromRow(row) : null,
  };
}
