/**
 * Seller Control Center — pure-logic helpers
 *
 * Single source of truth for every destination reachable from the seller's
 * main menu / shortcuts hub (opened from the tab bar's Studio button). No
 * React Native imports, so this module is safe to test with Vitest (node
 * env) and to scan for route coverage.
 *
 * The component (SellerStudioRadialMenu.tsx) renders from this data; tests
 * import it directly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { GROWTH_STUDIO_TOOLS } from '@/lib/growthTools';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ControlCenterItem {
  id: string;
  label: string;
  /** Feather icon name (string, not typed against the font, to stay RN-free). */
  icon: string;
  route: string;
  description?: string;
  /** Requires the Growth plan (or higher) to open. */
  growthOnly?: boolean;
  /** Which live counter (if any) feeds this item's badge. */
  badgeKey?: 'orders' | 'messages';
}

export interface ControlCenterSection {
  key: string;
  title: string;
  icon: string;
  items: ControlCenterItem[];
}

// ─── Growth studio tools → routed items ────────────────────────────────────────
// Design/AI Studio tools stay Growth-gated exactly as before; routes preserved.

const GROWTH_ROUTES: Record<string, string> = {
  'design-studio':   '/design',
  'ai-photoshoot':   '/design-ai-photoshoot',
  'mockup-to-model': '/design-mockup-to-model',
  'remove-bg':       '/design-bg-removal',
  'ai-design':       '/design-text-to-design',
  'campaign-gen':    '/design-campaign',
};

const STUDIO_TOOL_IDS = [
  'design-studio',
  'mockup-to-model',
  'remove-bg',
  'ai-design',
  'campaign-gen',
  'ai-photoshoot',
] as const;

const STUDIO_ITEMS: ControlCenterItem[] = STUDIO_TOOL_IDS.map((id) => {
  const tool = GROWTH_STUDIO_TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`Missing Studio tool definition: ${id}`);
  return {
    id: tool.id,
    label: tool.title,
    icon: tool.icon,
    route: GROWTH_ROUTES[tool.id],
    description: tool.desc,
    growthOnly: true,
  };
});

// ─── Sections ───────────────────────────────────────────────────────────────
// Every seller destination reachable from the hub, grouped for the compact
// list view. Keep in sync with tests/seller-bottom-navigation-layout.test.ts's
// route inventory — nothing here should be a dead link.

export const SECTIONS: ControlCenterSection[] = [
  {
    key: 'sell',
    title: 'Sell',
    icon: 'shopping-bag',
    items: [
      { id: 'add-product', label: 'Add product', icon: 'plus-square', route: '/add-product', description: 'List a new item' },
      { id: 'post-video',  label: 'Post video',   icon: 'video',       route: '/create-post', description: 'Share a shoppable post' },
      { id: 'products',    label: 'Products',     icon: 'grid',        route: '/(tabs)/products', description: 'Your full catalog' },
      { id: 'orders',      label: 'Orders',       icon: 'shopping-bag', route: '/(tabs)/orders', description: 'Fulfill and track orders', badgeKey: 'orders' },
      { id: 'inventory',   label: 'Inventory',    icon: 'archive',     route: '/inventory', description: 'Stock levels and locations' },
      { id: 'drops',       label: 'Drops',        icon: 'zap',         route: '/add-product?intent=drop', description: 'Schedule a limited drop' },
      { id: 'discounts',   label: 'Discounts',    icon: 'tag',         route: '/discounts', description: 'Coupon codes and offers' },
    ],
  },
  {
    key: 'grow',
    title: 'Grow',
    icon: 'trending-up',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'bar-chart-2', route: '/(tabs)/analytics', description: 'Sales, traffic and insights' },
      { id: 'content',   label: 'Content',   icon: 'film',        route: '/content', description: 'Posts, drafts and scheduled' },
      { id: 'messages',  label: 'Messages',  icon: 'message-circle', route: '/seller-inbox', description: 'Reply to buyer DMs', badgeKey: 'messages' },
      { id: 'boost',     label: 'Boost',     icon: 'trending-up', route: '/boost', description: 'Promote a post or product' },
      { id: 'community', label: 'Community', icon: 'briefcase',  route: '/community', description: 'Hire freelance creatives' },
    ],
  },
  {
    key: 'money',
    title: 'Money',
    icon: 'dollar-sign',
    items: [
      { id: 'payouts',      label: 'Payouts',         icon: 'dollar-sign', route: '/payouts', description: 'Bank account and payout history' },
      { id: 'finance',      label: 'Finance',         icon: 'pie-chart',   route: '/finance', description: 'Revenue summary' },
      { id: 'subscription', label: 'Subscription',    icon: 'star',        route: '/subscription', description: 'Manage your Brandthread plan' },
      { id: 'taxes',        label: 'Taxes and Duties', icon: 'percent',    route: '/taxes-duties', description: 'Tax rules and collection' },
    ],
  },
  {
    key: 'store',
    title: 'Store',
    icon: 'layout',
    items: [
      { id: 'store-builder', label: 'Store Builder', icon: 'layout', route: '/store-builder', description: 'Build your brand website' },
      { id: 'store-preview', label: 'Store Preview', icon: 'eye',    route: '/store-preview', description: 'See your live storefront' },
      { id: 'shipping',      label: 'Shipping',       icon: 'truck',  route: '/shipping', description: 'Rates, zones and carriers' },
      { id: 'manufacturer',  label: 'Manufacturer Hub', icon: 'tool', route: '/manufacturer-hub', description: 'Find and manage manufacturers' },
      ...STUDIO_ITEMS,
      // 'collections' removed from the Store section (folded into Store Builder's
      // collection-grid blocks). 'brand-memory' unlinked from the seller menu per
      // product decision — screen/route/service kept intact, just unreachable from here.
    ],
  },
  {
    key: 'support',
    title: 'Support',
    icon: 'users',
    items: [
      { id: 'customers', label: 'Customers', icon: 'users',        route: '/customer-accounts', description: 'Browse your customer list' },
      { id: 'team',      label: 'Team',      icon: 'user-plus',    route: '/team', description: 'Invite and manage teammates' },
      { id: 'settings',  label: 'Settings',  icon: 'settings',     route: '/seller-settings', description: 'Account and store settings' },
      { id: 'help',      label: 'Help & Support', icon: 'help-circle', route: '/help', description: 'Guides, FAQs and contact us' },
    ],
  },
];

