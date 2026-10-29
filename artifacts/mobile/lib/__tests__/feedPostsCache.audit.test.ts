import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let holdReads = false;
const heldReads: Array<() => void> = [];
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0' } } }));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => new Promise<string | null>((resolve) => {
      const answer = () => resolve(store.get(key) ?? null);
      if (holdReads) heldReads.push(answer);
      else answer();
    })),
    setItem: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
  },
}));

import { FEED_POSTS_CACHE_PREFIX, getCachedFeedPosts, initFeedPostsCache, purgeAuthorFromFeedPostsCache } from '../feedPostsCache';

describe('feedPostsCache: block purge during an account switch', () => {
  it('never writes the blocking account’s feed page under the account signed in next', async () => {
    // Account A has a cold (disk-only) For You page with a post by the blocked author.
    const diskKey = (user: string, tab: string) => `${FEED_POSTS_CACHE_PREFIX}1@1.0.0:${user}:${tab}`;
    store.set(diskKey('audit-a', 'for-you'), JSON.stringify([{ id: 'p1', sellerId: 'blocked' }, { id: 'p2', sellerId: 'ok' }]));
    initFeedPostsCache('audit-a');

    holdReads = true;
    const purge = purgeAuthorFromFeedPostsCache('blocked');
    // Account switch while the purge is still reading storage.
    initFeedPostsCache('audit-b');
    holdReads = false;
    heldReads.splice(0).forEach((answer) => answer());
    await purge;

    expect(getCachedFeedPosts('for-you')).toBeUndefined();
    expect(store.has(diskKey('audit-b', 'for-you'))).toBe(false);
    // A's own page is still cleaned.
    expect(JSON.parse(store.get(diskKey('audit-a', 'for-you'))!)).toEqual([{ id: 'p2', sellerId: 'ok' }]);
    initFeedPostsCache('audit-a');
    expect(getCachedFeedPosts('for-you')).toEqual([{ id: 'p2', sellerId: 'ok' }]);
  });
});
