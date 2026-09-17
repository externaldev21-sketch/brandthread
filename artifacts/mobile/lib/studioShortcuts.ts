/**
 * Studio Shortcuts — pure-logic helpers
 *
 * No React Native imports so this module is safe to test with Vitest (node env).
 * The component imports from here; tests import from here directly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PickerDestination = {
  id: string;
  label: string;
  icon: string;
  route: string;
  description?: string;
};

// ─── Fixed shortcut slots 1–3 (immutable tile order) ─────────────────────────

export const FIXED_SHORTCUTS = [
  { id: 'create-post', label: 'Create Post', icon: 'video',       route: '/create-post' },
  { id: 'boost',       label: 'Boost',        icon: 'trending-up', route: '/boost' },
  { id: 'add-product', label: 'New Product',  icon: 'package',     route: '/add-product' },
] as const;

// ─── Picker destinations (eligible for 4th slot) ──────────────────────────────

export const PICKER_DESTINATIONS: PickerDestination[] = [
  { id: 'inventory',       label: 'Inventory',      icon: 'archive',       route: '/inventory',        description: 'Manage your product catalog' },
  { id: 'orders',          label: 'Orders',          icon: 'shopping-bag',  route: '/orders',           description: 'View and fulfill orders' },
  { id: 'analytics',       label: 'Analytics',       icon: 'bar-chart-2',   route: '/analytics',        description: 'Sales and audience data' },
  { id: 'customers',       label: 'Customers',       icon: 'users',         route: '/customers',        description: 'Manage your customer list' },
  { id: 'store-builder',   label: 'Store Builder',   icon: 'layout',        route: '/store-builder',    description: 'Customize your storefront' },
  { id: 'finance',         label: 'Finance',          icon: 'dollar-sign',   route: '/finance',          description: 'Payouts and revenue summary' },
  { id: 'discounts',       label: 'Discounts',        icon: 'tag',           route: '/discounts',        description: 'Create and manage promotions' },
  { id: 'team',            label: 'Team',             icon: 'user-plus',     route: '/team',             description: 'Invite and manage teammates' },
  { id: 'settings',        label: 'Settings',         icon: 'settings',      route: '/seller-settings',  description: 'Account and store settings' },
  { id: 'ai-brand-memory', label: 'Brand Memory',    icon: 'cpu',           route: '/ai-brand-memory',  description: 'Your AI brand guidelines' },
];

// ─── Persistence helpers ──────────────────────────────────────────────────────

/** Returns the per-user AsyncStorage key for the custom 4th shortcut. */
export function shortcutStorageKey(userId: string): string {
  return `@brandthread/studio_shortcut4:${userId}`;
}

/** Load saved custom shortcut for a user. Returns null on miss or error. */
export async function loadCustomShortcut(userId: string): Promise<PickerDestination | null> {
  try {
    const raw = await AsyncStorage.getItem(shortcutStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      'id' in parsed &&
      'label' in parsed &&
      'icon' in parsed &&
      'route' in parsed
    ) {
      return parsed as PickerDestination;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist custom shortcut for a user. Returns true on success, false on failure. */
export async function saveCustomShortcut(
  userId: string,
  dest: PickerDestination,
): Promise<boolean> {
  try {
    await AsyncStorage.setItem(shortcutStorageKey(userId), JSON.stringify(dest));
    return true;
  } catch {
    return false;
  }
}

/** Clear the custom shortcut for a user. Returns true on success, false on failure. */
export async function clearCustomShortcut(userId: string): Promise<boolean> {
  try {
    await AsyncStorage.removeItem(shortcutStorageKey(userId));
    return true;
  } catch {
    return false;
  }
}

// ─── Animation accounting ─────────────────────────────────────────────────────

/** Number of studio tool rows (Growth-gated). */
export const STUDIO_ITEM_COUNT = 6;

/** Number of shortcut tiles (3 fixed + 1 custom/add). */
export const SHORTCUT_TILE_COUNT = 4;

/** Total animated items = studio rows + shortcut tiles. */
export const TOTAL_ANIMATED_ITEMS = STUDIO_ITEM_COUNT + SHORTCUT_TILE_COUNT;
