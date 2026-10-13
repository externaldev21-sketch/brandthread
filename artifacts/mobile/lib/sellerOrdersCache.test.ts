import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  },
}));

import { initTabDataCache } from './tabDataCache';
import { readSellerOrdersCache, saveSellerOrdersCache, SELLER_ORDERS_CACHE_LIMIT } from './sellerOrdersCache';

describe('seller orders offline cache', () => {
  beforeEach(() => initTabDataCache('seller_a'));

  it('returns nothing before the first successful load', async () => {
    initTabDataCache('seller_new');
    expect(await readSellerOrdersCache()).toBeUndefined();
  });

  it('keeps the newest orders up to the limit', async () => {
    const rows = Array.from({ length: SELLER_ORDERS_CACHE_LIMIT + 50 }, (_, i) => ({ id: `o${i}` }));
    saveSellerOrdersCache(rows);
    const cached = await readSellerOrdersCache<{ id: string }>();
    expect(cached).toHaveLength(SELLER_ORDERS_CACHE_LIMIT);
    expect(cached?.[0]?.id).toBe('o0');
  });

  it('never shows one account another account\'s orders', async () => {
    saveSellerOrdersCache([{ id: 'mine' }]);
    initTabDataCache('seller_b');
    expect(await readSellerOrdersCache()).toBeUndefined();
  });

  it('ignores non-array payloads and empty lists', async () => {
    initTabDataCache('seller_c');
    saveSellerOrdersCache({ error: 'nope' });
    saveSellerOrdersCache([]);
    expect(await readSellerOrdersCache()).toBeUndefined();
  });
});
