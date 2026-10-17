/**
 * Discover infinite scroll + pull-to-refresh rules (lib/discoverPaging.ts)
 * and the GET /api/public/discover → tile mapping (lib/discoverFeed.ts).
 *
 * Regression cover for Dev's report: scrolling down "did a weird jump reset
 * to where it said nothing to show", and pulling down reloaded the screen to
 * "Nothing to show yet". The old code re-fetched the whole list with a
 * growing limit and REPLACED it; the second page asked trending for 60 rows,
 * the server 400'd (> 50), the error was swallowed as [] and the grid
 * flipped to the empty state.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/socialService', () => ({
  getBlockedUsers: vi.fn(async () => [{ blockedUserId: 'u-blocked' }]),
  getMutedUsers: vi.fn(async () => [{ mutedUserId: 'u-muted' }]),
}));
vi.mock('@/lib/previewCatalog', () => ({ isPreviewCatalogEnabled: () => false }));
vi.mock('@/lib/guestMutedWords', () => ({
  readGuestMutedWords: vi.fn(async () => [{ phrase: 'spoiler' }]),
  matchesGuestMutedWords: (text: string | undefined, phrases: string[]) => phrases.some((p) => (text ?? '').includes(p)),
}));
vi.mock('@/lib/previewDiscover', () => ({
  getPreviewDiscoverPosts: () => [], getPreviewBrandCards: () => [], getPreviewDiscoverPeople: () => [], getPreviewDrops: () => [],
}));

import {
  appendUnique, applyError, applyFirstPage, applyNextPage, cacheableFeed, canLoadMore, initialFeedState,
  shouldShowEmptyState, MAX_CACHED_POSTS, type DiscoverFeedState,
} from '@/lib/discoverPaging';
import { fetchDiscoverPage, mapDiscoverItemToPost, type DiscoverPost } from '@/lib/discoverFeed';

const post = (id: string): DiscoverPost => ({
  id, authorId: `a-${id}`, authorName: 'Brandthread', authorHandle: '@brandthread', authorInitials: 'B', authorColor: '#222',
  authorAccountType: 'seller', media: 'photo', imageUri: `https://img.test/${id}.jpg`, likesCount: 0, commentsCount: 0, createdAt: '',
});
const posts = (from: number, n: number) => Array.from({ length: n }, (_, i) => post(`p${from + i}`));
const loaded = (n: number, nextCursor: string | null = 'c1'): DiscoverFeedState =>
  applyFirstPage(initialFeedState(), { posts: posts(0, n), nextCursor });

describe('pagination appends', () => {
  it('appends the next page after the current tiles, in order, without replacing them', () => {
    const s1 = loaded(24, 'c1');
    const before = s1.posts;
    const s2 = applyNextPage({ ...s1, loadingMore: true }, { posts: posts(24, 24), nextCursor: 'c2' });
    expect(s2.posts).toHaveLength(48);
    expect(s2.posts.slice(0, 24)).toEqual(before);
    expect(s2.posts[0]).toBe(before[0]); // same objects → memoized tiles don't re-render
    expect(s2.posts.map((p) => p.id)).toEqual(posts(0, 48).map((p) => p.id));
    expect(s2.nextCursor).toBe('c2');
    expect(s2.loadingMore).toBe(false);
  });

  it('drops duplicates that a later page repeats', () => {
    const merged = appendUnique(posts(0, 3), [post('p2'), post('p3'), post('p3')]);
    expect(merged.map((p) => p.id)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });

  it('an empty next page keeps every tile and marks the end — never an empty grid', () => {
    const s = applyNextPage(loaded(24), { posts: [], nextCursor: null });
    expect(s.posts).toHaveLength(24);
    expect(s.reachedEnd).toBe(true);
    expect(canLoadMore(s)).toBe(false);
    expect(shouldShowEmptyState(s)).toBe(false);
  });

  it('a failed next page keeps every tile and offers a retry instead of looping', () => {
    const s = applyError({ ...loaded(24), loadingMore: true }, 'more');
    expect(s.posts).toHaveLength(24);
    expect(s.error).toBe('more');
    expect(canLoadMore(s)).toBe(false); // onEndReached won't hammer; the inline retry clears it
    expect(shouldShowEmptyState(s)).toBe(false);
    expect(canLoadMore({ ...s, error: null })).toBe(true);
  });

  it('does not page while the first page, a refresh or another page is in flight, or at the end', () => {
    expect(canLoadMore(initialFeedState())).toBe(false);
    expect(canLoadMore({ ...loaded(24), refreshing: true })).toBe(false);
    expect(canLoadMore({ ...loaded(24), loadingMore: true })).toBe(false);
    expect(canLoadMore(loaded(24, null))).toBe(false);
    expect(canLoadMore(loaded(24, 'c1'))).toBe(true);
  });
});

describe('pull-to-refresh is stale-while-revalidate', () => {
  it('keeps the current tiles on screen while refreshing', () => {
    const s = { ...loaded(24), refreshing: true };
    expect(s.posts).toHaveLength(24);
    expect(shouldShowEmptyState(s)).toBe(false);
  });

  it('swaps in the new first page when it arrives', () => {
    const s = applyFirstPage({ ...loaded(48, 'c2'), refreshing: true }, { posts: posts(100, 24), nextCursor: 'n1' });
    expect(s.posts.map((p) => p.id)).toEqual(posts(100, 24).map((p) => p.id));
    expect(s.nextCursor).toBe('n1');
    expect(s.refreshing).toBe(false);
  });

  it('an empty refresh result never clears tiles that were there', () => {
    const s = applyFirstPage({ ...loaded(24), refreshing: true }, { posts: [], nextCursor: null });
    expect(s.posts).toHaveLength(24);
    expect(shouldShowEmptyState(s)).toBe(false);
  });

  it('a failed refresh keeps the tiles and shows an inline retry', () => {
    const s = applyError({ ...loaded(24), refreshing: true }, 'refresh');
    expect(s.posts).toHaveLength(24);
    expect(s.error).toBe('refresh');
    expect(s.refreshing).toBe(false);
    expect(shouldShowEmptyState(s)).toBe(false);
  });
});

describe('empty state shows only when the very first page is truly empty', () => {
  it('not before anything has loaded', () => {
    expect(shouldShowEmptyState(initialFeedState())).toBe(false);
  });

  it('yes when the first page came back empty', () => {
    expect(shouldShowEmptyState(applyFirstPage(initialFeedState(), { posts: [], nextCursor: null }))).toBe(true);
  });

  it('not when the first load failed (that is a retry, not "nothing to show")', () => {
    expect(shouldShowEmptyState(applyError(initialFeedState(), 'first'))).toBe(false);
  });

  it('not while any tile is on screen, in any phase', () => {
    for (const patch of [{}, { refreshing: true }, { loadingMore: true }, { error: 'more' as const }, { error: 'refresh' as const }]) {
      expect(shouldShowEmptyState({ ...loaded(3), ...patch })).toBe(false);
    }
  });
});

describe('cache', () => {
  it('never caches an empty list (that is what painted "Nothing to show" on the next mount)', () => {
    expect(cacheableFeed(applyFirstPage(initialFeedState(), { posts: [], nextCursor: null }))).toBeNull();
  });

  it('a cached list paints on mount without a skeleton; an empty cached list does not count', () => {
    const fromCache = initialFeedState({ posts: posts(0, 24), nextCursor: 'c1' });
    expect(fromCache.loadedOnce).toBe(true);
    expect(fromCache.loadingFirst).toBe(false);
    expect(initialFeedState({ posts: [], nextCursor: null }).loadingFirst).toBe(true);
  });

  it('caches the whole loaded list with the cursor after its LAST post (no skipped pages)', () => {
    const s = applyNextPage(loaded(24, 'c1'), { posts: posts(24, 24), nextCursor: 'c2' });
    expect(cacheableFeed(s)).toEqual({ posts: s.posts, nextCursor: 'c2' });
    const big = applyNextPage(loaded(MAX_CACHED_POSTS, 'c1'), { posts: posts(500, 24), nextCursor: 'c9' });
    expect(cacheableFeed(big)).toBeNull();
  });
});

describe('GET /api/public/discover → tiles', () => {
  const item = (id: string, extra: Record<string, unknown> = {}) => ({
    id, mediaType: 'photo', imageUrl: `https://img.test/${id}.jpg`, mediaUrl: '', caption: 'fit check', createdAt: '2026-10-17T00:00:00Z',
    likesCount: 12, viewsCount: 300, commentsCount: 1, ranked: false,
    author: { userId: `u-${id}`, name: 'Brandthread', handle: '@brandthread', avatarUrl: null, accountType: 'seller' },
    ...extra,
  });

  it('maps the server image onto the tile (the old trending payload had none → empty tiles)', () => {
    const tile = mapDiscoverItemToPost(item('v1', { mediaType: 'video', imageUrl: 'https://api.test/api/posts/media/uploads/poster' }))!;
    expect(tile.imageUri).toBe('https://api.test/api/posts/media/uploads/poster');
    expect(tile.media).toBe('video');
    expect(tile.viewsCount).toBe(300);
    expect(mapDiscoverItemToPost(item('x', { imageUrl: '' }))).toBeNull();
    expect(mapDiscoverItemToPost(item('h', { likesCount: null }))!.likesHidden).toBe(true);
  });

  it('passes the cursor through, keeps server order, drops blocked/muted authors and guest muted words', async () => {
    const pageFn = vi.fn(async () => ({
      items: [
        item('b'), item('a'),
        item('blk', { author: { userId: 'u-blocked', name: 'x', handle: '', avatarUrl: null, accountType: 'buyer' } }),
        item('mut', { author: { userId: 'u-muted', name: 'x', handle: '', avatarUrl: null, accountType: 'buyer' } }),
        item('sp', { caption: 'spoiler alert' }),
      ],
      nextCursor: 'next-1',
    }));
    const page = await fetchDiscoverPage({ api: { publicDiscover: { page: pageFn } }, isSignedIn: false, filter: 'forYou', limit: 24, cursor: 'cur-0' });
    expect(pageFn).toHaveBeenCalledWith({ cursor: 'cur-0', limit: 24, kind: 'forYou' });
    expect(page.posts.map((p) => p.id)).toEqual(['b', 'a']);
    expect(page.nextCursor).toBe('next-1');
  });

  it('throws on a failed request so the screen keeps its tiles (never treated as "no posts")', async () => {
    const api = { publicDiscover: { page: vi.fn(async () => { throw new Error('500'); }) } };
    await expect(fetchDiscoverPage({ api, isSignedIn: true, filter: 'forYou' })).rejects.toThrow('500');
  });
});
