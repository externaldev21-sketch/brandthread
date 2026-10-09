import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Geometry for the floating tab bars — buyer and seller share it.
 *
 * Everything the bars, the search morph and the screens behind the bars need
 * is derived from one pure function so the numbers can never drift apart:
 * both bars size themselves from these values, and every screen that scrolls
 * under a bar pads its content by `occupiedHeight`.
 *
 * The bars are icon-only. The whole bar — side circles plus capsule — spans
 * nearly the full screen width (a ~16pt margin each side), like a wide
 * Instagram-style capsule, rather than a compact pill sized to its content.
 * The capsule's own width is what's left after its side circles, so the
 * buyer bar (capsule + Profile circle) and the seller bar (Studio circle +
 * capsule + AI circle) both reach the same outer margins and read as one
 * app, even though the seller capsule is narrower to make room for its
 * second circle. iPad gets its own larger, centred proportions capped at a
 * comfortable max width instead of a bar stretched to a huge screen.
 */

export const BUYER_TAB_SLOT_COUNT = 4;
export const TAB_SLOT_COUNT = BUYER_TAB_SLOT_COUNT;

export type BuyerTabBarSizeClass = 'mini' | 'compact' | 'regular' | 'large' | 'tablet';

/**
 * Bar display mode — separate from `BuyerTabBarSizeClass` above (which
 * classifies the *device's* width). `regular` is the bar exactly as shipped
 * in #210/#212 on every screen. `compact` is the Instagram iOS 26-style
 * condensed capsule shown only over the buyer feed's full-bleed video (see
 * BuyerTabBar): both the capsule and the separate Profile circle shrink and
 * are pulled closer together, matching the spirit of Instagram's single
 * compact capsule within this app's two-piece (capsule + circle) layout.
 */
export type BuyerTabBarMode = 'regular' | 'compact';

// Instagram iOS 26's own reels-tab capsule measures ~42pt tall vs. ~51pt tall
// on every other tab, and ~75% vs ~90% of screen width — a ~0.82-0.83 scale
// in both height and width. This app's layout differs (a capsule *plus* a
// separate side circle, not one merged shape), so rather than copying exact
// point values these ratios are applied to whatever this device's own
// regular-mode numbers already are, and the gap between the capsule and the
// circle is pulled in further so the pair still reads as one compact unit.
const COMPACT_HEIGHT_SCALE = 42 / 51;
const COMPACT_WIDTH_SCALE = 75 / 90;
const COMPACT_GAP_SCALE = 0.5;
/** Icons shrink less than the capsule itself ("slightly smaller", not tiny). */
export const COMPACT_ICON_SCALE = 0.88;
/** Stroke-width compensation so a smaller icon keeps the same visual weight
 *  instead of reading thin — applied to the icon's authored stroke width,
 *  independent of the animated size-scale transform above. */
export const COMPACT_ICON_STROKE_SCALE = 1 / COMPACT_ICON_SCALE;

export type BuyerTabBarMetrics = {
  sizeClass: BuyerTabBarSizeClass;
  isTablet: boolean;
  /** Width of one tab slot in the capsule. */
  itemWidth: number;
  /** Inner horizontal padding between the capsule edge and the first slot. */
  capsulePadding: number;
  capsuleHeight: number;
  /** Capsule width in its normal (tabs) state. */
  capsuleWidth: number;
  /** Capsule width while search is open. */
  searchCapsuleWidth: number;
  /** Diameter of the side circles (Profile/Close, Studio, AI). Matches the capsule height. */
  circleSize: number;
  /** Space between the capsule and a circle. */
  gap: number;
  /** Distance from the bottom of the screen to the bottom of the bar. */
  bottomOffset: number;
  /** Height of the inline search field inside the capsule. */
  fieldHeight: number;
  /** Gap kept between the bar and the top of the keyboard in search mode. */
  keyboardGap: number;
  iconSize: number;
  /** Size of the active-tab pill that glides behind the icons. */
  indicatorWidth: number;
  indicatorHeight: number;
  /**
   * How much of the bottom of the screen the bar covers, including the home
   * indicator area and breathing room. Screens behind the bar pad by this.
   */
  occupiedHeight: number;
  /**
   * Distance from the bottom of the screen to the bar's own TOP edge
   * (`bottomOffset + capsuleHeight`) — no extra breathing room added, unlike
   * `occupiedHeight`. This is "the line" a Reels/TikTok-style immersive
   * video frame stops at: the sharp video's bottom edge and this value's
   * screen-space y both land on the bar's real top pixel, not the padded
   * clearance above it that `occupiedHeight` gives ordinary scrolling
   * content.
   */
  barTopInset: number;
};

