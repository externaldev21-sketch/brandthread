/**
 * Final-size layout for feed / profile / grid media, computed synchronously
 * from the pixel sizes the API stores for every post (api-server
 * lib/mediaDimensions). Nothing here waits for an image `onLoad`, a video
 * track or an `onLayout`: the first frame is already the final frame, so a
 * slideshow never paints "big" and then snaps to its real size.
 */
export interface Dims { width: number; height: number }

const RATIO_VALUE: Record<string, number> = { '9:16': 9 / 16, '4:5': 4 / 5, '3:4': 3 / 4, '1:1': 1 };
/** Same tolerance the feed video uses: crop ≤30% of the frame → cover, else letterbox. */
export const FULL_PAGE_COVER_CROP_THRESHOLD = 0.3;

export function aspectOf(d: Partial<Dims> | null | undefined): number | null {
  const w = Number(d?.width);
  const h = Number(d?.height);
  return w > 0 && h > 0 && Number.isFinite(w / h) ? w / h : null;
}

export function ratioValue(ratio: string | null | undefined): number | null {
  return ratio ? RATIO_VALUE[ratio] ?? null : null;
}

const warned = new Set<string>();
/** Logged once per post: a missing size means the backfill hasn't reached it. */
export function logMissingDims(postId: string, what: string): void {
  const key = `${postId}:${what}`;
  if (warned.has(key)) return;
  warned.add(key);
  if (warned.size > 500) warned.clear();
  // eslint-disable-next-line no-console
  console.warn(`[media] ${what} for post ${postId} has no stored dimensions; using fallback ratio`);
}

/**
 * The aspect to lay a media item out at: its stored size, else the post's
 * declared ratio, else the given default — logging whenever it had to guess.
 */
export function resolveAspect(
  dims: Partial<Dims> | null | undefined,
  opts: { postId: string; what: string; ratio?: string | null; fallback?: number },
): number {
  const known = aspectOf(dims);
  if (known) return known;
  logMissingDims(opts.postId, opts.what);
  return ratioValue(opts.ratio) ?? opts.fallback ?? 9 / 16;
}

/** cover when filling the page crops little, contain (letterbox) otherwise. */
export function fitForPage(mediaAspect: number, pageWidth: number, pageHeight: number): 'cover' | 'contain' {
  if (!(pageWidth > 0) || !(pageHeight > 0)) return 'contain';
  const page = pageWidth / pageHeight;
  const crop = 1 - Math.min(mediaAspect, page) / Math.max(mediaAspect, page);
  return crop <= FULL_PAGE_COVER_CROP_THRESHOLD ? 'cover' : 'contain';
}

/** The exact on-screen box for media of `aspect` letterboxed inside the page. */
export function containRect(aspect: number, pageWidth: number, pageHeight: number): { left: number; top: number; width: number; height: number } {
  if (!(aspect > 0) || !(pageWidth > 0) || !(pageHeight > 0)) return { left: 0, top: 0, width: pageWidth, height: pageHeight };
  let width = pageWidth;
  let height = pageWidth / aspect;
  if (height > pageHeight) { height = pageHeight; width = pageHeight * aspect; }
  width = Math.round(width);
  height = Math.round(height);
  return { left: Math.round((pageWidth - width) / 2), top: Math.round((pageHeight - height) / 2), width, height };
}

export const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const dimsOrNull = (w: unknown, h: unknown) => (isPosInt(w) && isPosInt(h) ? { width: w, height: h } : null);

/**
 * Server-measured sizes (api-server lib/mediaDimensions) aligned with
 * `mediaUris`: carousel slides carry their own, slideshows use
 * `mediaDimensions`, a single video/photo uses mediaWidth/mediaHeight.
 */
export function mapMediaDims(p: any, mediaUris: string[]): {
  mediaDims: Array<{ width: number; height: number } | null>;
  posterDims: { width: number; height: number } | null;
} {
  const slides = Array.isArray(p?.slides) ? p.slides : [];
  const list = Array.isArray(p?.mediaDimensions) ? p.mediaDimensions : [];
  const primary = dimsOrNull(p?.mediaWidth, p?.mediaHeight);
  const mediaDims = mediaUris.map((_, i) => {
    const s = slides[i];
    if (s) return dimsOrNull(s.width, s.height);
    const d = list[i];
    if (d) return dimsOrNull(d.width, d.height);
    return i === 0 ? primary : null;
  });
  return { mediaDims, posterDims: dimsOrNull(p?.thumbnailWidth, p?.thumbnailHeight) ?? primary };
}
