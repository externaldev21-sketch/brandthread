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
    // Bounds how many video players ever exist at once: the active page
    // plus roughly the next/previous 2 stay mounted (poster-first, so they
    // start instantly the moment they become active) — the rest are
    // unmounted rather than left decoding off-screen. On web,
    // react-native-web's VirtualizedList batches renders off scroll events
    // rather than native's more reliable cell-recycling timers; a low
    // initialNumToRender/windowSize there let fast/paginated swiping outrun
    // the render batches, landing on pages that were never mounted at all
    // (a blank page) after only a handful of swipes. Web renders the whole
    // (small, ~10-item) preview list up front instead of virtualizing it.
    initialNumToRender: Platform.OS === 'web' ? itemCount : 3,
    maxToRenderPerBatch: Platform.OS === 'web' ? itemCount : 2,
    windowSize: Platform.OS === 'web' ? 21 : 5,
    removeClippedSubviews: Platform.OS !== 'web',
    getItemLayout: (_: unknown, index: number) => ({ length: pageHeight, offset: pageHeight * index, index }),
  };
}

/** A page becomes "active" once 60% of it is on screen. */
export const VERTICAL_PAGER_VIEWABILITY = { itemVisiblePercentThreshold: 60 } as const;
