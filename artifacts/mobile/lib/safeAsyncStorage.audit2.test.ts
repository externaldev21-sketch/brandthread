/**
 * One failing call (say a quota error on a write) used to flip a module-wide
 * "blocked" flag, after which every read went to the in-memory map only — so
 * keys persisted earlier read as missing for the rest of the session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const disk = vi.hoisted(() => new Map<string, string>());
const fail = vi.hoisted(() => ({ set: false, get: false, remove: false }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => { if (fail.get) throw new Error('blocked'); return disk.get(k) ?? null; }),
    setItem: vi.fn(async (k: string, v: string) => { if (fail.set) throw new Error('QuotaExceededError'); disk.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { if (fail.remove) throw new Error('blocked'); disk.delete(k); }),
  },
}));

import { __resetSafeStorageForTests, safeGetItem, safeRemoveItem, safeSetItem } from './safeAsyncStorage';

beforeEach(() => {
  disk.clear();
  fail.set = fail.get = fail.remove = false;
  __resetSafeStorageForTests();
});

describe('safeAsyncStorage falls back per call', () => {
  it('a failed write does not hide keys persisted earlier', async () => {
    disk.set('persisted', 'yes');
    fail.set = true;
    await safeSetItem('big', 'x');
    fail.set = false;
    expect(await safeGetItem('persisted')).toBe('yes');
    expect(await safeGetItem('big')).toBe('x');
  });

  it('a key whose write failed reads this tab\'s newer value, not the stale stored one', async () => {
    disk.set('k', 'old');
    fail.set = true;
    await safeSetItem('k', 'new');
    expect(await safeGetItem('k')).toBe('new');
  });

  it('a failed remove does not resurrect the stored value', async () => {
    disk.set('k', 'old');
    fail.remove = true;
    await safeRemoveItem('k');
    expect(await safeGetItem('k')).toBeNull();
  });

  it('writes reach storage again after a transient failure', async () => {
    fail.set = true;
    await safeSetItem('a', '1');
    fail.set = false;
    await safeSetItem('b', '2');
    expect(disk.get('b')).toBe('2');
  });

  it('a throwing read still answers from this tab\'s writes', async () => {
    await safeSetItem('k', 'v');
    fail.get = true;
    expect(await safeGetItem('k')).toBe('v');
  });
});
