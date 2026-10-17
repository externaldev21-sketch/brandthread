import { beforeEach, describe, expect, it, vi } from 'vitest';

const secure = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => secure.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => { secure.set(k, v); }),
  deleteItemAsync: vi.fn(async (k: string) => { secure.delete(k); }),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { resetTokenCacheForTests, setSaveLoginInfo, tokenCache } from './tokenCache';

beforeEach(() => { secure.clear(); resetTokenCacheForTests(); });

describe('Save login info', () => {
  it('persists the session token by default', async () => {
    await tokenCache.saveToken('__clerk_client_jwt', 'abc');
    expect(secure.get('__clerk_client_jwt')).toBe('abc');
  });

  it('when off, keeps the token in memory only so a restart signs out', async () => {
    await tokenCache.saveToken('__clerk_client_jwt', 'abc');
    await setSaveLoginInfo(false);
    expect(secure.has('__clerk_client_jwt')).toBe(false);
    expect(await tokenCache.getToken('__clerk_client_jwt')).toBe('abc');

    // Simulate a cold start: memory is gone, flag is persisted.
    resetTokenCacheForTests();
    expect(await tokenCache.getToken('__clerk_client_jwt')).toBeNull();
  });

  it('turning it back on writes the in-memory token back', async () => {
    await setSaveLoginInfo(false);
    await tokenCache.saveToken('__clerk_client_jwt', 'xyz');
    expect(secure.has('__clerk_client_jwt')).toBe(false);
    await setSaveLoginInfo(true);
    expect(secure.get('__clerk_client_jwt')).toBe('xyz');
  });
});
