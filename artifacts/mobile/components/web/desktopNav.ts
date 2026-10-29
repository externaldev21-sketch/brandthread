/**
 * Desktop sidebar destinations.
 *
 * Seller: the bottom tab bar's five destinations first, then the Studio
 * radial menu's create actions, then every More-screen section in the More
 * screen's own order and grouping (app/(tabs)/more.tsx). The radial menu's
 * Studio tools that More doesn't list (Mockup to model, AI design) join the
 * Design Studio group. tests/desktop-shell.test.ts keeps this list from
 * drifting: every More route and every radial menu route must appear here.
 *
 * Buyer: the five destinations of the buyer tab bar.
 */
import type { IconName } from '@/components/ui/Icon';

export type DesktopNavItem = {
  /** Stable id; also the testID suffix (desktop-nav-<id>). */
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** Other route keys that light this item up (e.g. where its href redirects). */
  aliases?: string[];
};

export type DesktopNavGroup = {
  /** Omitted for the primary group, which has no header. */
  title?: string;
  items: DesktopNavItem[];
};

export const SELLER_DESKTOP_NAV: DesktopNavGroup[] = [
  {
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'home', href: '/(tabs)' },
      { id: 'analytics', label: 'Analytics', icon: 'bar-chart-2', href: '/(tabs)/analytics' },
      { id: 'products', label: 'Products', icon: 'package', href: '/(tabs)/products' },
      { id: 'orders', label: 'Orders', icon: 'shopping-bag', href: '/(tabs)/orders' },
      { id: 'profile', label: 'Profile', icon: 'user', href: '/(tabs)/profile' },
    ],
  },
  {
    title: 'Create',
    items: [
      { id: 'create-post', label: 'Create post', icon: 'video', href: '/create-post' },
      { id: 'add-product', label: 'Add product', icon: 'plus-square', href: '/add-product' },
      { id: 'go-live', label: 'Go Live', icon: 'radio', href: '/seller-go-live' },
    ],
  },
  {
    title: 'Store',
    items: [
      { id: 'store-builder', label: 'Store Builder', icon: 'layout', href: '/store-builder' },
      { id: 'collections', label: 'Collections', icon: 'grid', href: '/store-collections' },
      { id: 'domains', label: 'Domains', icon: 'globe', href: '/store-domain' },
      { id: 'discounts', label: 'Discounts', icon: 'tag', href: '/discounts' },
      { id: 'sales', label: 'Sales', icon: 'percent', href: '/sales' },
      { id: 'gift-cards', label: 'Gift cards', icon: 'gift', href: '/gift-cards-manage' },
    ],
  },
  {
    title: 'Design Studio',
    items: [
      { id: 'design-studio', label: 'Design Studio', icon: 'edit-3', href: '/design' },
      { id: 'photoshoot', label: 'Photoshoot', icon: 'camera', href: '/design-ai-photoshoot' },
      { id: 'mockup-to-model', label: 'Mockup to model', icon: 'user-check', href: '/design-mockup-to-model' },
      { id: 'ai-design', label: 'AI design', icon: 'zap', href: '/design-text-to-design' },
      { id: 'bg-removal', label: 'Background Removal', icon: 'scissors', href: '/design-bg-removal' },
      { id: 'campaign', label: 'Campaign Generator', icon: 'trending-up', href: '/design-campaign' },
      { id: 'brand-assets', label: 'Brand Assets', icon: 'layers', href: '/design-brand-assets' },
      { id: 'brand-creation', label: 'Brand Creation', icon: 'aperture', href: '/brand' },
      { id: 'meta-ads', label: 'Meta Ads', icon: 'facebook', href: '/meta-ads-manage' },
    ],
  },
  {
    title: 'Operations',
    items: [
      { id: 'shipping', label: 'Shipping', icon: 'truck', href: '/shipping' },
      { id: 'manufacturer-hub', label: 'Manufacturer Hub', icon: 'tool', href: '/manufacturer-hub' },
      { id: 'customers', label: 'Customers', icon: 'users', href: '/customers' },
    ],
  },
  {
    title: 'Growth',
    items: [
      { id: 'messages', label: 'Messages', icon: 'message-circle', href: '/seller-inbox' },
      { id: 'marketing', label: 'Marketing', icon: 'trending-up', href: '/(tabs)/marketing' },
      { id: 'content', label: 'Content', icon: 'video', href: '/content' },
      { id: 'community', label: 'Community', icon: 'users', href: '/community' },
      { id: 'creator-program', label: 'Creator program', icon: 'link', href: '/seller-creator-program' },
      { id: 'reviews', label: 'Reviews', icon: 'star', href: '/seller-reviews' },
      { id: 'questions', label: 'Questions', icon: 'help-circle', href: '/seller-questions' },
    ],
  },
  {
    title: 'Money',
    items: [
      { id: 'payouts', label: 'Payouts', icon: 'dollar-sign', href: '/payouts' },
      { id: 'popup-mode', label: 'Pop-up mode', icon: 'smartphone', href: '/popup-mode' },
      { id: 'subscription', label: 'Subscription', icon: 'star', href: '/subscription' },
      { id: 'taxes', label: 'Taxes and Duties', icon: 'percent', href: '/taxes-duties' },
    ],
  },
  {
    title: 'Account',
    items: [
      { id: 'team', label: 'Team', icon: 'users', href: '/team' },
      { id: 'integrations', label: 'Integrations', icon: 'link', href: '/integrations' },
      { id: 'notifications', label: 'Notifications', icon: 'bell', href: '/notifications-settings' },
      // /settings redirects a seller to /seller-settings.
      { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings', aliases: ['seller-settings'] },
      { id: 'help', label: 'Help & Support', icon: 'help-circle', href: '/help' },
    ],
  },
];

