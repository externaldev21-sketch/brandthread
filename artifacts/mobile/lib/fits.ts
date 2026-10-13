/** Pure helpers for Fits screens (stitch, fit checks, repost requests). No RN imports. */

/** TikTok Stitch uses up to 5 seconds of the original. */
export const STITCH_CLIP_MS = 5_000;

/** Display name for a post author: @username, else brand / display name. */
export function authorLabel(author: { username?: string | null; brandName?: string | null; displayName?: string | null } | null | undefined): string {
  if (!author) return '';
  if (author.username) return `@${author.username}`;
  return author.brandName || author.displayName || '';
}

/** TikTok pre-fills the caption with "#stitch with @user". */
export function stitchCaptionPrefix(author: Parameters<typeof authorLabel>[0]): string {
  const who = authorLabel(author);
  return who ? `#stitch with ${who} ` : '#stitch ';
}

/**
 * Clip window for a tap/drag at `fraction` (0..1) along the original's
 * timeline: centred on the touch, `STITCH_CLIP_MS` long, clamped inside.
 */
export function clipWindowAt(fraction: number, durationMs: number, clipMs = STITCH_CLIP_MS): { startMs: number; endMs: number } {
  const total = Math.max(0, Math.round(durationMs));
  const len = Math.min(clipMs, total);
  if (total === 0) return { startMs: 0, endMs: 0 };
  const f = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const centre = f * total;
  const start = Math.round(Math.min(Math.max(0, centre - len / 2), total - len));
  return { startMs: start, endMs: start + len };
}

export function formatClipTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Route that opens the stitch flow for a post. */
export function stitchHref(postId: string): string {
  return `/stitch-post?postId=${encodeURIComponent(postId)}`;
}

export function fitsErrorMessage(err: unknown, fallback: string): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'REPOSTS_DISABLED': return 'The author turned off reposts for this post.';
    case 'STITCH_SOURCE_UNAVAILABLE': return 'This post is no longer available to stitch.';
    case 'REPOST_PERMISSION_REQUIRED': return 'Ask for permission to repost this post.';
    case 'NOT_PURCHASED': return 'You can link a fit check to something you bought.';
    case 'REQUEST_DECLINED': return 'They declined this request.';
    case 'NOT_A_BUYER_POST': return 'Repost requests are for buyer posts.';
    case 'ALREADY_APPROVED': return 'Already approved.';
    case 'NOT_PENDING': return 'This request was already answered.';
    case 'CONTENT_REJECTED': return 'This caption can’t be posted. Edit it and try again.';
    default: return fallback;
  }
}
