/**
 * Plain character-count check (no measuring). Not what the feed renders with:
 * CaptionBlock's clamp and "… more" come from ./captionClamp.ts.
 */
export const CAPTION_LINES = 2;
export function captionNeedsMore(caption: string): boolean {
  return caption.length > 43 * CAPTION_LINES;
}