export const BUYER_DESKTOP_NAV: DesktopNavGroup[] = [
  {
    items: [
      { id: 'home', label: 'Home', icon: 'home', href: '/(buyer)' },
      { id: 'discover', label: 'Discover', icon: 'compass', href: '/(buyer)/discover' },
      { id: 'messages', label: 'Messages', icon: 'message-circle', href: '/(buyer)/inbox' },
      { id: 'activity', label: 'Activity', icon: 'bell', href: '/(buyer)/activity' },
      { id: 'profile', label: 'Profile', icon: 'user', href: '/(buyer)/profile' },
    ],
  },
];

/**
 * Buyer tab-group routes without a sidebar entry of their own → the tab whose
 * item lights up (mirrors the buyer bar's BUYER_ROUTE_SLOT).
 */
export const BUYER_ROUTE_NAV_ITEM: Record<string, string> = {
  feed: 'index',
  friends: 'index',
  cart: 'index',
  orders: 'profile',
  following: 'profile',
  'edit-profile': 'profile',
};

/** The route key (components/web/desktopShellLayout.ts routeKey) an href lands on. */
export function hrefRouteKey(href: string): string {
  const path = href.split('?')[0].replace(/^\//, '');
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === '(tabs)' || parts[0] === '(buyer)') return parts[1] ?? 'index';
  return parts[0] ?? 'index';
}

/** True when the href points into a tab group (the (tabs) or (buyer) navigator). */
export function isTabGroupHref(href: string): boolean {
  return href.startsWith('/(tabs)') || href.startsWith('/(buyer)');
}

/**
 * Which sidebar item lights up. An exact route match wins; otherwise the
 * seller side falls back to the bottom bar's own route → tab ownership
 * (product-detail → Products, order-detail → Orders, settings screens →
 * Profile…) and the buyer side to BUYER_ROUTE_NAV_ITEM.
 */
export function activeNavItemId(
  groups: DesktopNavGroup[],
  key: string,
  fallbackTab: string | null,
): string | null {
  for (const group of groups) {
    for (const item of group.items) {
      if (hrefRouteKey(item.href) === key || item.aliases?.includes(key)) return item.id;
    }
  }
  if (!fallbackTab) return null;
  for (const group of groups) {
    for (const item of group.items) {
      if (isTabGroupHref(item.href) && hrefRouteKey(item.href) === fallbackTab) return item.id;
    }
  }
  return null;
}