/** Flat list of every item across every section — the searchable/pinnable universe. */
export const ALL_ITEMS: ControlCenterItem[] = SECTIONS.flatMap((s) => s.items);

export function findItem(id: string): ControlCenterItem | undefined {
  return ALL_ITEMS.find((item) => item.id === id);
}

// ─── Pinned shortcuts ─────────────────────────────────────────────────────────

/** Default pinned tiles shown before a seller customizes their control center. */
export const DEFAULT_PINNED_IDS: string[] = ['add-product', 'orders', 'post-video', 'payouts'];

/** Hard cap on pinned tiles — keeps the row usable and the layout premium, not cluttered. */
export const MAX_PINNED = 8;

export function pinnedStorageKey(userId: string): string {
  return `@brandthread/seller-menu-pins:v1:${userId}`;
}

/** Load saved pinned-shortcut order for a user. Falls back to defaults on miss or error. */
export async function loadPinnedIds(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(pinnedStorageKey(userId));
    if (!raw) return [...DEFAULT_PINNED_IDS];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED_IDS];
    const valid = parsed.filter((id): id is string => typeof id === 'string' && !!findItem(id));
    return valid.length > 0 ? valid : [...DEFAULT_PINNED_IDS];
  } catch {
    return [...DEFAULT_PINNED_IDS];
  }
}

/** Persist pinned-shortcut order for a user. Returns true on success, false on failure. */
export async function savePinnedIds(userId: string, ids: string[]): Promise<boolean> {
  try {
    await AsyncStorage.setItem(pinnedStorageKey(userId), JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}

// ─── Pure array helpers (unit-tested, used by the edit-mode UI) ──────────────

/** Add an id to the pinned list (no-op if already pinned or at capacity). */
export function pinItem(pinned: string[], id: string): string[] {
  if (pinned.includes(id) || pinned.length >= MAX_PINNED || !findItem(id)) return pinned;
  return [...pinned, id];
}

/** Remove an id from the pinned list. */
export function unpinItem(pinned: string[], id: string): string[] {
  return pinned.filter((existing) => existing !== id);
}

/** Swap a pinned tile with its neighbor in the given direction. No-op at the ends. */
export function movePinned(pinned: string[], index: number, direction: 'left' | 'right'): string[] {
  const target = direction === 'left' ? index - 1 : index + 1;
  if (index < 0 || index >= pinned.length || target < 0 || target >= pinned.length) return pinned;
  const next = [...pinned];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ─── Search ───────────────────────────────────────────────────────────────────

export function searchItems(query: string): ControlCenterItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      (item.description?.toLowerCase().includes(q) ?? false),
  );
}

// ─── Route inventory (used by the route-existence test) ──────────────────────

/** Strips query params and route groups down to the on-disk app/ path segments. */
export function routeToAppFilePaths(route: string): string[] {
  const withoutQuery = route.split('?')[0];
  const trimmed = withoutQuery.replace(/^\//, '');
  // '(tabs)/orders' → try both 'app/(tabs)/orders.tsx' and 'app/orders.tsx'
  const candidates = new Set<string>();
  candidates.add(`app/${trimmed}.tsx`);
  candidates.add(`app/${trimmed}/index.tsx`);
  const withoutGroup = trimmed.replace(/^\([^)]+\)\//, '');
  candidates.add(`app/${withoutGroup}.tsx`);
  return Array.from(candidates);
}