export type TabBarMetrics = BuyerTabBarMetrics;

type MetricsInput = {
  width: number;
  height: number;
  bottomInset: number;
  /** Circles beside the capsule: buyer has Profile (1), seller has Studio + AI (2). */
  sideCircleCount?: number;
  /** 'regular' (default) — pixel-identical to #210/#212. 'compact' condenses
   *  the capsule + circle for a full-bleed video tab (see BuyerTabBarMode). */
  mode?: BuyerTabBarMode;
};

const CONTENT_CLEARANCE = 12;
/** Outer gap from the screen edge to the bar, on phones — the Instagram-style margin. */
const PHONE_SIDE_MARGIN = 16;
/** iPad keeps a comfortable, centred bar instead of stretching across a huge screen. */
const TABLET_MAX_BAR_WIDTH = 560;

export function getBuyerTabBarMetrics({ width, height, bottomInset, sideCircleCount = 1, mode = 'regular' }: MetricsInput): BuyerTabBarMetrics {
  const shortestSide = Math.min(width, height);
  // Split-view iPads narrower than a phone keep phone proportions.
  const isTablet = shortestSide >= 600 && width >= 600;
  const sizeClass: BuyerTabBarSizeClass = isTablet
    ? 'tablet'
    : width < 350
      ? 'mini'
      : width < 380
        ? 'compact'
        : width < 420
          ? 'regular'
          : 'large';

  const capsuleHeight = { mini: 52, compact: 56, regular: 58, large: 60, tablet: 64 }[sizeClass];
  const capsulePadding = 5;
  const gap = isTablet ? 14 : sizeClass === 'mini' ? 6 : 10;
  const circleSize = capsuleHeight;

  // The whole bar (capsule + its side circles) spans nearly the full screen
  // width instead of a compact centered pill; the capsule's own width is
  // whatever is left after its side circles, so its slots spread out evenly
  // to fill it edge to edge. The narrowest phones (sub-350pt, e.g. a
  // split-view iPad) get a smaller margin so two side circles plus a capsule
  // can still keep every control at or above the 44pt minimum.
  const sideMargin = isTablet
    ? Math.max((width - TABLET_MAX_BAR_WIDTH) / 2, 48)
    : sizeClass === 'mini' ? 6 : PHONE_SIDE_MARGIN;
  const barWidth = isTablet ? Math.min(width - sideMargin * 2, TABLET_MAX_BAR_WIDTH) : width - sideMargin * 2;
  const capsuleWidth = barWidth - (circleSize + gap) * sideCircleCount;
  const itemWidth = (capsuleWidth - capsulePadding * 2) / BUYER_TAB_SLOT_COUNT;

  // The capsule is already near its full-width max, so search no longer needs
  // to grow it — it just uses the ample room already inside the wide capsule.
  const searchCapsuleWidth = capsuleWidth;

  const bottomOffset = isTablet
    ? Math.max(bottomInset, 20)
    : Math.max(bottomInset - 10, 12);

  const regular: BuyerTabBarMetrics = {
    sizeClass,
    isTablet,
    itemWidth,
    capsulePadding,
    capsuleHeight,
    capsuleWidth,
    searchCapsuleWidth,
    circleSize,
    gap,
    bottomOffset,
    fieldHeight: capsuleHeight - (isTablet ? 12 : sizeClass === 'mini' ? 8 : 10),
    keyboardGap: 8,
    iconSize: isTablet ? 27 : 25,
    // A soft rounded pill roughly the size of a touch target, not a slot-wide
    // bar, so it reads like the reference's active pill rather than a segment.
    indicatorWidth: Math.min(itemWidth - 8, 64),
    indicatorHeight: capsuleHeight - capsulePadding * 2,
    occupiedHeight: bottomOffset + capsuleHeight + CONTENT_CLEARANCE,
    barTopInset: bottomOffset + capsuleHeight,
  };

  return mode === 'compact' ? applyCompactMode(regular) : regular;
}

