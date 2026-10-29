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
      'Your app & media',
      'Your orders & payments',
      'For professionals',
      'More info & support',
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
      // The buyer Language row was removed on purpose (buyers have no app-language setting).
      '/appearance', '/biometric-unlock', '/buyer-settings-detail?section=accessibility',
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
      'Store details', 'Store website', 'Plan', 'Billing', 'Users', 'Roles', 'Security', 'Payments', 'Payouts', 'Checkout',
      'Shipping and delivery', 'Taxes and duties', 'Locations', 'Apps', 'Domains', 'Notifications',
      'Customer privacy', 'Policies',
    ]);
  });

  it('keeps every destination it had before', () => {
    const routes = new Set(routesOf(SELLER_SETTINGS_CATALOG));
    for (const r of [
      '/login-methods', '/login-activity', '/security', '/ai-settings', '/general-settings',
      '/store-settings', '/store-builder', '/store-theme-picker', '/design-brand-assets', '/store-domain', '/discounts',
      '/locations', 'action:account-scope', '/vacation-mode', '/payouts', '/billing', '/payments', '/shipping-delivery',
      // '/shipping' is the same screen as '/shipping-delivery' (a re-export), listed once.
      '/taxes-duties', '/team', '/users', '/roles', '/subscription', '/plans', '/ai-credits',
      '/integrations', '/integrations/klaviyo', '/integrations/shopify-fulfillment', '/notifications-settings',
      '/customer-privacy', '/buyer-blocked', '/muted-words', '/admin-reports', '/admin-promotions', '/admin-invites',
      '/appearance', '/biometric-unlock', '/languages', '/first-run-tips-settings', '/help', '/seller-data-export',
      '/buyer-settings-detail?section=about', '/buyer-invite', '/account-type-settings', 'action:sign-out',
      'action:delete-account',
    ]) expect(routes.has(r), r).toBe(true);
    // Edit profile is the account row at the top of the screen, not a second catalog row.
    expect(read('app/seller-settings.tsx')).toContain("onPress={() => router.push('/edit-profile' as never)}");
  });

  it('lists each destination once: no group repeats another group\'s row', () => {
    for (const catalog of [BUYER_SETTINGS_CATALOG, SELLER_SETTINGS_CATALOG]) {
      const routes = routesOf(catalog);
      expect(routes.filter((r, i) => routes.indexOf(r) !== i)).toEqual([]);
    }
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

describe('buyer settings audit follow-ups', () => {
  it('has no buyer language row (owner call); seller keeps its Language rows', () => {
    const buyerRoutes = routesOf(BUYER_SETTINGS_CATALOG);
    expect(buyerRoutes).not.toContain('/app-language');
    expect(buyerRoutes).not.toContain('/languages');
    expect(routesOf(SELLER_SETTINGS_CATALOG)).toContain('/languages');
  });

  it('uses "&" in group titles and never repeats a group title (they are React keys)', () => {
    for (const catalog of [BUYER_SETTINGS_CATALOG, SELLER_SETTINGS_CATALOG]) {
      const titles = catalog.map((g) => g.title);
      expect(titles.filter((t) => / and /.test(t))).toEqual([]);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it('a failed sign-out says so and keeps the user signed in', () => {
    const screen = read('app/buyer-settings.tsx');
    expect(screen).toMatch(/catch \(err\) \{[\s\S]*showAlert\('Couldn’t log out', friendlyError\(err,/);
  });

  it('settings detail: only linked sections, a not-found state, no dimmed read-only rows', () => {
    const src = read('app/buyer-settings-detail.tsx');
    expect(src).not.toContain('Object.assign(CONFIG');
    for (const dead of ['activity:', 'archive:', 'story:', 'tags:', 'comments:', 'sharing:', "'hidden-words':", 'suggested:', 'payments:', 'language:', "'privacy-center':", 'media:', 'muted:', 'restricted:', 'favorites:', 'appearance:', 'qr:', "'close-friends':"]) {
      expect(src, dead).not.toContain(`  ${dead} {`);
    }
    expect(src).toContain("messages: { title: 'Messages',");
    expect(src).not.toMatch(/toggle: '(readReceipts|messageRequests|activityStatus)'/);
    expect(src).toContain("toggle: 'reduceMotion'");
    expect(src).toContain("toggle: 'captions'");
    expect(src).toContain('This settings page doesn’t exist.');
    expect(src).not.toContain('CONFIG.content');
    expect(src).not.toContain('disabled={');
    expect(src).not.toContain('fontSize: 13');
  });

  it('Accounts Center: recommendation row opens the page with the recommendations switch', () => {
    const src = read('app/buyer-account-center.tsx');
    expect(src).toContain("{ label: 'Recommendation preferences', icon: 'sliders', sub: 'Personalization, sizes, and style', route: '/shopping-preferences' }");
    expect(src).toContain("label: 'App Lock'");
    expect(src).toContain("label: 'Login activity'");
    expect(read('app/shopping-preferences.tsx')).toContain('personalizedRecommendations');
  });
});
