import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { store.delete(k); }),
    multiGet: vi.fn(async (ks: string[]) => ks.map((k) => [k, store.get(k) ?? null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => store.set(k, v)); }),
  },
}));

import { __resetAccountStorageForTests, setAccountStorageScope } from './accountStorage';
import { loadStoredStyleBadge, saveStyleBadge, STYLE_BADGE_LABEL_KEY } from './styleBadge';

describe('loadStoredStyleBadge (audit)', () => {
  beforeEach(() => {
    store.clear();
    __resetAccountStorageForTests();
  });

  it('returns the badge this account saved (stored under its scoped keys)', async () => {
    setAccountStorageScope('u1');
    await saveStyleBadge({ label: 'Gorpcore', emoji: '🥾', enabled: false });
    expect(await loadStoredStyleBadge()).toEqual({ label: 'Gorpcore', emoji: '🥾', enabled: false });
  });

  it('returns null when this account never saved one', async () => {
    setAccountStorageScope('u2');
    expect(await loadStoredStyleBadge()).toBeNull();
  });

  it('still finds a pre-scoping (device-wide) badge, which the account claims', async () => {
    store.set(STYLE_BADGE_LABEL_KEY, 'Old label');
    setAccountStorageScope('u3');
    expect(await loadStoredStyleBadge()).toMatchObject({ label: 'Old label' });
  });

  it("never shows another account's badge", async () => {
    setAccountStorageScope('u1');
    await saveStyleBadge({ label: 'Mine', emoji: '🎞️', enabled: true });
    setAccountStorageScope('u4');
    expect(await loadStoredStyleBadge()).toBeNull();
  });
});
