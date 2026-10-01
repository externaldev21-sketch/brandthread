/**
 * Create flow: destination modes, who sees which, and slide caps — ONE place.
 * Changing a cap is a one-line edit here (the picker copy, the hard block on
 * the N+1th photo and the edit screen all read it). Keep the numbers in sync
 * with the server's artifacts/api-server/src/lib/postLimits.ts, which is what
 * actually rejects an oversized upload.
 */
export type CreateMode = 'story' | 'thread' | 'post' | 'live';
/** Modes that carry media through gallery → edit → post screen. */
export type PostMode = Extract<CreateMode, 'thread' | 'post'>;

/** Max photos in one slideshow, keyed by destination. */
export const MAX_SLIDES_BY_MODE: Record<PostMode, number> = {
  thread: 30,
  post: 14,
};

/** POST is an Instagram-style carousel: photos AND videos mixed. THREAD slideshows are photos only. */
export const ALLOWS_MIXED_MEDIA: Record<PostMode, boolean> = { thread: false, post: true };

/** Longest video we accept, in seconds (uploaded chunked, trimmed on the edit screen). */
export const MAX_VIDEO_SECONDS = 600;

/** Bottom mode bar, left → right. LIVE is seller-only (Go Live exists for sellers). */
export const CREATE_MODES_BY_ROLE: Record<'seller' | 'buyer', CreateMode[]> = {
  seller: ['story', 'thread', 'post', 'live'],
  buyer: ['story', 'post'],
};

/** Where each role lands when the flow opens without an explicit `?mode=`. */
export const DEFAULT_CREATE_MODE: Record<'seller' | 'buyer', CreateMode> = {
  seller: 'thread',
  buyer: 'post',
};

export const MODE_LABEL: Record<CreateMode, string> = {
  story: 'STORY',
  thread: 'THREAD',
  post: 'POST',
  live: 'LIVE',
};

/** Server `posts.surface` value for a mode. Buyers can never use 'thread'. */
export const SURFACE_BY_MODE: Record<PostMode, 'thread' | 'profile'> = {
  thread: 'thread',
  post: 'profile',
};

export const CAPTURE_DURATIONS = [
  { id: '10s', label: '10s', seconds: 10 },
  { id: '15s', label: '15s', seconds: 15 },
  { id: '30s', label: '30s', seconds: 30 },
  { id: '1m', label: '1m', seconds: 60 },
  { id: '10m', label: '10m', seconds: MAX_VIDEO_SECONDS },
] as const;

export const POST_ASPECTS = ['1:1', '3:4', '9:16'] as const;
export type PostAspect = (typeof POST_ASPECTS)[number];
/** Ratios offered per destination. POST is always 3:4 (no picker). */
export const ASPECTS_BY_MODE: Record<PostMode, readonly PostAspect[]> = {
  thread: POST_ASPECTS,
  post: ['3:4'],
};
export const ASPECT_RATIO_VALUE: Record<PostAspect, number> = { '1:1': 1, '3:4': 3 / 4, '9:16': 9 / 16 };
export const DEFAULT_SLIDE_ASPECT: PostAspect = '3:4';
