import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const gate: { release: (() => void) | null } = { release: null };

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    // Reads see the disk as it was when they started, but only resolve when
    // the test releases them, so a fresh write can land first.
    getItem: vi.fn((k: string) => new Promise((resolve) => {
      const value = store.get(k) ?? null;
      gate.release = () => resolve(value);
    })),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    getAllKeys: vi.fn(async () => [...store.keys()]),
    multiRemove: vi.fn(async (ks: string[]) => { ks.forEach((k) => store.delete(k)); }),
  },
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0' } } }));

import {
  clearTabDataCacheForUser, getCachedTabData, hydrateTabData, initTabDataCache, setCachedTabData,
} from './tabDataCache';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('tabDataCache hydrate races (audit)', () => {
  beforeEach(() => {
    store.clear();
    gate.release = null;
  });

  it('a slow disk read never overwrites a fresher in-memory write', async () => {
    initTabDataCache('u-race');
    // Seed an old snapshot on disk under this account's key.
    setCachedTabData('inbox', { v: 'old' });
    await flush();
    const diskKey = [...store.keys()].find((k) => k.endsWith('u-race:inbox'))!;
    // Forget memory (as on a cold start) by switching scope away and back on a new key.
    initTabDataCache('u-race-2');
    store.set(diskKey.replace('u-race:', 'u-race-2:'), JSON.stringify({ v: 'old' }));

    const pending = hydrateTabData<{ v: string }>('inbox');
    await flush();
    // The network load finishes before the disk read comes back.
    setCachedTabData('inbox', { v: 'fresh' });
    gate.release?.();
    await expect(pending).resolves.toEqual({ v: 'fresh' });
    expect(getCachedTabData('inbox')).toEqual({ v: 'fresh' });
  });

  it('a disk read in flight during sign-out does not bring the cleared data back', async () => {
    initTabDataCache('u-out');
    const keyPrefix = 'bt_tab_data_cache_v1_';
    // Write the payload straight to disk so memory is empty.
    setCachedTabData('discover:people', { v: 'mine' });
    await flush();
    const diskKey = [...store.keys()].find((k) => k.startsWith(keyPrefix) && k.endsWith('u-out:discover:people'))!;
    initTabDataCache('u-out-2');
    const key2 = diskKey.replace('u-out:', 'u-out-2:');
    store.set(key2, JSON.stringify({ v: 'mine' }));

    const pending = hydrateTabData('discover:people');
    await flush();
    await clearTabDataCacheForUser('u-out-2');
    gate.release?.();
    await pending;
    expect(getCachedTabData('discover:people')).toBeUndefined();
  });
});
