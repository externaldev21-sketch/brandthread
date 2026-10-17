/**
 * The feed caption's 2-line clamp, decided from the text alone (no
 * measuring), so every post — video, slideshow or photo — gets the same
 * clamp and "… more" (components/buyer-feed/CaptionBlock.tsx).
 */
/** ~42 characters fit one line of the block at 390pt wide (14pt text). */
const CAPTION_LINE_CHARS = 42;
const MORE_SUFFIX_CHARS = 7; // "… more"

/** Same rule for every post (video, slideshow, photo): clamp to 2 lines and
 *  offer "more" whenever the caption can run past them. */
export function captionNeedsMore(caption: string): boolean {
  const lines = caption.split('\n');
  const wrapped = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / CAPTION_LINE_CHARS)), 0);
  return wrapped > 2;
}

/** The collapsed text: what fits in 2 lines with room left for "… more" at
 *  the end of the second, decided from the text alone (no measuring). */
export function clampCaption(caption: string): string {
  const [first = '', second = ''] = caption.split('\n');
  const budget = CAPTION_LINE_CHARS * 2 - MORE_SUFFIX_CHARS;
  const text = first.length >= CAPTION_LINE_CHARS || !second
    ? caption.replace(/\s+/g, ' ')
    : `${first}\n${second}`;
  if (text.length <= budget) return text.trimEnd();
  const cut = text.slice(0, budget);
  const lastSpace = cut.lastIndexOf(' ');
  // Trailing punctuation would read as "times.… more".
  return (lastSpace > budget * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?…-]+$/, '');
}
