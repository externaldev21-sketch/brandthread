/**
 * Carousel edge taps (Instagram): a single tap on the outer quarter of a
 * multi-photo post steps back / forward one photo; the middle keeps the
 * page's own tap (play / pause). Double-tap like is unaffected — the page
 * only acts on a single tap once the double-tap window has passed.
 */

/** Share of the page width, on each side, that counts as an edge. */
export const EDGE_TAP_FRACTION = 0.25;

/** -1 = left edge (previous), 1 = right edge (next), 0 = middle. */
export function edgeTapDirection(x: number, width: number, slideCount: number): -1 | 0 | 1 {
  if (slideCount < 2 || width <= 0 || !Number.isFinite(x)) return 0;
  if (x < width * EDGE_TAP_FRACTION) return -1;
  if (x > width * (1 - EDGE_TAP_FRACTION)) return 1;
  return 0;
}
