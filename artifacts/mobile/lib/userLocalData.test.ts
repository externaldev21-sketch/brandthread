import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach((k) => store.delete(k)); }),
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0' } } }));
vi.mock('react-native', () => ({ AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) } }));

import { queryClient, queryKeys, setQueryKeyScope } from './queryClient';
import { clearUserLocalData, isUserScopedQueryKey } from './userLocalData';
import { getCachedFeedPosts, initFeedPostsCache, setCachedFeedPosts } from './feedPostsCache';
import { getCachedTabData, initTabDataCache, setCachedTabData } from './tabDataCache';

describe('clearUserLocalData (explicit sign-out)', () => {
  beforeEach(() => {
    store.clear();
    queryClient.clear();
  });

  it('matches only keys scoped to that account', () => {
    expect(isUserScopedQueryKey(['orders', 'u1', 'all'], 'u1')).toBe(true);
    expect(isUserScopedQueryKey(['profile', 'u1'], 'u1')).toBe(true);
    expect(isUserScopedQueryKey(['orders', 'u2', 'all'], 'u1')).toBe(false);
    expect(isUserScopedQueryKey(['orders'], 'u1')).toBe(false);
  });

  it('drops the leaving account\'s queries and warm-start caches, keeps other accounts\'', async () => {
    setQueryKeyScope('u1');
    queryClient.setQueryData(queryKeys.orderList('all'), [{ id: 'o1' }]);
    queryClient.setQueryData(queryKeys.profile('u1'), { id: 'u1' });
    initFeedPostsCache('u1');
    setCachedFeedPosts('for-you', [{ id: 'p1' }]);
    initTabDataCache('u1');
    setCachedTabData('inbox', { conversations: [] });

    setQueryKeyScope('u2');
    queryClient.setQueryData(queryKeys.orderList('all'), [{ id: 'o2' }]);
    initFeedPostsCache('u2');
    setCachedFeedPosts('for-you', [{ id: 'p2' }]);

    await clearUserLocalData('u1');

    expect(queryClient.getQueryData(['orders', 'u1', 'all'])).toBeUndefined();
    expect(queryClient.getQueryData(['profile', 'u1'])).toBeUndefined();
    expect(queryClient.getQueryData(['orders', 'u2', 'all'])).toEqual([{ id: 'o2' }]);
    expect([...store.keys()].some((k) => k.includes(':u1:'))).toBe(false);
    expect([...store.keys()].some((k) => k.includes(':u2:'))).toBe(true);

    initFeedPostsCache('u1');
    initTabDataCache('u1');
    expect(getCachedFeedPosts('for-you')).toBeUndefined();
    expect(getCachedTabData('inbox')).toBeUndefined();
  });
});
