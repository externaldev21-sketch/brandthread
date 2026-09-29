/**
 * Avatar video (moving profile picture) rules — pure, so they're
 * unit-testable without ffmpeg, object storage or a database.
 *
 * - An avatar video is at most 10 seconds (validated server-side on the
 *   probed duration of what was actually uploaded). Unlike the profile
 *   cover video, there is no trim endpoint: a clip over the limit is
 *   rejected outright with a clear message, and the client is expected to
 *   check `asset.duration` itself before ever starting the upload.
 * - No once-per-24h change limit (unlike the cover video) — swapping an
 *   avatar video is expected to be as cheap as swapping an avatar photo.
 */

export const AVATAR_VIDEO_MAX_SECONDS = 10;
/** Container durations are rarely exact; allow a few frames of slack. */
export const AVATAR_VIDEO_DURATION_TOLERANCE_SECONDS = 0.25;
export const AVATAR_VIDEO_MAX_UPLOAD_BYTES = 40 * 1024 * 1024;

export function avatarVideoDurationError(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Could not read this video';
  if (seconds > AVATAR_VIDEO_MAX_SECONDS + AVATAR_VIDEO_DURATION_TOLERANCE_SECONDS) {
    return `Avatar videos can be at most ${AVATAR_VIDEO_MAX_SECONDS} seconds — trim it and try again`;
  }
  return null;
}
