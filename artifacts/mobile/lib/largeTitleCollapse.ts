/**
 * Pure math for the large-title collapse (hooks/useLargeTitleCollapse.ts),
 * kept free of React Native imports so it can be unit tested directly.
 *
 * Apple HIG "Navigation bars → large titles" (iOS Settings / Mail): the big
 * title scrolls away 1:1 with the content, and once it has passed under the
 * bar a small centered title fades into the compact bar. Scrolling back
 * reverses it. Here the big title lives in the header row itself, so
 * "scrolls away" means it slides up out of its own clipped box by exactly
 * the scroll distance, until it has moved its own full height.
 *
 * `threshold` is the large title's measured height: the distance after which
 * it is fully gone. Pulling down past the top (negative offset) leaves the
 * header exactly as it is at rest.
 */

/** Used until the title has been measured: the 20pt header title's line box. */
export const DEFAULT_LARGE_TITLE_THRESHOLD = 24;

/** The compact title starts fading in once the large title is this far gone. */
export const COMPACT_TITLE_FADE_START = 0.5;

export interface CollapseRange {
  inputRange: [number, number];
  outputRange: [number, number];
  extrapolate: 'clamp';
}

export interface LargeTitleCollapseRanges {
  largeTitleTranslateY: CollapseRange;
  largeTitleOpacity: CollapseRange;
  compactTitleOpacity: CollapseRange;
}

/** Guards against a zero/NaN measurement (e.g. before layout on web). */
export function normalizeThreshold(threshold: number): number {
  return Number.isFinite(threshold) && threshold > 0 ? threshold : DEFAULT_LARGE_TITLE_THRESHOLD;
}

/** Interpolation ranges, in the shape `Animated.Value.interpolate` takes. */
export function largeTitleCollapseRanges(threshold: number): LargeTitleCollapseRanges {
  const t = normalizeThreshold(threshold);
  return {
    largeTitleTranslateY: { inputRange: [0, t], outputRange: [0, -t], extrapolate: 'clamp' },
    largeTitleOpacity: { inputRange: [0, t], outputRange: [1, 0], extrapolate: 'clamp' },
    compactTitleOpacity: { inputRange: [t * COMPACT_TITLE_FADE_START, t], outputRange: [0, 1], extrapolate: 'clamp' },
  };
}

function evalRange({ inputRange: [i0, i1], outputRange: [o0, o1] }: CollapseRange, y: number): number {
  if (y <= i0) return o0;
  if (y >= i1) return o1;
  return o0 + ((y - i0) / (i1 - i0)) * (o1 - o0);
}

/** The collapse state at scroll offset `y` — what the animated styles show. */
export function largeTitleCollapseAt(y: number, threshold: number) {
  const r = largeTitleCollapseRanges(threshold);
  return {
    largeTitleTranslateY: evalRange(r.largeTitleTranslateY, y),
    largeTitleOpacity: evalRange(r.largeTitleOpacity, y),
    compactTitleOpacity: evalRange(r.compactTitleOpacity, y),
    collapsed: y >= normalizeThreshold(threshold),
  };
}
