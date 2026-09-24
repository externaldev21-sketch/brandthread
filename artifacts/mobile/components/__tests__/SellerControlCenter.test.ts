/**
 * Seller Control Center — pure-logic + route-coverage tests
 *
 * Pure-logic tests run in vitest's node environment (no react-native render
 * tree needed) against @/lib/sellerControlCenter directly.
 *
 * Covers:
 * 1.  Default pinned shortcuts: Add product, Orders, Post video, Payouts
 * 2.  Pin / unpin / reorder are pure and immutable
 * 3.  Persistence key is scoped to the authenticated Clerk user ID
 * 4.  Account switch: loads correct pins per user, does not mix users
 * 5.  Save/load failure handling
 * 6.  Search matches label and description
 * 7.  Every section item has a unique id, icon and label
 * 8.  Growth studio tools preserved (still gated, same six destinations)
 * 9.  Route existence — every item's route resolves to a real file under app/
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ─── Mock AsyncStorage ────────────────────────────────────────────────────────

const asyncStorageStore: Record<string, string> = {};

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageStore[key] ?? null),
    setItem: vi.fn(async (key: string, value: string) => { asyncStorageStore[key] = value; }),
    removeItem: vi.fn(async (key: string) => { delete asyncStorageStore[key]; }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ALL_ITEMS,
  DEFAULT_PINNED_IDS,
  MAX_PINNED,
  SECTIONS,
  findItem,
  loadPinnedIds,
  movePinned,
  pinItem,
  pinnedStorageKey,
  routeToAppFilePaths,
  savePinnedIds,
  searchItems,
  unpinItem,
} from '@/lib/sellerControlCenter';

function clearStore() {
  Object.keys(asyncStorageStore).forEach((k) => delete asyncStorageStore[k]);
}

// ─── 1. Default pinned shortcuts ───────────────────────────────────────────────

describe('Default pinned shortcuts', () => {
  it('defaults to Add product, Orders, Post video, Payouts in that order', () => {
    expect(DEFAULT_PINNED_IDS).toEqual(['add-product', 'orders', 'post-video', 'payouts']);
  });

  it('every default id resolves to a real item', () => {
    DEFAULT_PINNED_IDS.forEach((id) => {
      expect(findItem(id), `missing item for default pin "${id}"`).toBeTruthy();
    });
  });

  it('labels match the spec', () => {
    expect(findItem('add-product')?.label).toBe('Add product');
    expect(findItem('orders')?.label).toBe('Orders');
    expect(findItem('post-video')?.label).toBe('Post video');
    expect(findItem('payouts')?.label).toBe('Payouts');
  });
});

// ─── 2. Pin / unpin / reorder ──────────────────────────────────────────────────

describe('Pin / unpin / reorder — pure array helpers', () => {
  it('pinItem appends a new id without mutating the input', () => {
    const before = ['orders'];
    const after = pinItem(before, 'inventory');
    expect(after).toEqual(['orders', 'inventory']);
    expect(before).toEqual(['orders']); // unmutated
  });

  it('pinItem is a no-op when already pinned', () => {
    expect(pinItem(['orders'], 'orders')).toEqual(['orders']);
  });

  it('pinItem is a no-op for an unknown id', () => {
    expect(pinItem(['orders'], 'not-a-real-item')).toEqual(['orders']);
  });

  it('pinItem refuses past MAX_PINNED', () => {
    const full = ALL_ITEMS.slice(0, MAX_PINNED).map((i) => i.id);
    const extra = ALL_ITEMS[MAX_PINNED].id;
    expect(pinItem(full, extra)).toEqual(full);
  });

  it('unpinItem removes the id and leaves order of the rest intact', () => {
    expect(unpinItem(['add-product', 'orders', 'payouts'], 'orders')).toEqual(['add-product', 'payouts']);
  });

  it('movePinned swaps with the left neighbor', () => {
    expect(movePinned(['a', 'b', 'c'], 1, 'left')).toEqual(['b', 'a', 'c']);
  });

  it('movePinned swaps with the right neighbor', () => {
    expect(movePinned(['a', 'b', 'c'], 1, 'right')).toEqual(['a', 'c', 'b']);
  });

  it('movePinned is a no-op at the left edge', () => {
    expect(movePinned(['a', 'b', 'c'], 0, 'left')).toEqual(['a', 'b', 'c']);
  });

  it('movePinned is a no-op at the right edge', () => {
    expect(movePinned(['a', 'b', 'c'], 2, 'right')).toEqual(['a', 'b', 'c']);
  });
});

// ─── 3. Persistence key scoping ────────────────────────────────────────────────

describe('Persistence key — account scope', () => {
  it('generates different keys for different user IDs', () => {
    expect(pinnedStorageKey('user_abc')).not.toBe(pinnedStorageKey('user_xyz'));
  });

  it('key includes a brandthread namespace prefix and the user id', () => {
    const key = pinnedStorageKey('user_clerk_12345');
    expect(key).toMatch(/^@brandthread\//);
    expect(key).toContain('user_clerk_12345');
  });
});

// ─── 4. Account switch ─────────────────────────────────────────────────────────

describe('Account switch — loads correct pins per user', () => {
  beforeEach(() => { clearStore(); vi.clearAllMocks(); });

  it('loads user A pins without mixing user B pins', async () => {
    await savePinnedIds('user_alice', ['payouts', 'inventory']);
    await savePinnedIds('user_bob', ['analytics']);

    expect(await loadPinnedIds('user_alice')).toEqual(['payouts', 'inventory']);
    expect(await loadPinnedIds('user_bob')).toEqual(['analytics']);
  });

  it('a user with no saved pins gets the defaults', async () => {
    expect(await loadPinnedIds('user_never_saved')).toEqual(DEFAULT_PINNED_IDS);
  });
});

// ─── 5. Save/load failure handling ────────────────────────────────────────────

describe('Save/load failure handling', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('savePinnedIds returns false when setItem throws', async () => {
    (AsyncStorage.setItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota exceeded'));
    expect(await savePinnedIds('user_fail', ['orders'])).toBe(false);
  });

  it('savePinnedIds returns true on success', async () => {
    clearStore();
    expect(await savePinnedIds('user_ok', ['orders'])).toBe(true);
  });

  it('loadPinnedIds falls back to defaults on parse error', async () => {
    asyncStorageStore[pinnedStorageKey('user_corrupt')] = 'not-json{{{';
    expect(await loadPinnedIds('user_corrupt')).toEqual(DEFAULT_PINNED_IDS);
  });

  it('loadPinnedIds falls back to defaults when getItem throws', async () => {
    (AsyncStorage.getItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('storage read error'));
    expect(await loadPinnedIds('user_read_fail')).toEqual(DEFAULT_PINNED_IDS);
  });

  it('loadPinnedIds drops unknown ids and falls back to defaults if none remain valid', async () => {
    asyncStorageStore[pinnedStorageKey('user_stale')] = JSON.stringify(['deleted-route-1', 'deleted-route-2']);
    expect(await loadPinnedIds('user_stale')).toEqual(DEFAULT_PINNED_IDS);
  });
});

// ─── 6. Search ─────────────────────────────────────────────────────────────────

describe('Search', () => {
  it('matches by label, case-insensitively', () => {
    expect(searchItems('orders').some((i) => i.id === 'orders')).toBe(true);
    expect(searchItems('ORDERS').some((i) => i.id === 'orders')).toBe(true);
  });

  it('matches by description', () => {
    expect(searchItems('coupon').some((i) => i.id === 'discounts')).toBe(true);
  });

  it('returns nothing for a blank query', () => {
    expect(searchItems('   ')).toEqual([]);
  });

  it('returns nothing for a query matching no item', () => {
    expect(searchItems('zzzznotarealtoolzzzz')).toEqual([]);
  });
});

// ─── 7. Item integrity ─────────────────────────────────────────────────────────

describe('Section/item integrity', () => {
  it('has the five requested groups: Sell, Grow, Money, Store, Support', () => {
    expect(SECTIONS.map((s) => s.title)).toEqual(['Sell', 'Grow', 'Money', 'Store', 'Support']);
  });

  it('every item id is unique across all sections', () => {
    const ids = ALL_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every item has a non-empty label, icon and route', () => {
    ALL_ITEMS.forEach((item) => {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
      expect(item.route.length).toBeGreaterThan(0);
    });
  });
});

// ─── 8. Growth studio tools preserved ──────────────────────────────────────────

describe('Growth studio tools — still present and gated', () => {
  const expectedLabels = [
    'Design Studio',
    'Mockup to Model',
    'Remove Background',
    'AI Design',
    'Create Ad',
    'AI Photoshoot',
  ];

  it('all six growth tools are reachable from the control center', () => {
    expectedLabels.forEach((label) => {
      const item = ALL_ITEMS.find((i) => i.label === label);
      expect(item, `missing growth tool "${label}"`).toBeTruthy();
      expect(item?.growthOnly).toBe(true);
    });
  });
});

// ─── 9. Route existence ────────────────────────────────────────────────────────

describe('Route existence — every item routes to a real screen', () => {
  const appRoot = path.resolve(__dirname, '../../app');

  it('every ALL_ITEMS route resolves to a file under app/', () => {
    const missing: string[] = [];
    for (const item of ALL_ITEMS) {
      const candidates = routeToAppFilePaths(item.route);
      const found = candidates.some((rel) =>
        fs.existsSync(path.resolve(appRoot, '..', rel)),
      );
      if (!found) missing.push(`${item.id} → ${item.route} (tried: ${candidates.join(', ')})`);
    }
    expect(missing, `missing route files:\n${missing.join('\n')}`).toEqual([]);
  });
});
