import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('seller Profile tab navigation', () => {
  it('uses the seller route group instead of the ambiguous /profile URL', () => {
    // The seller tab bar was extracted to SellerGlobalTabBar.tsx (global shell).
    // The profile destination is '/(tabs)/profile' in the tab definitions.
    const tabBar = readFileSync(resolve(process.cwd(), 'components/SellerGlobalTabBar.tsx'), 'utf8');

    expect(tabBar).toContain("'/(tabs)/profile'");
    // navigate() (not replace()) so the (tabs) navigator's transitionSpec
    // actually runs on a tab switch — see seller-tab-switch-transition.test.ts.
    expect(tabBar).toContain("router.navigate(tabDef.destination as never)");
  });

  it('lets buyers switch profiles from their name in the profile header', () => {
    const buyerProfile = readFileSync(resolve(process.cwd(), 'app/(buyer)/profile.tsx'), 'utf8');
    // The plain-text switcher (no pill background) is shared with the
    // seller own-profile header — components/profile/ProfileTopBar.tsx,
    // whose default accessibilityLabel is "Switch account" and whose icon
    // is "chevron-down".
    const topBar = readFileSync(resolve(process.cwd(), 'components/profile/ProfileTopBar.tsx'), 'utf8');

    expect(buyerProfile).toContain('testID="buyer-profile-account-switcher"');
    expect(buyerProfile).toContain('<ProfileAccountSwitcher');
    // The switcher is a sheet on the profile screen now (see
    // components/AccountSwitcherSheet.tsx), not a pushed route.
    expect(buyerProfile).toContain('setAccountSwitcherOpen(true)');
    expect(buyerProfile).toContain('<AccountSwitcherSheet');
    expect(buyerProfile).toContain('label={displayHandle || displayName}');
    expect(buyerProfile).toContain('name={displayName}');
    expect(topBar).toContain("accessibilityLabel = 'Switch account'");
    expect(topBar).toContain('name="chevron-down"');
    expect(buyerProfile).not.toContain("name={isPrivate ? 'lock' : 'globe'}");
  });

  it('gives the seller own-profile top bar the exact same plain-chrome look as the buyer one (no grey pill, no grey circles)', () => {
    const sellerProfile = readFileSync(resolve(process.cwd(), 'app/(tabs)/profile.tsx'), 'utf8');

    // Reuses the shared, chrome-free controls instead of a bespoke pill
    // switcher / ProfileGlassButton circles.
    expect(sellerProfile).toContain("import { ProfileAccountSwitcher, ProfileTopBarIcon, ProfileTopBarIconRow } from '@/components/profile/ProfileTopBar'");
    expect(sellerProfile).toContain('<ProfileAccountSwitcher');
    expect(sellerProfile).toContain('<ProfileTopBarIconRow>');
    // At most two header icons (⋯ + settings); Activity and Share are rows in the ⋯ sheet.
    expect(sellerProfile).not.toContain('<ProfileTopBarIcon name="bell"');
    expect(sellerProfile).toContain("key: 'activity', icon: 'bell'");
    expect(sellerProfile).toContain("key: 'share', icon: 'share-2'");
    expect(sellerProfile).toContain('<ProfileTopBarIcon name="settings"');
    expect(sellerProfile).not.toContain('ProfileGlassButton');
    // The old pill-switcher style is gone entirely, not just unused.
    expect(sellerProfile).not.toContain('switcher: {');
    expect(sellerProfile).not.toContain('brandNameTitle: {');
  });
});