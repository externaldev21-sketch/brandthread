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
};

export type TabBarMetrics = BuyerTabBarMetrics;

type MetricsInput = {
  width: number;
  height: number;
  bottomInset: number;
  /** Circles beside the capsule: buyer has Profile (1), seller has Studio + AI (2). */
  sideCircleCount?: number;
};

const CONTENT_CLEARANCE = 12;
/** Outer gap from the screen edge to the bar, on phones — the Instagram-style margin. */
const PHONE_SIDE_MARGIN = 16;
/** iPad keeps a comfortable, centred bar instead of stretching across a huge screen. */
const TABLET_MAX_BAR_WIDTH = 560;

export function getBuyerTabBarMetrics({ width, height, bottomInset, sideCircleCount = 1 }: MetricsInput): BuyerTabBarMetrics {
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

  return {
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
  };
}

export const getTabBarMetrics = getBuyerTabBarMetrics;

export function useBuyerTabBarMetrics(sideCircleCount = 1): BuyerTabBarMetrics {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return getBuyerTabBarMetrics({ width, height, bottomInset: insets.bottom, sideCircleCount });
}

export const useTabBarMetrics = useBuyerTabBarMetrics;

/**
 * Bottom padding for any buyer screen that renders behind the floating bar.
 * Use it for scroll content `paddingBottom` and for bottom-anchored overlays so
 * nothing is hidden under the bar or the home indicator.
 */
export function useBuyerTabBarInset(): number {
  return useBuyerTabBarMetrics().occupiedHeight;
}
