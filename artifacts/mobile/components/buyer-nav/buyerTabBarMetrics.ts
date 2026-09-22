import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Geometry for the floating buyer tab bar.
 *
 * Everything the bar, the search morph and the screens behind the bar need is
 * derived from one pure function so the numbers can never drift apart:
 * the bar sizes itself from these values, and every screen that scrolls under
 * it pads its content by `occupiedHeight`.
 *
 * The capsule is sized to its four slots rather than stretched edge to edge
 * (roughly 77–84% of a phone's width including the Profile circle), and iPad
 * gets its own larger, centred proportions instead of a stretched phone bar.
 */

export const BUYER_TAB_SLOT_COUNT = 4;

export type BuyerTabBarSizeClass = 'compact' | 'regular' | 'large' | 'tablet';

export type BuyerTabBarMetrics = {
  sizeClass: BuyerTabBarSizeClass;
  isTablet: boolean;
  /** Width of one Home/Discover/Inbox/Search slot. */
  itemWidth: number;
  /** Inner horizontal padding between the capsule edge and the first slot. */
  capsulePadding: number;
  capsuleHeight: number;
  /** Capsule width in its normal (tabs) state. */
  capsuleWidth: number;
  /** Capsule width while search is open. Equal to `capsuleWidth` on phones. */
  searchCapsuleWidth: number;
  /** Diameter of the separate Profile / Close circle. Matches the capsule height. */
  circleSize: number;
  /** Space between the capsule and the circle. */
  gap: number;
  /** Distance from the bottom of the screen to the bottom of the bar. */
  bottomOffset: number;
  /** Height of the inline search field inside the capsule. */
  fieldHeight: number;
  /** Gap kept between the bar and the top of the keyboard in search mode. */
  keyboardGap: number;
  iconSize: number;
  labelSize: number;
  /**
   * How much of the bottom of the screen the bar covers, including the home
   * indicator area and breathing room. Screens behind the bar pad by this.
   */
  occupiedHeight: number;
};

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
    : width < 380
      ? 'compact'
      : width < 420
        ? 'regular'
        : 'large';

  const itemWidth = { compact: 60, regular: 63, large: 66, tablet: 84 }[sizeClass];
  const capsuleHeight = { compact: 58, regular: 60, large: 60, tablet: 64 }[sizeClass];
  const capsulePadding = 4;
  const gap = isTablet ? 12 : 8;
  const circleSize = capsuleHeight;
  const capsuleWidth = itemWidth * BUYER_TAB_SLOT_COUNT + capsulePadding * 2;

  // On iPad a 330pt field would look lost, so the capsule widens while search
  // is open. It is a fixed target, never a measured feedback loop.
  const sideMargin = isTablet ? 48 : 16;
  const maxSearchWidth = width - sideMargin * 2 - gap - circleSize;
  const searchCapsuleWidth = isTablet
    ? Math.max(capsuleWidth, Math.min(560, maxSearchWidth))
    : capsuleWidth;

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
    fieldHeight: capsuleHeight - (isTablet ? 18 : 16),
    keyboardGap: 8,
    iconSize: isTablet ? 26 : 24,
    labelSize: isTablet ? 12 : 11,
    occupiedHeight: bottomOffset + capsuleHeight + CONTENT_CLEARANCE,
  };
}

export function useBuyerTabBarMetrics(): BuyerTabBarMetrics {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return getBuyerTabBarMetrics({ width, height, bottomInset: insets.bottom });
}

/**
 * Bottom padding for any buyer screen that renders behind the floating bar.
 * Use it for scroll content `paddingBottom` and for bottom-anchored overlays so
 * nothing is hidden under the bar or the home indicator.
 */
export function useBuyerTabBarInset(): number {
  return useBuyerTabBarMetrics().occupiedHeight;
}
