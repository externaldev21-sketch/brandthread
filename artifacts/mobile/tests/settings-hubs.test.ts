/**
 * Settings consolidation: buyers get one Instagram "Settings and activity"
 * list (the old profile Menu + the old Settings hub), sellers get Shopify's
 * Settings order. Nothing that was reachable from either buyer screen may
 * drop out; rows that live one level down stay findable by search.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BUYER_SETTINGS_CATALOG,
  SELLER_SETTINGS_CATALOG,
  settingsGroupsFor,
  type SettingsCatalogGroup,
} from '../services/settingsCatalog';
import { resolveLegacyRoute } from '../lib/navigation/legacyRoutes';

const ROOT = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const routesOf = (groups: SettingsCatalogGroup[]) => groups.flatMap((g) => g.items.map((i) => i.route ?? `action:${i.action}`));
const visibleLabels = (groups: SettingsCatalogGroup[]) => settingsGroupsFor(groups, '').flatMap((g) => g.items.map((i) => i.label));

describe('buyer: one "Settings and activity" list in Instagram\'s sections', () => {
  it('uses Instagram\'s section order, Log out last under Login', () => {
    expect(BUYER_SETTINGS_CATALOG.map((g) => g.title)).toEqual([
      'Your account',
      'How you use Brandthread',
      'Who can see your content',
      'How others can interact with you',
      'What you see',
      'Your app and media',
      'Your orders and payments',
      'For professionals',
      'More info and support',
      'Login',
    ]);
    const login = BUYER_SETTINGS_CATALOG[BUYER_SETTINGS_CATALOG.length - 1];
    expect(login.items.map((i) => [i.label, i.action])).toEqual([['Log out', 'sign-out']]);
    expect(BUYER_SETTINGS_CATALOG[0].items[0]).toMatchObject({ label: 'Accounts Center', showDescription: true });
  });

  it('keeps every destination of the old profile Menu and the old Settings hub', () => {
    const routes = new Set(routesOf(BUYER_SETTINGS_CATALOG));
    const formerMenu = [
      '/(buyer)/edit-profile', 'action:share-profile', '/buyer-qr-code', '/buyer-saved', '/buyer-drafts',
      '/buyer-archive', '/buyer-your-activity', '/buyer-close-friends', '/community', '/(buyer)/friends',
      '/buyer-highlights-manager', '/(buyer)/orders', '/loyalty', '/thread-cash', '/buyer-gift-cards',
      '/freelancer-jobs', '/creator-program', '/help', 'action:sign-out',
    ];
    const formerSettings = [
      '/buyer-account-center', '/login-activity', '/account-type-settings', '/buyer-invite', '/(buyer)/following',
      '/shopping-preferences', '/buyer-my-sizes', '/buyer-addresses', '/buyer-payment-methods', '/push-notifications',
      '/buyer-privacy-settings', '/buyer-blocked', '/buyer-muted', '/buyer-restricted', '/buyer-friend-requests',
      '/muted-words', '/buyer-settings-detail?section=messages', '/buyer-settings-detail?section=content',
      '/appearance', '/biometric-unlock', '/languages', '/buyer-settings-detail?section=accessibility',
      '/first-run-tips-settings', '/buyer-problem-report', '/buyer-download-data', '/buyer-settings-detail?section=about',
      '/community-guidelines', '/terms', '/privacy', '/refund-policy', '/seller-agreement', 'action:delete-account',
    ];
    for (const r of [...formerMenu, ...formerSettings]) expect(routes.has(r), r).toBe(true);
  });

  it('keeps Accounts Center / About rows out of the list but findable by search', () => {
    const shown = visibleLabels(BUYER_SETTINGS_CATALOG);
    for (const hidden of ['Login activity', 'Download my data', 'Delete account', 'Terms of Service']) {
      expect(shown).not.toContain(hidden);
    }
    const found = (q: string) => settingsGroupsFor(BUYER_SETTINGS_CATALOG, q).flatMap((g) => g.items.map((i) => i.label));
    expect(found('login activity')).toContain('Login activity');
    expect(found('delete')).toContain('Delete account');
    expect(found('terms')).toContain('Terms of Service');
    expect(found('hidden words')).toContain('Muted words');
  });

  it('is the one buyer settings screen: profile menu button and /settings both open it', () => {
    const screen = read('app/buyer-settings.tsx');
    expect(screen).toContain('<ScreenHeader title="Settings and activity"');
    expect(screen).toContain('settingsGroupsFor(BUYER_SETTINGS_CATALOG, query)');
    expect(screen).toContain("router.push('/delete-account' as never)");
    expect(read('app/(buyer)/profile.tsx')).toContain("router.push('/buyer-settings' as any)");
    expect(read('app/settings.tsx')).toContain("'/buyer-settings'");
    expect(existsSync(path.join(ROOT, 'app/buyer-settings-menu.tsx'))).toBe(false);
    expect(resolveLegacyRoute('/buyer-settings-menu')).toBe('/buyer-settings');
  });
});

describe('seller: Shopify Settings order', () => {
  it('starts with App settings, then Store settings in Shopify\'s order', () => {
    expect(SELLER_SETTINGS_CATALOG.slice(0, 2).map((g) => g.title)).toEqual(['App settings', 'Store settings']);
    const store = SELLER_SETTINGS_CATALOG[1].items.filter((i) => !i.searchOnly).map((i) => i.label);
    expect(store).toEqual([
      'Store details', 'Plan', 'Billing', 'Users', 'Roles', 'Security', 'Payments', 'Payouts', 'Checkout',
      'Shipping and delivery', 'Taxes and duties', 'Locations', 'Apps', 'Domains', 'Notifications',
      'Customer privacy', 'Policies',
    ]);
  });

  it('keeps every destination it had before', () => {
    const routes = new Set(routesOf(SELLER_SETTINGS_CATALOG));
    for (const r of [
      '/edit-profile', '/login-methods', '/login-activity', '/security', '/ai-settings', '/general-settings',
      '/store-settings', '/store-builder', '/store-theme-picker', '/design-brand-assets', '/store-domain', '/discounts',
      '/locations', 'action:account-scope', '/vacation-mode', '/payouts', '/billing', '/payments', '/shipping-delivery',
      '/shipping', '/taxes-duties', '/team', '/users', '/roles', '/subscription', '/plans', '/ai-credits',
      '/integrations', '/integrations/klaviyo', '/integrations/shopify-fulfillment', '/notifications-settings',
      '/customer-privacy', '/buyer-blocked', '/muted-words', '/admin-reports', '/admin-promotions', '/admin-invites',
      '/appearance', '/biometric-unlock', '/languages', '/first-run-tips-settings', '/help', '/seller-data-export',
      '/buyer-settings-detail?section=about', '/buyer-invite', '/account-type-settings', 'action:sign-out',
      'action:delete-account',
    ]) expect(routes.has(r), r).toBe(true);
  });

  it('seller-settings draws the list through settingsGroupsFor (search-only rows stay hidden until searched)', () => {
    expect(read('app/seller-settings.tsx')).toContain('settingsGroupsFor(SELLER_SETTINGS_CATALOG, query');
    expect(visibleLabels(SELLER_SETTINGS_CATALOG)).not.toContain('Compare plans');
  });
});

describe('merged duplicates', () => {
  it('buyer and seller login activity are one route', () => {
    expect(existsSync(path.join(ROOT, 'app/buyer-login-activity.tsx'))).toBe(false);
    expect(read('app/buyer-account-center.tsx')).toContain("route: '/login-activity'");
    expect(read('app/buyer-security.tsx')).toContain("router.push('/login-activity' as never)");
    expect(resolveLegacyRoute('/buyer-login-activity')).toBe('/login-activity');
  });
});
