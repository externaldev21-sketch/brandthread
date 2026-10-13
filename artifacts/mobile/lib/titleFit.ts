/**
 * Shrink-to-fit for single-line titles (ScreenHeader). Mirrors UIKit's
 * adjustsFontSizeToFit on navigation titles: a title that fits keeps its
 * size; one that doesn't shrinks just enough to fit, never below
 * `minScale` — past that it truncates with an ellipsis as before.
 */
export const TITLE_MIN_SCALE = 0.78;

export function titleFitScale(available: number, natural: number, minScale = TITLE_MIN_SCALE): number {
  if (!(available > 0) || !(natural > 0) || natural <= available) return 1;
  // 1px slack so sub-pixel rounding doesn't leave an ellipsis on a title
  // that fits exactly.
  return Math.max(minScale, Math.floor(((available - 1) / natural) * 1000) / 1000);
}
