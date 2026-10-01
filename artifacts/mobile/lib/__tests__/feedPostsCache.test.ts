import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  },
}));

import { getCachedFeedPosts, hydrateFeedPostsCache, initFeedPostsCache, purgeAuthorFromFeedPostsCache, setCachedFeedPosts } from '../feedPostsCache';

describe('feedPostsCache: per-account scoping', () => {
  beforeEach(() => {
    store.clear();
    initFeedPostsCache(null);
  });

  it('keeps two accounts\' "for-you" feed pages fully separate (different follows -> different feeds)', () => {
    initFeedPostsCache('user-a');
    setCachedFeedPosts('for-you', [{ id: 'post-a-1' }]);

    initFeedPostsCache('user-b');
    expect(getCachedFeedPosts('for-you')).toBeUndefined();
    setCachedFeedPosts('for-you', [{ id: 'post-b-1' }]);

    initFeedPostsCache('user-a');
    expect(getCachedFeedPosts('for-you')).toEqual([{ id: 'post-a-1' }]);
  });

  it('switching back to an already-visited account instantly repaints its own cached posts', () => {
    initFeedPostsCache('user-a');
    setCachedFeedPosts('following', [{ id: 'post-1' }, { id: 'post-2' }]);
    initFeedPostsCache('user-b');
    initFeedPostsCache('user-a');
    expect(getCachedFeedPosts('following')).toEqual([{ id: 'post-1' }, { id: 'post-2' }]);
  });

  it('persists to AsyncStorage under a scoped key, not a shared device-wide one', () => {
    initFeedPostsCache('user-a');
    setCachedFeedPosts('for-you', [{ id: 'post-1' }]);
    expect(store.has('bt_feed_posts_cache_v1_user-a:for-you')).toBe(true);
    expect(store.has('bt_feed_posts_cache_v1_for-you')).toBe(false);
  });

  it('ignores an empty/non-array write (nothing worth caching)', () => {
    // A userId not used by any other test in this file — memoryCache is a
    // module-level singleton that persists across tests, so a shared scope
    // here could read a leftover entry from an earlier test instead of
    // proving this write itself was a no-op.
    initFeedPostsCache('user-empty-write-check');
    setCachedFeedPosts('for-you', []);
    expect(getCachedFeedPosts('for-you')).toBeUndefined();
  });
});

describe('feedPostsCache: blocking purges the blocked author', () => {
  beforeEach(() => {
    store.clear();
    initFeedPostsCache('user-a');
  });

  it('removes their posts from every tab in memory and on disk, and keeps everyone else', async () => {
    setCachedFeedPosts('for-you', [{ id: '1', sellerId: 'blocked' }, { id: '2', sellerId: 'ok' }]);
    setCachedFeedPosts('following', [{ id: '3', sellerId: 'blocked' }]);
    await purgeAuthorFromFeedPostsCache('blocked');
    expect(getCachedFeedPosts('for-you')).toEqual([{ id: '2', sellerId: 'ok' }]);
    expect(getCachedFeedPosts('following')).toEqual([]);
    const onDisk = JSON.parse(store.get('bt_feed_posts_cache_v1_user-a:for-you') ?? '[]');
    expect(onDisk).toEqual([{ id: '2', sellerId: 'ok' }]);
  });

  it('cleans a disk-only cache that has not been hydrated this session', async () => {
    store.set('bt_feed_posts_cache_v1_user-a:for-you', JSON.stringify([{ id: '1', sellerId: 'blocked' }, { id: '2', sellerId: 'ok' }]));
    await purgeAuthorFromFeedPostsCache('blocked');
    expect(await hydrateFeedPostsCache('for-you')).toEqual([{ id: '2', sellerId: 'ok' }]);
  });
});
