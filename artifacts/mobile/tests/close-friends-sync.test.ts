/**
 * socialService close friends: the local-only list (AsyncStorage) now syncs with
 * GET/PUT /api/social/close-friends. The server list wins; a non-empty local list
 * is uploaded exactly once when the server list is empty; signed out stays local.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
    multiGet: () => Promise.resolve([]),
    multiSet: () => Promise.resolve(),
  },
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));

import { getCloseFriendIds, initSocialService, saveCloseFriendIds } from '@/services/socialService';

const KEY = 'bt:close-friends:user_1:v1';

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  request.mockReset();
  initSocialService('user_1');
});

describe('close friends sync', () => {
  it('signed out: local only, no network', async () => {
    initSocialService(null);
    store['bt:close-friends:anon:v1'] = JSON.stringify(['a']);
    expect(await getCloseFriendIds()).toEqual(['a']);
    await saveCloseFriendIds(['a', 'b']);
    expect(JSON.parse(store['bt:close-friends:anon:v1'])).toEqual(['a', 'b']);
    expect(request).not.toHaveBeenCalled();
  });

  it('uploads the legacy local list once when the server list is empty', async () => {
    store[KEY] = JSON.stringify(['a', 'b']);
    request
      .mockResolvedValueOnce({ userIds: [] })
      .mockResolvedValueOnce({ userIds: ['a'] }); // server dropped 'b' (not in my follow graph)
    expect(await getCloseFriendIds()).toEqual(['a']);
    expect(request.mock.calls[1][0]).toBe('/api/social/close-friends');
    expect(JSON.parse(request.mock.calls[1][1].body)).toEqual({ userIds: ['a', 'b'] });
    expect(JSON.parse(store[KEY])).toEqual(['a']);

    // Later, a deliberately emptied server list is NOT re-filled from local.
    store[KEY] = JSON.stringify(['a']);
    request.mockResolvedValueOnce({ userIds: [] });
    expect(await getCloseFriendIds()).toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('server list wins over local; failures fall back to the cache', async () => {
    store[KEY] = JSON.stringify(['old']);
    request.mockResolvedValueOnce({ userIds: ['x', 'y'] });
    expect(await getCloseFriendIds()).toEqual(['x', 'y']);
    request.mockRejectedValueOnce(new Error('offline'));
    expect(await getCloseFriendIds()).toEqual(['x', 'y']);
  });

  it('save PUTs and caches what the server kept; a rejected save throws', async () => {
    request.mockResolvedValueOnce({ userIds: ['a'], rejected: ['b'] });
    await saveCloseFriendIds(['a', 'b']);
    expect(request).toHaveBeenLastCalledWith('/api/social/close-friends', expect.objectContaining({ method: 'PUT' }), false);
    expect(JSON.parse(store[KEY])).toEqual(['a']);
    request.mockRejectedValueOnce(new Error('500'));
    await expect(saveCloseFriendIds(['a'])).rejects.toThrow();
  });
});
