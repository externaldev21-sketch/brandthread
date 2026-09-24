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
 * The bars are icon-only. The capsule is sized to its four slots rather than
 * stretched edge to edge, so the buyer bar (capsule + Profile circle) and the
 * seller bar (Studio circle + capsule + AI circle) use the exact same capsule,
 * slot, circle and icon sizes and read as one app. iPad gets its own larger,
 * centred proportions instead of a stretched phone bar.
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
};

const CONTENT_CLEARANCE = 12;

export function getBuyerTabBarMetrics({ width, height, bottomInset }: MetricsInput): BuyerTabBarMetrics {
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

  // Icon-only slots: roomy enough to feel calm, narrow enough that the seller
  // bar's two side circles still fit with comfortable margins on a 360pt
  // phone. Every control stays at least 44pt.
  const itemWidth = { mini: 44, compact: 50, regular: 54, large: 58, tablet: 76 }[sizeClass];
  const capsuleHeight = { mini: 48, compact: 52, regular: 54, large: 56, tablet: 60 }[sizeClass];
  const capsulePadding = 5;
  const gap = isTablet ? 12 : sizeClass === 'mini' ? 6 : 8;
  const circleSize = capsuleHeight;
  const capsuleWidth = itemWidth * BUYER_TAB_SLOT_COUNT + capsulePadding * 2;

  // Icon-only slots leave the capsule narrower than a comfortable search
  // field, so it widens while search is open (to the screen margins on a
  // phone, capped on iPad). It is a fixed target, never a measured feedback
  // loop.
  const sideMargin = isTablet ? 48 : 12;
  const maxSearchWidth = width - sideMargin * 2 - gap - circleSize;
  const searchCapsuleWidth = Math.max(capsuleWidth, Math.min(isTablet ? 560 : 420, maxSearchWidth));

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
    indicatorWidth: itemWidth - 4,
    indicatorHeight: capsuleHeight - capsulePadding * 2,
    occupiedHeight: bottomOffset + capsuleHeight + CONTENT_CLEARANCE,
  };
}

export const getTabBarMetrics = getBuyerTabBarMetrics;

export function useBuyerTabBarMetrics(): BuyerTabBarMetrics {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return getBuyerTabBarMetrics({ width, height, bottomInset: insets.bottom });
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
