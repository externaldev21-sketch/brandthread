/**
 * Desktop web shell (components/web/DesktopShell.tsx) contract tests.
 *
 *  1. Layout rules: which routes get the seller / buyer sidebar, which keep
 *     the classic column, and how wide each route's content column is.
 *  2. Sidebar coverage: every More-screen destination and every Studio
 *     radial menu destination is in the seller sidebar, so hiding the
 *     bottom bar and the radial menu at desktop widths loses nothing.
 *  3. Phone untouched: the desktop shell only mounts at >= 1024px, the bars
 *     and radial menu are skipped only at desktop widths, and
 *     SellerGlobalTabBar / SellerStudioRadialMenu themselves don't reference
 *     the desktop shell at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSE_CONTENT_MAX_WIDTH, DEFAULT_CONTENT_MAX_WIDTH, DESKTOP_SHELL_BREAKPOINT, FEED_CONTENT_MAX_WIDTH,
  SIDEBAR_WIDTH, WIDE_CONTENT_MAX_WIDTH, CONTENT_GUTTER,
  contentMaxWidthFor, contentWidthFor, desktopShellSide, routeKey,
} from '@/components/web/desktopShellLayout';
import {
  BUYER_DESKTOP_NAV, SELLER_DESKTOP_NAV, activeNavItemId, hrefRouteKey,
} from '@/components/web/desktopNav';
import { ALL_ITEMS } from '@/lib/sellerControlCenter';
import { BREAKPOINT, CONTENT_MAX_WIDTH } from '@/lib/theme';

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const sellerHrefs = SELLER_DESKTOP_NAV.flatMap((g) => g.items.map((i) => i.href));

describe('desktop shell layout rules', () => {
  it('switches on at the shared desktop breakpoint', () => {
    expect(DESKTOP_SHELL_BREAKPOINT).toBe(1024);
    // desktopShellLayout.ts mirrors these lib/theme tokens rather than importing them.
    expect(DESKTOP_SHELL_BREAKPOINT).toBe(BREAKPOINT.desktopWeb);
    expect(DEFAULT_CONTENT_MAX_WIDTH).toBe(CONTENT_MAX_WIDTH);
  });

  it('gives sellers the seller sidebar on tab and pushed routes', () => {
    for (const segments of [['(tabs)'], ['(tabs)', 'products'], ['settings'], ['order-detail'], ['manufacturer-hub']]) {
      expect(desktopShellSide({ segments, isSeller: true, isBuyer: false })).toBe('seller');
    }
  });

  it('gives buyers (and guests on the buyer tabs) the buyer sidebar', () => {
    expect(desktopShellSide({ segments: ['(buyer)', 'discover'], isSeller: false, isBuyer: true })).toBe('buyer');
    expect(desktopShellSide({ segments: ['buyer-product-detail'], isSeller: false, isBuyer: true })).toBe('buyer');
    expect(desktopShellSide({ segments: ['(buyer)'], isSeller: false, isBuyer: false })).toBe('buyer');
    expect(desktopShellSide({ segments: ['buyer-product-detail'], isSeller: false, isBuyer: false })).toBe('buyer');
  });

  it('keeps the classic column for auth, onboarding, legal and immersive flows', () => {
    for (const first of ['', 'sign-in', 'onboarding', 'privacy', 'create-post', 'design-canvas', 'seller-go-live', 'buyer-story-viewer', 'live']) {
      expect(desktopShellSide({ segments: [first], isSeller: true, isBuyer: true })).toBeNull();
    }
    expect(desktopShellSide({ segments: ['settings'], isSeller: false, isBuyer: false })).toBeNull();
  });

  it('reads the tab inside a tab group as the route key', () => {
    expect(routeKey(['(tabs)'])).toBe('index');
    expect(routeKey(['(tabs)', 'orders'])).toBe('orders');
    expect(routeKey(['(buyer)', 'discover'])).toBe('discover');
    expect(routeKey(['store-builder'])).toBe('store-builder');
  });

  it('sizes bespoke screens wide and everything else at a reading width', () => {
    expect(contentMaxWidthFor('seller', ['(tabs)'])).toBe(WIDE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('seller', ['(tabs)', 'products'])).toBe(WIDE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('seller', ['(tabs)', 'orders'])).toBe(WIDE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('seller', ['(tabs)', 'analytics'])).toBe(WIDE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('seller', ['settings'])).toBe(DEFAULT_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('buyer', ['(buyer)'])).toBe(FEED_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('buyer', ['(buyer)', 'discover'])).toBe(BROWSE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('buyer', ['buyer-product-detail'])).toBe(BROWSE_CONTENT_MAX_WIDTH);
    expect(contentMaxWidthFor('buyer', ['buyer-settings'])).toBe(DEFAULT_CONTENT_MAX_WIDTH);
  });

  it('never lets the content column overflow the room beside the sidebar', () => {
    expect(contentWidthFor({ windowWidth: 1440, sidebarWidth: SIDEBAR_WIDTH, maxWidth: WIDE_CONTENT_MAX_WIDTH }))
      .toBe(1440 - SIDEBAR_WIDTH - CONTENT_GUTTER * 2);
    expect(contentWidthFor({ windowWidth: 1440, sidebarWidth: SIDEBAR_WIDTH, maxWidth: DEFAULT_CONTENT_MAX_WIDTH }))
      .toBe(DEFAULT_CONTENT_MAX_WIDTH);
  });
});

describe('desktop sidebar coverage', () => {
  it('has the five bottom-bar destinations first, in bar order', () => {
    expect(SELLER_DESKTOP_NAV[0].items.map((i) => i.label)).toEqual(['Dashboard', 'Analytics', 'Products', 'Orders', 'Profile']);
    expect(BUYER_DESKTOP_NAV[0].items.map((i) => i.label)).toEqual(['Home', 'Discover', 'Messages', 'Activity', 'Profile']);
  });

  it('includes every More-screen destination, in the More screen groups', () => {
    const more = read('app/(tabs)/more.tsx');
    const moreRoutes = [...more.matchAll(/route: '([^']+)'/g)].map((m) => m[1]);
    expect(moreRoutes.length).toBeGreaterThan(20);
    for (const route of moreRoutes) expect(sellerHrefs).toContain(route);
    const titles = [...more.matchAll(/title: '([^']+)',\s+icon:/g)].map((m) => m[1]);
    const sidebarTitles = SELLER_DESKTOP_NAV.map((g) => g.title).filter(Boolean);
    for (const title of titles) expect(sidebarTitles).toContain(title);
  });

  it('includes every Studio radial menu destination', () => {
    const menu = read('components/SellerStudioRadialMenu.tsx');
    const order = menu.match(/const CARD_ORDER = \[([\s\S]*?)\];/)![1];
    const ids = [...order.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]).filter((id) => id !== 'activity');
    for (const id of ids) {
      const item = ALL_ITEMS.find((i) => i.id === id);
      expect(item, id).toBeDefined();
      expect(sellerHrefs).toContain(item!.route);
    }
  });

  it('lights up the owning item on child routes', () => {
    expect(activeNavItemId(SELLER_DESKTOP_NAV, 'store-builder', null)).toBe('store-builder');
    expect(activeNavItemId(SELLER_DESKTOP_NAV, 'seller-settings', 'profile')).toBe('settings');
    expect(activeNavItemId(SELLER_DESKTOP_NAV, 'product-detail', 'products')).toBe('products');
    expect(activeNavItemId(SELLER_DESKTOP_NAV, 'index', 'index')).toBe('dashboard');
    expect(activeNavItemId(BUYER_DESKTOP_NAV, 'inbox', null)).toBe('messages');
    expect(activeNavItemId(BUYER_DESKTOP_NAV, 'cart', 'index')).toBe('home');
    expect(hrefRouteKey('/(tabs)')).toBe('index');
  });
});

describe('phone layout untouched', () => {
  const layout = read('app/_layout.tsx');

  it('mounts the desktop shell only at desktop widths, WebAppShell otherwise', () => {
    expect(layout).toMatch(/isDesktopWeb\s*\?\s*<DesktopShell[\s\S]*?:\s*<WebAppShell>\{children\}<\/WebAppShell>/);
  });

  it('skips the seller bar and radial menu only at desktop widths, from SellerBarGate', () => {
    const gate = layout.slice(layout.indexOf('function SellerBarGate()'));
    expect(gate).toContain('if (!showBar) return null;');
    expect(gate).toContain('if (isDesktopWeb) return null;');
    expect(gate).toContain('<SellerGlobalTabBar');
    expect(gate).toContain('<SellerStudioRadialMenu');
  });

  it('skips the buyer bar only at desktop widths', () => {
    expect(read('app/(buyer)/_layout.tsx')).toContain('isDesktopWeb ? null : <BuyerTabBar');
  });

  it('leaves the bottom bar and radial menu components themselves alone', () => {
    for (const file of ['components/SellerGlobalTabBar.tsx', 'components/SellerStudioRadialMenu.tsx']) {
      const source = read(file);
      expect(source).not.toMatch(/DesktopShell|useIsDesktopWeb|useDesktopShell/);
    }
  });
});
