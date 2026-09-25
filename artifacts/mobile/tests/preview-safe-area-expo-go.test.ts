import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('browser preview safe areas and Expo Go startup', () => {
  it('keeps both buyer and seller tab bars visible and reachable on web', () => {
    const buyerTabs = read('components/buyer-nav/BuyerTabBar.tsx');
    const tabBarParts = read('components/tab-bar/TabBarParts.tsx');
    const sellerBar = read('components/SellerGlobalTabBar.tsx');
    const buyerMetrics = read('components/buyer-nav/buyerTabBarMetrics.ts');
    const sellerTabs = read('app/(tabs)/_layout.tsx');
    const cookieConsent = read('contexts/CookieConsentContext.tsx');

    expect(buyerMetrics).toContain('Math.max(bottomInset - 10, 12)');
    expect(buyerTabs).toContain('bottom: metrics.bottomOffset');
    expect(sellerBar).toContain('bottom: metrics.bottomOffset');
    expect(tabBarParts).toContain('minWidth: 44');
    expect(sellerTabs).not.toContain("if (Platform.OS === 'web') return null");
    // The cookie banner's bottom offset is derived from the same tab bar
    // metrics both bars use (occupiedHeight), rather than a hardcoded value
    // tuned for phone proportions only — see WebAppShell / desktop web pass.
    expect(cookieConsent).toContain('tabBarInset + SP.sm');
    expect(cookieConsent).toContain('useTabBarMetrics().occupiedHeight');
  });

  it('does not statically load the unavailable keyboard-controller native module', () => {
    const startupFiles = [
      'app/_layout.tsx',
      'components/KeyboardAwareScrollViewCompat.tsx',
      'app/buyer-checkout.tsx',
      'app/(buyer)/search.tsx',
      'app/(buyer)/_layout.tsx',
      'components/buyer-nav/BuyerTabBar.tsx',
      'app/(tabs)/feed.tsx',
    ];

    for (const file of startupFiles) {
      expect(read(file)).not.toContain("from 'react-native-keyboard-controller'");
    }
  });
});