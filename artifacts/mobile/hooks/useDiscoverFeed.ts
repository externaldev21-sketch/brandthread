/**
 * useDiscoverFeed — the For You / Fits grid's data: cursor-paged infinite
 * scroll + stale-while-revalidate pull-to-refresh over GET /api/public/discover.
 *
 * Every transition goes through the pure rules in lib/discoverPaging.ts:
 * pages append (never replace), a refresh keeps the current tiles until new
 * ones arrive, an error keeps the tiles and exposes `retry`, and the list is
 * only ever "empty" when the very first page truly was. The last good list is
 * cached (never an empty one) so a remount paints it on frame one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDiscoverPage } from '@/lib/discoverFeed';
import {
  applyError, applyFirstPage, applyNextPage, cacheableFeed, canLoadMore, initialFeedState, shouldShowEmptyState,
  type DiscoverFeedState, type FeedPage,
} from '@/lib/discoverPaging';
import { getCachedTabData, setCachedTabData, setMemoryTabData } from '@/lib/tabDataCache';

export const DISCOVER_PAGE_SIZE = 24;
/** Thumbnails of the next page fetched ahead of the scroll. */
const PREFETCH_AHEAD = 12;

function readCache(key: string): FeedPage | null {
  const cached = getCachedTabData<FeedPage>(key);
  return cached && Array.isArray(cached.posts) ? cached : null;
}

export function prefetchThumbnails(uris: Array<string | undefined>): void {
  const list = uris.filter((u): u is string => !!u);
  if (list.length === 0) return;
  import('expo-image')
    .then(({ Image }) => Image.prefetch(list, { cachePolicy: 'memory-disk' }))
    .catch(() => {});
}

export function useDiscoverFeed({
  api, isSignedIn, filter, cacheKey, persist = false, enabled = true,
}: {
  api: any;
  isSignedIn: boolean;
  filter: 'forYou' | 'fits';
  cacheKey: string;
  persist?: boolean;
  enabled?: boolean;
}) {
  const [state, setState] = useState<DiscoverFeedState>(() => initialFeedState(readCache(cacheKey)));
  const stateRef = useRef(state);
  stateRef.current = state;
  // Drops responses from a request that a newer first-page load superseded.
  const generation = useRef(0);
  const started = useRef(false);

  const commit = useCallback((next: DiscoverFeedState) => {
    stateRef.current = next;
    setState(next);
    const cacheable = cacheableFeed(next);
    if (cacheable) (persist ? setCachedTabData : setMemoryTabData)(cacheKey, cacheable);
  }, [cacheKey, persist]);

  const loadFirst = useCallback(async (mode: 'first' | 'refresh' | 'revalidate') => {
    const gen = ++generation.current;
    const cur = stateRef.current;
    commit({ ...cur, loadingFirst: mode === 'first' && cur.posts.length === 0, refreshing: mode === 'refresh', loadingMore: false, error: null });
    try {
      const page = await fetchDiscoverPage({ api, isSignedIn, filter, limit: DISCOVER_PAGE_SIZE });
      if (gen !== generation.current) return;
      commit(applyFirstPage(stateRef.current, page));
      prefetchThumbnails(page.posts.slice(0, PREFETCH_AHEAD).map((p) => p.imageUri));
    } catch {
      if (gen !== generation.current) return;
      commit(applyError(stateRef.current, mode === 'first' ? 'first' : 'refresh'));
    }
  }, [api, isSignedIn, filter, commit]);

  const loadMore = useCallback(async () => {
    const cur = stateRef.current;
    if (!canLoadMore(cur)) return;
    const gen = generation.current;
    commit({ ...cur, loadingMore: true, error: null });
    try {
      const page = await fetchDiscoverPage({ api, isSignedIn, filter, limit: DISCOVER_PAGE_SIZE, cursor: cur.nextCursor });
      if (gen !== generation.current) return;
      commit(applyNextPage(stateRef.current, page));
      prefetchThumbnails(page.posts.slice(0, PREFETCH_AHEAD).map((p) => p.imageUri));
    } catch {
      if (gen !== generation.current) return;
      commit(applyError(stateRef.current, 'more'));
    }
  }, [api, isSignedIn, filter, commit]);

  const refresh = useCallback(() => loadFirst('refresh'), [loadFirst]);

  /** Retries whatever failed last: the first page, a refresh, or the next page. */
  const retry = useCallback(() => {
    const cur = stateRef.current;
    if (cur.error === 'more') {
      commit({ ...cur, error: null });
      return loadMore();
    }
    return loadFirst(cur.posts.length > 0 ? 'refresh' : 'first');
  }, [commit, loadFirst, loadMore]);

  // First load once enabled (Fits waits until its tab is opened). Cached
  // content stays on screen and is revalidated in the background.
  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;
    // A cached list is revalidated silently (no pull spinner, tiles stay).
    loadFirst(stateRef.current.posts.length > 0 ? 'revalidate' : 'first');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Keep the next page's thumbnails one step ahead of the scroll.
  const { posts, nextCursor } = state;
  useEffect(() => {
    prefetchThumbnails(posts.slice(-PREFETCH_AHEAD).map((p) => p.imageUri));
  }, [posts, nextCursor]);

  /** Local removal (Not interested / Mute) — never refetches. */
  const removeWhere = useCallback((predicate: (id: string, authorId: string) => boolean) => {
    const cur = stateRef.current;
    const kept = cur.posts.filter((p) => !predicate(p.id, p.authorId));
    if (kept.length !== cur.posts.length) commit({ ...cur, posts: kept });
  }, [commit]);

  return {
    state,
    posts: state.posts,
    showEmpty: shouldShowEmptyState(state),
    loadMore,
    refresh,
    retry,
    removeWhere,
  };
}
