/**
 * Account-following settings:
 * - lib/accountStorage: per-account keys, one-time legacy claim/drop.
 * - lib/buyerSettings: per-account cache, server wins on load (except unsent
 *   local changes), debounced PATCH of synced keys only, retry on next load,
 *   no network signed out.
 * - lib/engagementRetryQueue: per-account queue, legacy queue dropped.
 * - socialService: privacy fields through /api/me/settings, blocks hydrated
 *   from GET /api/social/blocks.
 * - lib/shoppingPreferences: style interests merge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
    multiGet: (keys: string[]) => Promise.resolve(keys.map((k) => [k, store[k] ?? null])),
    multiSet: (pairs: [string, string][]) => { pairs.forEach(([k, v]) => { store[k] = v; }); return Promise.resolve(); },
    multiRemove: (keys: string[]) => { keys.forEach((k) => delete store[k]); return Promise.resolve(); },
    getAllKeys: () => Promise.resolve(Object.keys(store)),
  },
}));
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: request }));

import {
  __resetAccountStorageForTests, accountStorageKey, adoptLegacyKey, setAccountStorageScope,
} from '@/lib/accountStorage';
import { __resetAccountSettingsForTests } from '@/lib/accountSettings';
import {
  __resetBuyerSettingsForTests, applyServerBuyerSettings, buildSettingsPatch, changedSyncedKeys,
  DEFAULT_BUYER_SETTINGS, flushBuyerSettings, loadBuyerSettings, patchBuyerSettings,
} from '@/lib/buyerSettings';
import {
  __resetEngagementRetryQueueForTests, enqueueEngagementRetry, getQueuedEngagementActions,
} from '@/lib/engagementRetryQueue';
import {
  applyServerPrivacy, clearSocialCache, getBlockedUsers, getPrivacySettings, initSocialService, updatePrivacySettings,
} from '@/services/socialService';
import { DEFAULT_PRIVACY_SETTINGS } from '@/services/socialTypes';
import { loadStyleBadge, saveStyleBadge } from '@/lib/styleBadge';
import { mergeStyleInterests, selectedCategoriesFromInterests } from '@/lib/shoppingPreferences';
import { ApiError } from '@/lib/networkNotice';

const LEGACY_SETTINGS = 'brandthread_buyer_settings_v2';
const settingsKey = (uid: string) => accountStorageKey(LEGACY_SETTINGS, uid);

function signIn(uid: string | null) {
  setAccountStorageScope(uid);
  initSocialService(uid);
}

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  request.mockReset();
  __resetAccountStorageForTests();
  __resetAccountSettingsForTests();
  __resetBuyerSettingsForTests();
  __resetEngagementRetryQueueForTests();
  initSocialService(null);
});

describe('accountStorage', () => {
  it('scopes keys per account and claims a legacy key exactly once', async () => {
    store.legacy = 'A-data';
    await adoptLegacyKey('legacy', 'claim', 'anon'); // never claims into the anonymous scope
    expect(store.legacy).toBe('A-data');
    await adoptLegacyKey('legacy', 'claim', 'user_a');
    expect(store[accountStorageKey('legacy', 'user_a')]).toBe('A-data');
    expect(store.legacy).toBeUndefined();
    __resetAccountStorageForTests();
    await adoptLegacyKey('legacy', 'claim', 'user_b');
    expect(store[accountStorageKey('legacy', 'user_b')]).toBeUndefined();
  });

  it('does not overwrite an account that already has scoped data; drop never copies', async () => {
    store.legacy = 'old';
    store[accountStorageKey('legacy', 'user_a')] = 'mine';
    await adoptLegacyKey('legacy', 'claim', 'user_a');
    expect(store[accountStorageKey('legacy', 'user_a')]).toBe('mine');
    store.other = 'queued';
    await adoptLegacyKey('other', 'drop', 'user_a');
    expect(store.other).toBeUndefined();
    expect(store[accountStorageKey('other', 'user_a')]).toBeUndefined();
  });

  it('style badge is per account', async () => {
    signIn('user_a');
    await saveStyleBadge({ label: 'Y2K', emoji: '✨', enabled: false });
    signIn('user_b');
    expect((await loadStyleBadge()).label).toBe('Archive Fashion');
    signIn('user_a');
    expect(await loadStyleBadge()).toEqual({ label: 'Y2K', emoji: '✨', enabled: false });
  });
});

describe('buyerSettings merge helpers', () => {
  it('server wins for keys it holds, except pending ones and invalid types', () => {
    const local = { ...DEFAULT_BUYER_SETTINGS, dataSaver: true, theme: 'dark' as const, captions: false };
    const merged = applyServerBuyerSettings(local, { dataSaver: false, theme: 'light', captions: 'yes', sizeTops: 'XL' }, ['theme']);
    expect(merged.dataSaver).toBe(false);
    expect(merged.theme).toBe('dark'); // unsent local change kept
    expect(merged.captions).toBe(false); // wrong type ignored
    expect(merged.sizeTops).toBe(DEFAULT_BUYER_SETTINGS.sizeTops); // sizes never come from settings
  });

  it('only synced keys are diffed and sent', () => {
    const next = { ...DEFAULT_BUYER_SETTINGS, dataSaver: true, sizeTops: 'XL', dropAlerts: false, biometricLock: true };
    expect(changedSyncedKeys(DEFAULT_BUYER_SETTINGS, next)).toEqual(['dataSaver']);
    expect(buildSettingsPatch(next, ['dataSaver', 'sizeTops', 'biometricLock'])).toEqual({ dataSaver: true });
  });
});

describe('buyerSettings sync', () => {
  it('signed out: local only, no network, never sees an account cache', async () => {
    store[settingsKey('user_a')] = JSON.stringify({ dataSaver: true });
    signIn(null);
    expect((await loadBuyerSettings()).dataSaver).toBe(false);
    await patchBuyerSettings({ captions: false });
    await flushBuyerSettings();
    expect(request).not.toHaveBeenCalled();
    expect(JSON.parse(store[settingsKey('anon')]).captions).toBe(false);
  });

  it('legacy device-wide settings go to the first signed-in account only', async () => {
    store[LEGACY_SETTINGS] = JSON.stringify({ ...DEFAULT_BUYER_SETTINGS, reduceMotion: true });
    signIn('user_a');
    request.mockResolvedValueOnce({ settings: {}, updatedAt: null });
    expect((await loadBuyerSettings()).reduceMotion).toBe(true);
    expect(store[LEGACY_SETTINGS]).toBeUndefined();
    signIn('user_b');
    request.mockResolvedValueOnce({ settings: {}, updatedAt: null });
    expect((await loadBuyerSettings()).reduceMotion).toBe(false);
    // Claimed legacy values are a local fallback only — never pushed as a change.
    expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('load: server copy wins and is cached per account', async () => {
    signIn('user_a');
    store[settingsKey('user_a')] = JSON.stringify({ ...DEFAULT_BUYER_SETTINGS, dataSaver: true });
    request.mockResolvedValueOnce({ settings: { dataSaver: false, theme: 'dark' }, updatedAt: '2026-01-01' });
    const s = await loadBuyerSettings();
    expect(request.mock.calls[0][0]).toBe('/api/me/settings');
    expect([s.dataSaver, s.theme]).toEqual([false, 'dark']);
    expect(JSON.parse(store[settingsKey('user_a')]).theme).toBe('dark');
    // Fresh for a minute: no second GET.
    await loadBuyerSettings();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('save: local first, then one PATCH with the synced keys that changed', async () => {
    signIn('user_a');
    request.mockResolvedValue({ settings: {}, updatedAt: null });
    await patchBuyerSettings({ dataSaver: true, sizeShoes: '12', dropAlerts: false });
    await patchBuyerSettings({ theme: 'light' });
    expect(JSON.parse(store[settingsKey('user_a')]).dataSaver).toBe(true);
    await flushBuyerSettings('user_a');
    const patches = request.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0][1].body)).toEqual({ dataSaver: true, theme: 'light' });
    expect(store[`${settingsKey('user_a')}:pending`]).toBeUndefined();
  });

  it('a failed PATCH stays pending, survives the next load, and is retried', async () => {
    signIn('user_a');
    request.mockRejectedValueOnce(new Error('offline'));
    await patchBuyerSettings({ captions: false });
    await flushBuyerSettings('user_a');
    expect(JSON.parse(store[`${settingsKey('user_a')}:pending`])).toEqual(['captions']);

    // Server still has the old value: the unsent local change must win.
    request.mockResolvedValueOnce({ settings: { captions: true }, updatedAt: null });
    expect((await loadBuyerSettings()).captions).toBe(false);
    request.mockResolvedValueOnce({ settings: { captions: false }, updatedAt: null });
    await flushBuyerSettings('user_a');
    const last = request.mock.calls[request.mock.calls.length - 1];
    expect(last[1].method).toBe('PATCH');
    expect(JSON.parse(last[1].body)).toEqual({ captions: false });
    expect(store[`${settingsKey('user_a')}:pending`]).toBeUndefined();
  });

  it('a validation rejection is not retried forever', async () => {
    signIn('user_a');
    request.mockRejectedValueOnce(new ApiError(400, '{"error":"Invalid settings"}'));
    await patchBuyerSettings({ language: 'x'.repeat(80) });
    await flushBuyerSettings('user_a');
    expect(store[`${settingsKey('user_a')}:pending`]).toBeUndefined();
  });

  it('accounts on one device never share settings', async () => {
    signIn('user_a');
    request.mockResolvedValue({ settings: {}, updatedAt: null });
    await patchBuyerSettings({ dataSaver: true });
    signIn('user_b');
    expect((await loadBuyerSettings()).dataSaver).toBe(false);
  });
});

describe('engagementRetryQueue scoping', () => {
  it('drops the legacy device-wide queue and keeps one queue per account', async () => {
    store['bt:engagement-retry-queue:v1'] = JSON.stringify([{ id: 'like:p1', kind: 'like', targetId: 'p1', attempts: 0, createdAt: 1 }]);
    signIn('user_a');
    await enqueueEngagementRetry({ kind: 'like', targetId: 'p2' });
    expect(getQueuedEngagementActions().map((a) => a.targetId)).toEqual(['p2']);
    expect(store['bt:engagement-retry-queue:v1']).toBeUndefined();
    signIn('user_b');
    await enqueueEngagementRetry({ kind: 'save', targetId: 'p3' });
    expect(getQueuedEngagementActions().map((a) => a.targetId)).toEqual(['p3']);
    expect(JSON.parse(store[accountStorageKey('bt:engagement-retry-queue:v1', 'user_a')]).map((a: any) => a.targetId)).toEqual(['p2']);
  });
});

describe('socialService privacy + blocks', () => {
  it('applyServerPrivacy keeps DM privacy local and ignores bad values', () => {
    const merged = applyServerPrivacy(DEFAULT_PRIVACY_SETTINGS, {
      whoCanSeePosts: 'friends', searchable: 'no', whoCanMessageMe: 'followers_only',
    });
    expect(merged.whoCanSeePosts).toBe('friends');
    expect(merged.searchable).toBe(DEFAULT_PRIVACY_SETTINGS.searchable);
    expect(merged.whoCanMessageMe).toBe(DEFAULT_PRIVACY_SETTINGS.whoCanMessageMe);
  });

  it('privacy changes go to /api/me/settings and the server copy hydrates a new device', async () => {
    signIn('user_a');
    request.mockResolvedValueOnce({ settings: {}, updatedAt: null });
    await updatePrivacySettings({ whoCanMention: 'nobody', whoCanMessageMe: 'followers_only' });
    const [path, init] = request.mock.calls[0];
    expect(path).toBe('/api/me/settings');
    const body = JSON.parse(init.body);
    expect(body.socialPrivacy.whoCanMention).toBe('nobody');
    expect(body.socialPrivacy.whoCanMessageMe).toBeUndefined();

    // After the local cache is wiped (account switch / another device), the server copy hydrates it.
    await clearSocialCache('user_a');
    __resetAccountSettingsForTests();
    request.mockResolvedValueOnce({ settings: { socialPrivacy: { whoCanMention: 'nobody' } }, updatedAt: null });
    expect((await getPrivacySettings()).whoCanMention).toBe('nobody');
  });

  it('signed out privacy and blocks never hit the network', async () => {
    signIn(null);
    await updatePrivacySettings({ whoCanMention: 'nobody' });
    expect((await getPrivacySettings()).whoCanMention).toBe('nobody');
    expect(await getBlockedUsers()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('blocks list is hydrated from the server (server wins)', async () => {
    signIn('user_a');
    store['bt:social:user_a:blocks:v1'] = JSON.stringify([{ id: 'x', blockedUserId: 'stale', blockedUserName: 'Stale', blockedUserHandle: '', blockedUserInitials: 'S', blockedUserColor: '#000', createdAt: '2020-01-01T00:00:00.000Z' }]);
    request.mockResolvedValueOnce([{ userId: 'u9', name: 'Nine', handle: '@nine', initials: 'N', color: '#3F3F46', blockedAt: '2026-01-02T00:00:00.000Z' }]);
    const blocks = await getBlockedUsers();
    expect(request.mock.calls[0][0]).toBe('/api/social/blocks?limit=100&offset=0');
    expect(blocks.map((b) => b.blockedUserId)).toEqual(['u9']);
    expect(JSON.parse(store['bt:social:user_a:blocks:v1']).map((b: any) => b.blockedUserId)).toEqual(['u9']);
    // Offline later: cached list is used (and no refetch within the minute).
    expect((await getBlockedUsers()).map((b) => b.blockedUserId)).toEqual(['u9']);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('shopping preferences helpers', () => {
  const cats = [{ key: 'streetwear', label: 'Streetwear' }, { key: 'y2k', label: 'Y2K' }];
  it('reads onboarding labels and keys case-insensitively', () => {
    expect(selectedCategoriesFromInterests(['Streetwear', 'Basics', 'y2k'], cats)).toEqual(['streetwear', 'y2k']);
  });
  it('replaces only the categories this screen owns', () => {
    expect(mergeStyleInterests(['Basics', 'Streetwear', 'Minimal'], ['y2k'], cats)).toEqual(['Basics', 'Minimal', 'y2k']);
  });
});
