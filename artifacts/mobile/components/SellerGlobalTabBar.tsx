/**
 * SellerGlobalTabBar — reusable global seller navigation shell.
 *
 * Renders the exact same Brandthread seller tab bar (Studio radial menu trigger,
 * four-tab center pill, AI brain button) that previously lived inside
 * app/(tabs)/_layout.tsx. Now mounted once at the root layout level so it
 * persists across every seller screen — including detail/editor screens that
 * are root Stack siblings of (tabs).
 *
 * Active-tab state is derived from useSegments() / usePathname() rather than
 * the nested tab navigator index, so it works anywhere in the stack.
 *
 * Order badge polling, haptics, safe-area sizing, and Studio radial menu
 * behavior are all preserved exactly.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useSegments } from 'expo-router';
import * as Haptics from 'expo-haptics';

import {
  BORDER,
  BG,
  SURFACE_GLASS,
  MUTED,
  FG,
  FONT,
  FS,
  SP,
} from '@/lib/theme';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import {
  getLastViewedAt,
  setBadgeCount,
  subscribe,
  initFromStorage,
} from '@/lib/orderBadgeStore';
import { getSellerOrderBadgeCount } from '@/lib/sellerOrderBadge';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import SellerStudioRadialMenu from '@/components/SellerStudioRadialMenu';

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS: {
  name: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  /** Root routes that map to this tab being active */
  matchSegments: string[];
  destination: string;
}[] = [
  {
    name: 'index',
    label: 'Dashboard',
    icon: 'home',
    matchSegments: ['(tabs)', 'index'],
    destination: '/(tabs)/',
  },
  {
    name: 'products',
    label: 'Products',
    icon: 'package',
    matchSegments: [
      'products', 'add-product', 'product-detail', 'product-editor',
      'product-store', 'product-import', 'product-size-chart',
      'product-bundles', 'product-bundle-edit', 'drafts', 'inventory',
      'inventory-detail', 'inventory-adjust', 'inventory-transfer',
      'inventory-incoming', 'inventory-count', 'inventory-location',
    ],
    destination: '/(tabs)/products',
  },
  {
    name: 'orders',
    label: 'Orders',
    icon: 'shopping-bag',
    matchSegments: [
      'orders', 'order-detail', 'shipping-label', 'return-detail',
      'refund-detail', 'dispute-detail', 'return-request',
    ],
    destination: '/(tabs)/orders',
  },
  {
    name: 'profile',
    label: 'Profile',
    icon: 'user',
    matchSegments: [
      'profile', 'settings', 'seller-settings', 'edit-profile',
      'billing', 'users', 'roles', 'security', 'general-settings',
      'push-notifications', 'biometric-unlock', 'app-icon', 'plan-details',
      'payouts', 'subscription', 'seller-data-export', 'account-switcher',
      'login-methods', 'account-type-settings', 'seller-verification',
    ],
    destination: '/(tabs)/profile',
  },
];

const INACTIVE_COLOR = 'rgba(244,244,255,0.72)';

// ─── Route → active tab classification ───────────────────────────────────────
// Maps the first or second segment to the closest primary tab.
// All seller root routes are included so the active state is accurate on any screen.

const ROUTE_TO_TAB: Record<string, string> = {
  // Dashboard
  '(tabs)': 'index',
  'index': 'index',
  // Products
  'products': 'products',
  'add-product': 'products',
  'product-detail': 'products',
  'product-editor': 'products',
  'product-store': 'products',
  'product-import': 'products',
  'product-size-chart': 'products',
  'product-bundles': 'products',
  'product-bundle-edit': 'products',
  'drafts': 'products',
  'inventory': 'products',
  'inventory-detail': 'products',
  'inventory-adjust': 'products',
  'inventory-transfer': 'products',
  'inventory-incoming': 'products',
  'inventory-count': 'products',
  'inventory-location': 'products',
  // Orders
  'orders': 'orders',
  'order-detail': 'orders',
  'shipping-label': 'orders',
  'return-detail': 'orders',
  'refund-detail': 'orders',
  'dispute-detail': 'orders',
  'return-request': 'orders',
  // Profile / Settings
  'profile': 'profile',
  'settings': 'profile',
  'seller-settings': 'profile',
  'edit-profile': 'profile',
  'billing': 'profile',
  'users': 'profile',
  'roles': 'profile',
  'security': 'profile',
  'general-settings': 'profile',
  'push-notifications': 'profile',
  'biometric-unlock': 'profile',
  'app-icon': 'profile',
  'plan-details': 'profile',
  'payouts': 'profile',
  'subscription': 'profile',
  'seller-data-export': 'profile',
  'account-switcher': 'profile',
  'login-methods': 'profile',
  'account-type-settings': 'profile',
  'seller-verification': 'profile',
  // Design Studio → no primary tab active (returns 'index' as safe fallback)
  // All other seller screens default to 'index'
};

