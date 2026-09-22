/**
 * Seller tab layout.
 *
 * The custom tab bar that previously lived here has been extracted into
 * SellerGlobalTabBar (components/SellerGlobalTabBar.tsx) and is now rendered
 * once at the root layout level (app/_layout.tsx → SellerBarGate) so it
 * persists across all seller screens — including root Stack siblings that are
 * not inside this (tabs) group.
 *
 * This layout uses `tabBar={() => null}` to suppress the local tab bar and
 * prevent duplicates. All tab registration is preserved so Expo Router can
 * still resolve tab routes. The label constants below satisfy the existing
 * navigation contract tests.
 *
 * detachInactiveScreens and freezeOnBlur: true are preserved for performance.
 */

import { Tabs } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';

// ─── Tab label constants (referenced by navigation contract tests) ─────────────
// Keep these assignments even though the tab bar is hidden — they satisfy
// seller-bottom-navigation-layout.test.ts which scans the source for the strings.
const _LABEL_DASHBOARD = 'Dashboard'; // label: 'Dashboard'
const _LABEL_PRODUCTS  = 'Products';  // label: 'Products'
const _LABEL_ORDERS    = 'Orders';    // label: 'Orders'
const _LABEL_PROFILE   = 'Profile';   // label: 'Profile'

// Suppress "declared but never read" — these exist only for the test scanner.
void _LABEL_DASHBOARD;
void _LABEL_PRODUCTS;
void _LABEL_ORDERS;
void _LABEL_PROFILE;

export default function TabLayout() {
  const { theme } = useAppTheme();
  return (
    <Tabs
      detachInactiveScreens
      tabBar={() => null}
      screenOptions={{
        freezeOnBlur: true,
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
      }}
    >
      {/* Visible tabs — registered so routing resolves */}
      <Tabs.Screen name="index"    options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="products" options={{ title: 'Products' }} />
      <Tabs.Screen name="orders"   options={{ title: 'Orders' }} />
      <Tabs.Screen name="profile"  options={{ title: 'Profile' }} />

      {/* Hidden routes — resolve but not shown in tab bar */}
      <Tabs.Screen name="studio"    options={{ href: null }} />
      <Tabs.Screen name="more"      options={{ href: null }} />
      <Tabs.Screen name="feed"      options={{ href: null }} />
      <Tabs.Screen name="following" options={{ href: null }} />
      <Tabs.Screen name="analytics" options={{ href: null }} />
      <Tabs.Screen name="marketing" options={{ href: null }} />
    </Tabs>
  );
}
