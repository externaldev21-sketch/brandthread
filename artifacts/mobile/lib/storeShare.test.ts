import { describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

import { displayStoreLink, hasSharedStore, markStoreShared, sellerStoreLink } from './storeShare';

describe('sellerStoreLink', () => {
  it('builds the one storefront link from a valid username', () => {
    expect(sellerStoreLink('@Northline')).toBe('https://brandthread.app/u/northline');
  });

  it('gives no link without a valid username (never an invented slug)', () => {
    expect(sellerStoreLink(null)).toBeNull();
    expect(sellerStoreLink('ab')).toBeNull();
    expect(sellerStoreLink('')).toBeNull();
  });

  it('displays without the scheme', () => {
    expect(displayStoreLink('https://brandthread.app/u/northline')).toBe('brandthread.app/u/northline');
  });
});

describe('store shared flag', () => {
  it('is per user and off until marked', async () => {
    expect(await hasSharedStore('user_a')).toBe(false);
    await markStoreShared('user_a');
    expect(await hasSharedStore('user_a')).toBe(true);
    expect(await hasSharedStore('user_b')).toBe(false);
    expect(await hasSharedStore(null)).toBe(false);
  });
});