/**
 * Condenses a regular-mode metrics object into the compact, Instagram
 * iOS 26-style capsule shown over the buyer feed's full-bleed video. Derived
 * from the regular metrics (not recomputed from scratch) so it can never
 * drift from whatever this device's own regular sizing already is.
 */
function applyCompactMode(regular: BuyerTabBarMetrics): BuyerTabBarMetrics {
  const capsuleHeight = regular.capsuleHeight * COMPACT_HEIGHT_SCALE;
  const circleSize = capsuleHeight;
  const gap = regular.gap * COMPACT_GAP_SCALE;
  const capsuleWidth = regular.capsuleWidth * COMPACT_WIDTH_SCALE;
  const itemWidth = (capsuleWidth - regular.capsulePadding * 2) / BUYER_TAB_SLOT_COUNT;
  const indicatorHeight = capsuleHeight - regular.capsulePadding * 2;
  const indicatorWidth = Math.min(itemWidth - 8, 64 * COMPACT_HEIGHT_SCALE);
  const barTopInset = regular.bottomOffset + capsuleHeight;

  return {
    ...regular,
    capsuleHeight,
    capsuleWidth,
    circleSize,
    gap,
    itemWidth,
    indicatorWidth,
    indicatorHeight,
    barTopInset,
    occupiedHeight: regular.bottomOffset + capsuleHeight + CONTENT_CLEARANCE,
  };
}

export const getTabBarMetrics = getBuyerTabBarMetrics;

export function useBuyerTabBarMetrics(sideCircleCount = 1, mode: BuyerTabBarMode = 'regular'): BuyerTabBarMetrics {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return getBuyerTabBarMetrics({ width, height, bottomInset: insets.bottom, sideCircleCount, mode });
}

export const useTabBarMetrics = useBuyerTabBarMetrics;

/**
 * Bottom padding for any buyer screen that renders behind the floating bar.
 * Use it for scroll content `paddingBottom` and for bottom-anchored overlays so
 * nothing is hidden under the bar or the home indicator. Defaults to
 * 'regular' — every existing call site keeps its exact pre-compact-mode
 * value; only the feed screen (always shown in compact mode) passes 'compact'.
 */
export function useBuyerTabBarInset(mode: BuyerTabBarMode = 'regular'): number {
  return useBuyerTabBarMetrics(1, mode).occupiedHeight;
}

/** Gap kept between the last scrolled content and the bar (Dev's rule: "+ 16"). */
const CONTENT_CLEARANCE_GAP = 16;

/**
 * THE bottom padding for scroll content on any screen that renders behind
 * the floating tab bar, so nothing ever ends under or behind it. Dev's
 * rule: tab bar height + bottom safe inset + 16 — and never less than the
 * bar's own `occupiedHeight` + 16, since on a device with no bottom inset
 * the bar floats 12px up from the edge and the bare formula would leave
 * only 4px above it. `sideCircleCount` is 1 for the buyer bar, 2 for the
 * seller bar (Studio + AI circles), same as useBuyerTabBarMetrics.
 */
export function useTabBarClearance(sideCircleCount = 1, mode: BuyerTabBarMode = 'regular'): number {
  const insets = useSafeAreaInsets();
  const metrics = useBuyerTabBarMetrics(sideCircleCount, mode);
  return Math.max(
    metrics.capsuleHeight + insets.bottom + CONTENT_CLEARANCE_GAP,
    metrics.occupiedHeight + CONTENT_CLEARANCE_GAP,
  );
}

/**
 * Height, from the bottom of the screen, of the bar's own visible top edge —
 * "the line" a Reels/TikTok-style immersive video frame stops at. See
 * `barTopInset` above for why this is smaller than `useBuyerTabBarInset()`
 * (which adds breathing room for ordinary scrolling content, not for a
 * video frame that must end exactly where the bar begins). Defaults to
 * 'regular' for the same reason as `useBuyerTabBarInset` above.
 */
export function useBuyerTabBarTopInset(mode: BuyerTabBarMode = 'regular'): number {
  return useBuyerTabBarMetrics(1, mode).barTopInset;
}
