/**
 * Where a post lives and how many slides it may carry. ONE place, keyed by
 * surface — keep in sync with artifacts/mobile/constants/postLimits.ts (the
 * client mirror that drives the picker's "Select up to N" copy).
 *
 *   thread  — the public Threads feed. Sellers only (product videos/slideshows).
 *   profile — "POST": the author's own profile grid. Sellers and buyers.
 */
export const POST_SURFACES = ["thread", "profile"] as const;
export type PostSurface = (typeof POST_SURFACES)[number];

export const MAX_SLIDES_BY_SURFACE: Record<PostSurface, number> = {
  thread: 30,
  profile: 14,
};

export function isPostSurface(value: unknown): value is PostSurface {
  return typeof value === "string" && (POST_SURFACES as readonly string[]).includes(value);
}

/** POST (profile surface) carousels render at a fixed 3:4 canvas. */
export const CAROUSEL_CANVAS = { w: 1080, h: 1440 } as const;
/** A carousel may contain this much trimmed video in total (matches compose-video's ceiling). */
export const MAX_CAROUSEL_VIDEO_SECONDS = 600;
