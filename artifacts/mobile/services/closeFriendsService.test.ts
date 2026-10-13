import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  seller: false,
  demo: false,
  calls: [] as Array<{ path: string; options?: RequestInit }>,
  responses: {} as Record<string, unknown>,
}));

vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => h.seller,
  isPreviewDemoMode: () => h.demo,
}));
vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: async (path: string, options?: RequestInit) => {
    h.calls.push({ path, options });
    const key = Object.keys(h.responses).find((k) => path.startsWith(k));
    if (!key) throw new Error(`unexpected ${path}`);
    const value = h.responses[key];
    if (value instanceof Error) throw value;
    return value;
  },
}));

import { dedupeSections, loadSellerCloseFriends, saveSellerCloseFriends } from './closeFriendsService';

const p = (userId: string) => ({ userId, name: userId, handle: `@${userId}`, avatarUrl: null });

beforeEach(() => {
  h.seller = false; h.demo = false; h.calls = []; h.responses = {};
});

describe('dedupeSections', () => {
  it('keeps each person in the first section they appear in', () => {
    const out = dedupeSections({
      list: [p('a')],
      topBuyers: [{ ...p('a'), orderCount: 1, totalCents: 1, followsYou: true }, { ...p('b'), orderCount: 1, totalCents: 1, followsYou: false }],
      followers: [p('b'), p('c'), p('a')],
    });
    expect(out.list.map((x) => x.userId)).toEqual(['a']);
    expect(out.topBuyers.map((x) => x.userId)).toEqual(['b']);
    expect(out.followers.map((x) => x.userId)).toEqual(['c']);
  });
});

describe('loadSellerCloseFriends', () => {
  it('reads list, suggestions and followers from the API', async () => {
    h.responses['/api/social/close-friends/suggestions'] = { suggestions: [{ userId: 'b', name: 'Bea', handle: '@bea', orderCount: 3, totalCents: 9000, followsYou: false }] };
    h.responses['/api/social/close-friends'] = { friends: [{ userId: 'a', name: 'Ann', handle: '@ann', avatarUrl: null }] };
    h.responses['/api/social/followers'] = [{ userId: 'c', name: 'Cy', handle: '@cy' }, { userId: 'b', name: 'Bea', handle: '@bea' }];
    const out = await loadSellerCloseFriends();
    expect(out.list.map((x) => x.userId)).toEqual(['a']);
    expect(out.topBuyers).toEqual([{ userId: 'b', name: 'Bea', handle: '@bea', avatarUrl: null, orderCount: 3, totalCents: 9000, followsYou: false }]);
    expect(out.followers.map((x) => x.userId)).toEqual(['c']);
  });

  it('a failed suggestions call (e.g. 403 for a non-seller) still loads the list', async () => {
    h.responses['/api/social/close-friends/suggestions'] = new Error('403');
    h.responses['/api/social/close-friends'] = { friends: [] };
    h.responses['/api/social/followers'] = [];
    await expect(loadSellerCloseFriends()).resolves.toEqual({ list: [], topBuyers: [], followers: [] });
  });

  it('seller preview never calls the API: demo fixtures with ?demo=1, empty otherwise', async () => {
    h.seller = true;
    expect(await loadSellerCloseFriends()).toEqual({ list: [], topBuyers: [], followers: [] });
    h.demo = true;
    const demo = await loadSellerCloseFriends();
    expect(demo.topBuyers.length).toBeGreaterThan(0);
    expect(await saveSellerCloseFriends(['x'])).toEqual({ userIds: ['x'], rejected: [] });
    expect(h.calls).toEqual([]);
  });
});

describe('saveSellerCloseFriends', () => {
  it('PUTs { userIds } and returns saved + rejected', async () => {
    h.responses['/api/social/close-friends'] = { userIds: ['a'], rejected: ['z'] };
    expect(await saveSellerCloseFriends(['a', 'z'])).toEqual({ userIds: ['a'], rejected: ['z'] });
    expect(h.calls[0].options?.method).toBe('PUT');
    expect(JSON.parse(String(h.calls[0].options?.body))).toEqual({ userIds: ['a', 'z'] });
  });
});