/**
 * Derive which tab name is active from the current segments array.
 * The first non-group segment is the route key for all root Stack screens.
 * Inside (tabs), the second segment is the actual tab.
 */
function getActiveTab(segments: string[]): string {
  // Strip leading group segments like "(tabs)"
  const first = segments[0] ?? '';
  if (first === '(tabs)') {
    const second = segments[1] ?? 'index';
    return ROUTE_TO_TAB[second] ?? 'index';
  }
  return ROUTE_TO_TAB[first] ?? 'index';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SellerGlobalTabBarProps {
  onOpenStudio: () => void;
}

export function SellerGlobalTabBar({ onOpenStudio }: SellerGlobalTabBarProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const api = useApi();
  const { userId } = useAuth();
  const { theme } = useAppTheme();
  const colors = useColors();

  const activeTab = getActiveTab(segments as string[]);

  const [newOrderCount, setNewOrderCount] = useState(() =>
    getSellerOrderBadgeCount(userId),
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!userId) {
      setNewOrderCount(0);
      return;
    }
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;

    const unsub = subscribe(() => setNewOrderCount(getSellerOrderBadgeCount(userId)));

    let cancelled = false;

    const poll = async () => {
      if (requestGenerationRef.current === generation) return;
      requestGenerationRef.current = generation;
      const pollStartMs = Date.now();
      try {
        const rows = await api.orders.list();
        if (cancelled || generationRef.current !== generation) return;
        const lastViewed = getLastViewedAt(userId);
        const count = Array.isArray(rows)
          ? (rows as any[]).filter(
              (r: any) =>
                r.status === 'pending' &&
                new Date(r.createdAt).getTime() > lastViewed,
            ).length
          : 0;
        if (count > 0) {
          void requestContextualPushPermission(userId, api);
        }
        setBadgeCount(userId, count, pollStartMs);
        consecutiveFailuresRef.current = 0;
      } catch {
        if (cancelled || generationRef.current !== generation) return;
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= 3 && pollRef.current !== null) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } finally {
        if (requestGenerationRef.current === generation) {
          requestGenerationRef.current = null;
        }
      }
    };

    initFromStorage(userId).then(() => {
      if (!cancelled) {
        poll();
        pollRef.current = setInterval(poll, 30_000);
      }
    });

    return () => {
      cancelled = true;
      unsub();
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, userId]);

  const openAI = () => {
    // Map active tab to AI context
    const screen =
      activeTab === 'products' ? 'products' :
      activeTab === 'orders' ? 'orders' :
      'home';
    router.push({
      pathname: '/ai-brain',
      params: { context: JSON.stringify({ screen }) },
    });
  };

  return (
    <View
      style={[
        styles.bar,
        {
          height: 76 + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: colors.tabBarBackground,
          borderColor: colors.border,
        },
      ]}
      testID="seller-global-tab-bar"
    >
      <Pressable
        testID="seller-bottom-menu"
        accessibilityRole="button"
        accessibilityLabel="Open Studio tools"
        onPress={onOpenStudio}
        style={({ pressed }) => [
          styles.sideButton,
          { backgroundColor: theme.surfaceGlass, borderColor: theme.border },
          pressed && styles.pressed,
        ]}
      >
        <Feather name="menu" size={20} color={colors.foreground} />
        <Text style={[styles.sideLabel, { color: colors.foreground }]}>Studio</Text>
      </Pressable>

      <View style={[
        styles.centerBar,
        { backgroundColor: theme.surfaceGlass, borderColor: theme.border },
      ]}>
        {TABS.map((tabDef) => {
          const isFocused = activeTab === tabDef.name;
          const color = isFocused ? theme.accent : INACTIVE_COLOR;
          const showOrderBadge =
            tabDef.name === 'orders' && newOrderCount > 0 && !isFocused;

          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            router.replace(tabDef.destination as never);
          };

          return (
            <Pressable
              key={tabDef.name}
              accessibilityRole="tab"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={
                showOrderBadge
                  ? `${tabDef.label} tab, ${newOrderCount} new orders`
                  : `${tabDef.label} tab`
              }
              onPress={onPress}
              style={[styles.tab, isFocused && [styles.tabActive, { backgroundColor: colors.accent }]]}
              testID={`seller-tab-${tabDef.name}`}
            >
              <View style={styles.iconWrap}>
                <Feather name={tabDef.icon} size={24} color={color} />
                {showOrderBadge && (
                  <View style={[styles.badge, { backgroundColor: theme.accent, borderColor: colors.background }]}>
                    <Text style={[styles.badgeText, { color: theme.onAccent }]}>
                      {newOrderCount > 99 ? '99+' : String(newOrderCount)}
                    </Text>
                  </View>
                )}
              </View>
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, { color }]}
              >
                {tabDef.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        testID="seller-bottom-ai"
        accessibilityRole="button"
        accessibilityLabel="Open Brandthread AI"
        onPress={openAI}
        style={({ pressed }) => [
          styles.sideButton,
          { backgroundColor: theme.surfaceGlass, borderColor: theme.border },
          pressed && styles.pressed,
        ]}
      >
        <BrandthreadLogo size={22} opacity={1} />
        <Text style={[styles.sideLabel, { color: colors.foreground }]}>AI</Text>
      </Pressable>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    position:         'absolute',
    left:             0,
    right:            0,
    bottom:           0,
    zIndex:           30,
    flexDirection:    'row',
    alignItems:       'flex-start',
    gap:              12,
    backgroundColor:  'transparent',
    paddingTop:       8,
    paddingHorizontal: 12,
  },
  centerBar: {
    flex:             1,
    height:           52,
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 4,
    borderRadius:     26,
    borderWidth:      1,
    borderColor:      'rgba(255,255,255,0.14)',
    backgroundColor:  'rgba(8,8,10,0.58)',
  },
  sideButton: {
    width:           52,
    height:          52,
    borderRadius:    26,
    alignItems:      'center',
    justifyContent:  'center',
    borderWidth:     1,
    borderColor:     'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(8,8,10,0.58)',
    paddingTop:       4,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.95 }] },
  tab: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    minHeight:      48,
    borderRadius:   22,
    gap:            1,
  },
  tabActive: { backgroundColor: 'rgba(255,255,255,0.14)' },
  iconWrap: {
    position: 'relative',
  },
  tabLabel: {
    maxWidth:   '100%',
    fontFamily: FONT.bold,
    fontSize:   11,
    lineHeight: 13,
  },
  sideLabel: {
    color:      FG,
    fontFamily: FONT.bold,
    fontSize:   11,
    lineHeight: 13,
  },
  badge: {
    position:         'absolute',
    top:              -5,
    right:            -8,
    minWidth:         16,
    height:           16,
    borderRadius:     8,
    alignItems:       'center',
    justifyContent:   'center',
    paddingHorizontal: 3,
    borderWidth:      1.5,
    borderColor:      'transparent',
  },
  badgeText: {
    fontSize:   FS.xs,
    fontFamily: FONT.medium,
    color:      FG,
    lineHeight: 11,
  },
});

// ─── Seller Navigation Shell ──────────────────────────────────────────────────
// Renders SellerGlobalTabBar + SellerStudioRadialMenu as a flex column wrapper.
// Use this as the single mount point from RootLayoutNav.

interface SellerNavigationShellProps {
  children: React.ReactNode;
}

export function SellerNavigationShell({ children }: SellerNavigationShellProps) {
  const [studioOpenRequestKey, setStudioOpenRequestKey] = useState(0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <SellerGlobalTabBar
        onOpenStudio={() => setStudioOpenRequestKey((k) => k + 1)}
      />
      <SellerStudioRadialMenu hideTrigger openRequestKey={studioOpenRequestKey} />
    </View>
  );
}
