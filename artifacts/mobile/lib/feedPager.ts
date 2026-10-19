/**
 * Shared full-screen vertical pager configuration — the snap-per-page
 * FlatList behaviour of the Threads feed, reused by the LIVE pager so both
 * swipe, preload and virtualize identically.
 */
import { Platform } from 'react-native';

export function verticalPagerListProps(pageHeight: number, itemCount: number) {
  return {
    pagingEnabled: true,
    disableIntervalMomentum: true,
    showsVerticalScrollIndicator: false,
    decelerationRate: 'fast' as const,
    // A slow drag-then-release let the list rubber-band past the page
    // boundary before paging snapped it back — on iOS that's the default
    // vertical bounce, on Android the default overscroll glow/stretch, and
    // on web (react-native-web) the equivalent elastic overshoot. Only the
    // video itself should ever appear to move like that; the overlay chrome
    // doesn't animate at all, so that snap-back read as the whole page —
    // video and overlay together — bouncing. Disabling native overscroll
    // makes every release, slow or fast, land exactly on the page boundary.
    bounces: false,
    alwaysBounceVertical: false,
    overScrollMode: 'never' as const,
    // Render a bounded poster window, not every fetched page. The separate
    // VideoVisual gate allocates players only for current/previous/next.
    // A web overscan of two pages and frame-sized batches let a fast flick
    // reach a rendered neighbour without mounting an unbounded image tree.
    initialNumToRender: Math.max(1, Math.min(itemCount, 3)),
    maxToRenderPerBatch: 3,
    updateCellsBatchingPeriod: 16,
    windowSize: Platform.OS === 'web' ? 5 : 3,
    removeClippedSubviews: Platform.OS !== 'web',
    getItemLayout: (_: unknown, index: number) => ({ length: pageHeight, offset: pageHeight * index, index }),
  };
}

/** A page becomes "active" once 60% of it is on screen. */
export const VERTICAL_PAGER_VIEWABILITY = { itemVisiblePercentThreshold: 60 } as const;
