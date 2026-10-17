/**
 * socialService mutes / restricts / privacy settings used to live only in
 * AsyncStorage. They now go to the server (which enforces them), with the
 * local copy as a mirror: writes throw on failure, reads fall back to the
 * mirror, and pre-server local mutes are copied up once.
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
    multiRemove: () => Promise.resolve(),
  },
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));

import {
  getMutedUsers, getPrivacySettings, getRestrictedUsers, initSocialService, muteUser, restrictUser,
  unmuteUser, updatePrivacySettings,
} from '@/services/socialService';

const MUTES = 'bt:social:user_1:mutes:v1';
const PERSON = { userId: 'u_2', name: 'Two', handle: '@two', initials: 'T', color: '#111' };
const serverPerson = (userId: string) => ({ userId, name: `N ${userId}`, handle: `@${userId}`, initials: 'N', createdAt: '2026-01-01T00:00:00.000Z' });

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  request.mockReset();
  initSocialService('user_1');
});

describe('mutes', () => {
  it('muteUser posts to the server and mirrors locally; a server failure throws and saves nothing', async () => {
    request.mockResolvedValueOnce({ userId: 'u_2' });
    await muteUser(PERSON);
    expect(request).toHaveBeenCalledWith('/api/safety/mutes', expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 'u_2' }) }));
    expect(JSON.parse(store[MUTES]).map((m: any) => m.mutedUserId)).toEqual(['u_2']);

    request.mockRejectedValueOnce(new Error('500'));
    await expect(muteUser({ ...PERSON, userId: 'u_3' })).rejects.toThrow();
    expect(JSON.parse(store[MUTES]).map((m: any) => m.mutedUserId)).toEqual(['u_2']);
  });

  it('unmuteUser deletes on the server before touching the mirror', async () => {
    store[MUTES] = JSON.stringify([{ id: 'x', mutedUserId: 'u_2', mutedUserName: 'Two', mutedUserHandle: '', mutedUserInitials: '', mutedUserColor: '', createdAt: '' }]);
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(unmuteUser('u_2')).rejects.toThrow();
    expect(JSON.parse(store[MUTES])).toHaveLength(1);
    request.mockResolvedValueOnce({ ok: true });
    await unmuteUser('u_2');
    expect(request).toHaveBeenLastCalledWith('/api/safety/mutes/u_2', { method: 'DELETE' });
    expect(JSON.parse(store[MUTES])).toHaveLength(0);
  });

  it('keeps the server authoritative without resurrecting a stale mute mirror', async () => {
    store[MUTES] = JSON.stringify([
      { id: 'a', mutedUserId: 'local_only', mutedUserName: 'L', mutedUserHandle: '', mutedUserInitials: '', mutedUserColor: '#222', createdAt: '' },
    ]);
    request.mockResolvedValueOnce({ mutes: [serverPerson('srv')] });
    const rows = await getMutedUsers();
    expect(rows.map((r) => r.mutedUserId)).toEqual(['srv']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);

    // Next load: no re-upload; offline falls back to the mirror.
    request.mockResolvedValueOnce({ mutes: [serverPerson('srv')] });
    expect((await getMutedUsers()).map((r) => r.mutedUserId)).toEqual(['srv']);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockRejectedValueOnce(new Error('offline'));
    expect((await getMutedUsers()).map((r) => r.mutedUserId)).toEqual(['srv']);
  });
});

describe('restrict', () => {
  it('restrictUser posts to the server and lists come from the server', async () => {
    store['bt:social:user_1:restricts:migrated:v1'] = 'true';
    request.mockResolvedValueOnce({ userId: 'u_2' });
    await restrictUser(PERSON);
    expect(request).toHaveBeenCalledWith('/api/safety/restrictions', expect.objectContaining({ method: 'POST' }));
    request.mockResolvedValueOnce({ restrictions: [serverPerson('u_2')] });
    expect((await getRestrictedUsers()).map((r) => r.restrictedUserId)).toEqual(['u_2']);
  });
});

describe('privacy settings', () => {
  it('loads enforced values from the server and saves only server keys through PATCH /api/auth/privacy', async () => {
    let settings = { searchable: false, whoCanSeeFriendsList: 'everyone', readReceiptsEnabled: true };
    request.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
      if (path === '/api/auth/privacy') {
        if (init?.method === 'PATCH') settings = { ...settings, ...JSON.parse(init.body!).settings };
        return { dmPrivacy: 'requests', isPrivate: false, settings };
      }
      return { settings: { socialPrivacy: settings }, updatedAt: '2026-10-17T00:00:00Z' };
    });
    const loaded = await getPrivacySettings();
    expect(loaded).toMatchObject({ searchable: false, whoCanSeeFriendsList: 'everyone', profileVisibility: 'public' });

    const saved = await updatePrivacySettings({ readReceiptsEnabled: false, searchable: true, contactDiscovery: true });
    const [path, init] = request.mock.calls.find(([path, init]) => path === '/api/auth/privacy' && init?.method === 'PATCH')!;
    expect(path).toBe('/api/auth/privacy');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ settings: { readReceiptsEnabled: false, searchable: true } });
    expect(saved).toMatchObject({ readReceiptsEnabled: false, searchable: true, contactDiscovery: true });
  });

  it('a failed save throws and leaves the cache unchanged', async () => {
    request.mockRejectedValueOnce(new Error('500'));
    await expect(updatePrivacySettings({ searchable: false })).rejects.toThrow();
    expect(store['bt:social:user_1:privacy:v1']).toBeUndefined();
  });
});
