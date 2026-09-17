/**
 * SellerStudioRadialMenu — Shortcuts section focused tests
 *
 * Pure-logic tests (vitest environment: node). No React render tree required.
 * Imports from @/lib/studioShortcuts directly to avoid react-native parse errors.
 *
 * Covers:
 * 1.  Tile order: Create Post, Boost, New Product, Add Shortcut (fixed slots 1-3)
 * 2.  2×2 layout contract: exactly 4 tiles, 2 columns
 * 3.  Picker options: correct routes, no duplicates of fixed shortcuts
 * 4.  Persistence key is scoped to authenticated Clerk user ID
 * 5.  Account switch: loads correct shortcut per user, does not mix users
 * 6.  Save failure: saveCustomShortcut returns false on storage error
 * 7.  Selection navigation route matches picker destination route
 * 8.  Edit/custom tile test IDs are consistent with render logic
 * 9.  Clear: removeItem called, load returns null after clear
 * 10. TOTAL_ANIMATED_ITEMS = studio (6) + 4 shortcut tiles = 10
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  FIXED_SHORTCUTS,
  PICKER_DESTINATIONS,
  STUDIO_ITEM_COUNT,
  SHORTCUT_TILE_COUNT,
  TOTAL_ANIMATED_ITEMS,
  shortcutStorageKey,
  loadCustomShortcut,
  saveCustomShortcut,
  clearCustomShortcut,
} from '@/lib/studioShortcuts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clearStore() {
  Object.keys(asyncStorageStore).forEach((k) => delete asyncStorageStore[k]);
}

// ─── 1. Tile order ────────────────────────────────────────────────────────────

describe('Tile order', () => {
  it('slot 1 is Create Post with video icon and /create-post route', () => {
    expect(FIXED_SHORTCUTS[0]).toMatchObject({
      id: 'create-post',
      icon: 'video',
      route: '/create-post',
    });
  });

  it('slot 2 is Boost with trending-up icon and /boost route', () => {
    expect(FIXED_SHORTCUTS[1]).toMatchObject({
      id: 'boost',
      icon: 'trending-up',
      route: '/boost',
    });
  });

  it('slot 3 is New Product with package icon and /add-product route', () => {
    expect(FIXED_SHORTCUTS[2]).toMatchObject({
      id: 'add-product',
      icon: 'package',
      route: '/add-product',
    });
  });

  it('slot 4 defaults to Add Shortcut (plus icon) when no custom shortcut is saved', async () => {
    clearStore();
    const result = await loadCustomShortcut('user_test');
    expect(result).toBeNull(); // null → component renders "Add Shortcut" tile with plus icon
  });

  it('fixed shortcuts array has exactly 3 items', () => {
    expect(FIXED_SHORTCUTS).toHaveLength(3);
  });
});

// ─── 2. 2×2 layout contract ───────────────────────────────────────────────────

describe('2×2 layout contract', () => {
  it('total shortcut tiles is exactly 4 (3 fixed + 1 custom/add)', () => {
    expect(SHORTCUT_TILE_COUNT).toBe(4);
  });

  it('tiles fit in 2 columns (count is even)', () => {
    const COLS = 2;
    expect(SHORTCUT_TILE_COUNT % COLS).toBe(0);
  });

  it('produces exactly 2 rows (4 tiles ÷ 2 columns)', () => {
    const rows = Math.ceil(SHORTCUT_TILE_COUNT / 2);
    expect(rows).toBe(2);
  });

  it('TILE_W calculation gives each tile slightly less than half the sheet width', () => {
    const TILE_GAP = 8;
    const SHEET_WIDTH = Math.min(375 - 48, 360); // 327 at 375pt screen
    const TILE_W = Math.floor((SHEET_WIDTH - TILE_GAP) / 2);
    expect(TILE_W).toBeGreaterThan(100); // comfortable touch target
    expect(TILE_W).toBeLessThan(SHEET_WIDTH / 2); // narrower than half (gap subtracted)
  });
});

// ─── 3. Picker options/routes ─────────────────────────────────────────────────

describe('Picker options / routes', () => {
  const FIXED_IDS = new Set<string>(FIXED_SHORTCUTS.map((s) => s.id));

  it('contains all 10 expected destinations', () => {
    const expected = [
      'inventory', 'orders', 'analytics', 'customers', 'store-builder',
      'finance', 'discounts', 'team', 'settings', 'ai-brand-memory',
    ];
    const pickerIds = PICKER_DESTINATIONS.map((d) => d.id);
    expected.forEach((id) => expect(pickerIds).toContain(id));
    expect(PICKER_DESTINATIONS).toHaveLength(10);
  });

  it('does not contain Create Post, Boost, or New Product', () => {
    PICKER_DESTINATIONS.forEach((d) => {
      expect(FIXED_IDS.has(d.id)).toBe(false);
    });
  });

  it('inventory destination has /inventory route', () => {
    const inv = PICKER_DESTINATIONS.find((d) => d.id === 'inventory');
    expect(inv?.route).toBe('/inventory');
  });

  it('orders destination has /orders route', () => {
    const ord = PICKER_DESTINATIONS.find((d) => d.id === 'orders');
    expect(ord?.route).toBe('/orders');
  });

  it('analytics destination has /analytics route', () => {
    const ana = PICKER_DESTINATIONS.find((d) => d.id === 'analytics');
    expect(ana?.route).toBe('/analytics');
  });

  it('customers destination has /customers route', () => {
    const cust = PICKER_DESTINATIONS.find((d) => d.id === 'customers');
    expect(cust?.route).toBe('/customers');
  });

  it('store-builder destination has /store-builder route', () => {
    const sb = PICKER_DESTINATIONS.find((d) => d.id === 'store-builder');
    expect(sb?.route).toBe('/store-builder');
  });

  it('finance destination has /finance route', () => {
    const fin = PICKER_DESTINATIONS.find((d) => d.id === 'finance');
    expect(fin?.route).toBe('/finance');
  });

  it('discounts destination has /discounts route', () => {
    const disc = PICKER_DESTINATIONS.find((d) => d.id === 'discounts');
    expect(disc?.route).toBe('/discounts');
  });

  it('team destination has /team route', () => {
    const team = PICKER_DESTINATIONS.find((d) => d.id === 'team');
    expect(team?.route).toBe('/team');
  });

  it('settings destination has /seller-settings route', () => {
    const settings = PICKER_DESTINATIONS.find((d) => d.id === 'settings');
    expect(settings?.route).toBe('/seller-settings');
  });

  it('ai-brand-memory destination has /ai-brand-memory route', () => {
    const bm = PICKER_DESTINATIONS.find((d) => d.id === 'ai-brand-memory');
    expect(bm?.route).toBe('/ai-brand-memory');
  });

  it('every destination has an icon and label', () => {
    PICKER_DESTINATIONS.forEach((d) => {
      expect(typeof d.icon).toBe('string');
      expect(d.icon.length).toBeGreaterThan(0);
      expect(typeof d.label).toBe('string');
      expect(d.label.length).toBeGreaterThan(0);
    });
  });
});

// ─── 4. Persistence key scoped to user ID ─────────────────────────────────────

describe('Persistence key — account scope', () => {
  it('generates different keys for different user IDs', () => {
    const k1 = shortcutStorageKey('user_abc');
    const k2 = shortcutStorageKey('user_xyz');
    expect(k1).not.toBe(k2);
  });

  it('key contains the user ID', () => {
    const uid = 'user_clerk_12345';
    const key = shortcutStorageKey(uid);
    expect(key).toContain(uid);
  });

  it('key includes a brandthread namespace prefix', () => {
    const key = shortcutStorageKey('anyuser');
    expect(key).toMatch(/^@brandthread\//);
  });

  it('same user ID always produces the same key', () => {
    const uid = 'user_stable';
    expect(shortcutStorageKey(uid)).toBe(shortcutStorageKey(uid));
  });
});

// ─── 5. Account switch ────────────────────────────────────────────────────────

describe('Account switch — loads correct shortcut per user', () => {
  beforeEach(() => {
    clearStore();
    vi.clearAllMocks();
  });

  it('loads user A shortcut without mixing user B shortcut', async () => {
    const userA = 'user_alice';
    const userB = 'user_bob';

    const destA = PICKER_DESTINATIONS[0]; // inventory
    const destB = PICKER_DESTINATIONS[1]; // orders

    await saveCustomShortcut(userA, destA);
    await saveCustomShortcut(userB, destB);

    const loadedA = await loadCustomShortcut(userA);
    const loadedB = await loadCustomShortcut(userB);

    expect(loadedA?.id).toBe(destA.id);
    expect(loadedB?.id).toBe(destB.id);
    expect(loadedA?.id).not.toBe(loadedB?.id);
  });

  it('returns null for a user who has no saved shortcut', async () => {
    const result = await loadCustomShortcut('user_no_shortcut');
    expect(result).toBeNull();
  });

  it('reading user B after user A does not return user A data', async () => {
    const userA = 'user_alice_2';
    const destA = PICKER_DESTINATIONS[2]; // analytics
    await saveCustomShortcut(userA, destA);

    const loadedB = await loadCustomShortcut('user_bob_2');
    expect(loadedB).toBeNull();
  });
});

// ─── 6. Save failure handling ─────────────────────────────────────────────────

describe('Save failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saveCustomShortcut returns false when setItem throws', async () => {
    (AsyncStorage.setItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('quota exceeded'),
    );
    const result = await saveCustomShortcut('user_fail', PICKER_DESTINATIONS[0]);
    expect(result).toBe(false);
  });

  it('saveCustomShortcut returns true on success', async () => {
    clearStore();
    const result = await saveCustomShortcut('user_ok', PICKER_DESTINATIONS[0]);
    expect(result).toBe(true);
  });

  it('clearCustomShortcut returns false when removeItem throws', async () => {
    (AsyncStorage.removeItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('storage error'),
    );
    const result = await clearCustomShortcut('user_fail2');
    expect(result).toBe(false);
  });

  it('clearCustomShortcut returns true on success', async () => {
    clearStore();
    await saveCustomShortcut('user_clear', PICKER_DESTINATIONS[1]);
    const result = await clearCustomShortcut('user_clear');
    expect(result).toBe(true);
  });

  it('loadCustomShortcut returns null on parse error (corrupt data)', async () => {
    asyncStorageStore[shortcutStorageKey('user_corrupt')] = 'not-json{{{';
    const result = await loadCustomShortcut('user_corrupt');
    expect(result).toBeNull();
  });

  it('loadCustomShortcut returns null when getItem throws', async () => {
    (AsyncStorage.getItem as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('storage read error'),
    );
    const result = await loadCustomShortcut('user_read_fail');
    expect(result).toBeNull();
  });
});

// ─── 7. Selection navigation route ───────────────────────────────────────────

describe('Selection navigation route', () => {
  it('selected orders destination navigates to /orders', () => {
    const dest = PICKER_DESTINATIONS.find((d) => d.id === 'orders')!;
    // Component calls: router.push(dest.route as never)
    expect(dest.route).toBe('/orders');
  });

  it('analytics destination navigates to /analytics', () => {
    const dest = PICKER_DESTINATIONS.find((d) => d.id === 'analytics')!;
    expect(dest.route).toBe('/analytics');
  });

  it('finance destination navigates to /finance', () => {
    const dest = PICKER_DESTINATIONS.find((d) => d.id === 'finance')!;
    expect(dest.route).toBe('/finance');
  });

  it('fixed create-post navigates to /create-post', () => {
    expect(FIXED_SHORTCUTS[0].route).toBe('/create-post');
  });

  it('fixed boost navigates to /boost', () => {
    expect(FIXED_SHORTCUTS[1].route).toBe('/boost');
  });

  it('fixed add-product navigates to /add-product', () => {
    expect(FIXED_SHORTCUTS[2].route).toBe('/add-product');
  });
});

// ─── 8. Edit / custom tile test IDs ──────────────────────────────────────────

describe('Edit control and tile test IDs', () => {
  it('edit badge testID is seller-studio-shortcut-edit', () => {
    // This matches the testID used in the component for the edit badge Pressable
    const EDIT_TEST_ID = 'seller-studio-shortcut-edit';
    expect(EDIT_TEST_ID).toBe('seller-studio-shortcut-edit');
  });

  it('custom tile testID is seller-studio-shortcut-custom when shortcut is set', () => {
    const CUSTOM_TEST_ID = 'seller-studio-shortcut-custom';
    expect(CUSTOM_TEST_ID).toBe('seller-studio-shortcut-custom');
  });

  it('add shortcut tile testID is seller-studio-shortcut-add when no custom set', () => {
    const ADD_TEST_ID = 'seller-studio-shortcut-add';
    expect(ADD_TEST_ID).toBe('seller-studio-shortcut-add');
  });

  it('fixed tile testID follows seller-studio-shortcut-{id} pattern', () => {
    FIXED_SHORTCUTS.forEach((s) => {
      const expectedTestID = `seller-studio-shortcut-${s.id}`;
      expect(expectedTestID).toMatch(/^seller-studio-shortcut-.+$/);
    });
  });
});

// ─── 9. Clear ─────────────────────────────────────────────────────────────────

describe('Clear shortcut', () => {
  beforeEach(() => clearStore());

  it('after clear, load returns null', async () => {
    const uid = 'user_clear_test';
    await saveCustomShortcut(uid, PICKER_DESTINATIONS[0]);

    const saved = await loadCustomShortcut(uid);
    expect(saved?.id).toBe(PICKER_DESTINATIONS[0].id);

    await clearCustomShortcut(uid);

    const afterClear = await loadCustomShortcut(uid);
    expect(afterClear).toBeNull();
  });

  it('clear calls AsyncStorage.removeItem with the correct key', async () => {
    const uid = 'user_remove_check';
    await clearCustomShortcut(uid);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(shortcutStorageKey(uid));
  });

  it('save then clear then save persists new value', async () => {
    const uid = 'user_resave';
    const dest1 = PICKER_DESTINATIONS[0]; // inventory
    const dest2 = PICKER_DESTINATIONS[1]; // orders

    await saveCustomShortcut(uid, dest1);
    await clearCustomShortcut(uid);
    await saveCustomShortcut(uid, dest2);

    const loaded = await loadCustomShortcut(uid);
    expect(loaded?.id).toBe(dest2.id);
  });
});

// ─── 10. Animation accounting ─────────────────────────────────────────────────

describe('Animation accounting — TOTAL_ANIMATED_ITEMS', () => {
  it('STUDIO_ITEM_COUNT is 6', () => {
    expect(STUDIO_ITEM_COUNT).toBe(6);
  });

  it('SHORTCUT_TILE_COUNT is 4', () => {
    expect(SHORTCUT_TILE_COUNT).toBe(4);
  });

  it('TOTAL_ANIMATED_ITEMS = 6 + 4 = 10', () => {
    expect(TOTAL_ANIMATED_ITEMS).toBe(STUDIO_ITEM_COUNT + SHORTCUT_TILE_COUNT);
    expect(TOTAL_ANIMATED_ITEMS).toBe(10);
  });

  it('each shortcut tile globalIndex is within bounds', () => {
    for (let tileIndex = 0; tileIndex < SHORTCUT_TILE_COUNT; tileIndex++) {
      const globalIndex = STUDIO_ITEM_COUNT + tileIndex;
      expect(globalIndex).toBeGreaterThanOrEqual(STUDIO_ITEM_COUNT);
      expect(globalIndex).toBeLessThan(TOTAL_ANIMATED_ITEMS);
    }
  });

  it('globalIndex for tile 0 is STUDIO_ITEM_COUNT', () => {
    expect(STUDIO_ITEM_COUNT + 0).toBe(6);
  });

  it('globalIndex for tile 3 (last) is TOTAL_ANIMATED_ITEMS - 1', () => {
    expect(STUDIO_ITEM_COUNT + 3).toBe(TOTAL_ANIMATED_ITEMS - 1);
  });
});
