/**
 * Pure state rules for the Discover grid's infinite scroll + pull-to-refresh
 * (hooks/useDiscoverFeed.ts drives them; tests/discover-paging.test.ts pins
 * them). No react-native imports so they unit-test in plain node.
 *
 * The bugs these rules exist to prevent:
 *  - a next-page fetch REPLACING the list (it must append, de-duplicated);
 *  - a failed or empty refresh/page clearing tiles that were on screen and
 *    flipping the grid to "Nothing to show yet";
 *  - an empty result being cached and painted as content on the next mount.
 */
import type { DiscoverPost } from '@/lib/discoverFeed';

export type FeedError = 'first' | 'refresh' | 'more' | null;

export interface DiscoverFeedState {
  posts: DiscoverPost[];
  /** Cursor for the next page; null with `reachedEnd` means no more pages. */
  nextCursor: string | null;
  reachedEnd: boolean;
  /** True once a first page (or a cached one) has been received. */
  loadedOnce: boolean;
  loadingFirst: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: FeedError;
}

export interface FeedPage {
  posts: DiscoverPost[];
  nextCursor: string | null;
}

export function initialFeedState(cached?: FeedPage | null): DiscoverFeedState {
  const hasCache = !!cached && cached.posts.length > 0;
  return {
    posts: hasCache ? cached!.posts : [],
    nextCursor: hasCache ? cached!.nextCursor : null,
    reachedEnd: hasCache ? cached!.nextCursor === null : false,
    loadedOnce: hasCache,
    loadingFirst: !hasCache,
    refreshing: false,
    loadingMore: false,
    error: null,
  };
}

/** Appends `incoming` after `existing`, dropping any id already shown (order kept). */
export function appendUnique(existing: DiscoverPost[], incoming: DiscoverPost[]): DiscoverPost[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((p) => p.id));
  const fresh = incoming.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  return fresh.length === 0 ? existing : [...existing, ...fresh];
}

/** A next page arrived: append, never replace. */
export function applyNextPage(state: DiscoverFeedState, page: FeedPage): DiscoverFeedState {
  return {
    ...state,
    posts: appendUnique(state.posts, page.posts),
    nextCursor: page.nextCursor,
    reachedEnd: page.nextCursor === null,
    loadingMore: false,
    loadedOnce: true,
    error: null,
  };
}

/**
 * A first load or pull-to-refresh arrived. Swaps in the new first page —
 * unless it came back empty while tiles are on screen, in which case the
 * current tiles stay (stale-while-revalidate never ends in an empty grid).
 */
export function applyFirstPage(state: DiscoverFeedState, page: FeedPage): DiscoverFeedState {
  const keepCurrent = page.posts.length === 0 && state.posts.length > 0;
  return {
    ...state,
    posts: keepCurrent ? state.posts : appendUnique([], page.posts),
    nextCursor: keepCurrent ? state.nextCursor : page.nextCursor,
    reachedEnd: keepCurrent ? state.reachedEnd : page.nextCursor === null,
    loadedOnce: true,
    loadingFirst: false,
    refreshing: false,
    error: null,
  };
}

/** A request failed: keep every tile, stop the spinner, remember what to retry. */
export function applyError(state: DiscoverFeedState, kind: Exclude<FeedError, null>): DiscoverFeedState {
  return {
    ...state,
    loadingFirst: false,
    refreshing: false,
    loadingMore: false,
    // A failed first load with nothing on screen is not "loaded": the screen
    // shows a retry, never the empty state.
    error: kind,
  };
}

/** Whether a scroll to the end should fetch another page right now. */
export function canLoadMore(state: DiscoverFeedState): boolean {
  return state.loadedOnce
    && !state.reachedEnd
    && !!state.nextCursor
    && !state.loadingMore
    && !state.loadingFirst
    && !state.refreshing
    && state.error !== 'more';
}

/**
 * The "Nothing to show yet" state shows ONLY when the very first page
 * genuinely came back empty: never while loading, refreshing or paging,
 * never after an error, never while any tile is on screen.
 */
export function shouldShowEmptyState(state: DiscoverFeedState): boolean {
  return state.loadedOnce
    && state.posts.length === 0
    && !state.loadingFirst
    && !state.refreshing
    && !state.loadingMore
    && state.error === null;
}

/** Most tiles worth persisting for an instant paint on the next mount. */
export const MAX_CACHED_POSTS = 96;

/**
 * What may be written to the persisted cache, or null to leave it alone:
 * never an empty list, and never a slice whose cursor would skip pages
 * (the cursor always continues after the LAST cached post).
 */
export function cacheableFeed(state: DiscoverFeedState): FeedPage | null {
  if (state.posts.length === 0 || state.posts.length > MAX_CACHED_POSTS) return null;
  return { posts: state.posts, nextCursor: state.reachedEnd ? null : state.nextCursor };
}
