/** Native text measurement remains authoritative; this is the first-paint fallback. */
export const CAPTION_LINES = 2;
export function captionNeedsMore(caption: string): boolean {
  return caption.length > 43 * CAPTION_LINES;
}
