/**
 * SellerGlobalTabBar — reusable global seller navigation shell.
 *
 * Renders the Brandthread seller tab bar (Studio radial menu trigger, four-tab
 * center capsule, AI brain button). Mounted once at the root layout level so it
 * persists across every seller screen — including detail/editor screens that
 * are root Stack siblings of (tabs).
 *
 * It is the same floating, icon-only glass bar as the buyer side, built from
 * the shared parts in components/tab-bar and sized by the shared tab bar
 * metrics, so both sides look and feel like one app. Only the icons differ.
 *
 * Active-tab state is derived from useSegments() / usePathname() rather than
 * the nested tab navigator index, so it works anywhere in the stack.
 *
 * Order badge polling, haptics, safe-area sizing, and Studio radial menu
 * behavior are all preserved exactly.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { useAuth } from '@clerk/expo';
import { TAB_BAR_SLIDE_EASING, TAB_BAR_SLIDE_MS } from '@/constants/motion';
import { tabBarSlideTargetY } from '@/lib/tabBarSlide';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticLight, hapticTabChange } from '@/lib/haptics';
import { BuyerNavIcon, type BuyerNavIconName } from '@/components/buyer-nav/BuyerNavIcon';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import {
  TAB_BAR_SHADOW, TabBarBadge, TabBarCircle, TabBarGlass, TabBarIndicator, TabBarSlot, tabIconColor,
  useTabBarActiveIndex,
} from '@/components/tab-bar/TabBarParts';
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
  /** Accessibility label only — the bar itself is icon-only. */
  label: string;
  icon: BuyerNavIconName;
  /** Root routes that map to this tab being active */
  matchSegments: string[];
  destination: string;
}[] = [
  {
    name: 'index',
    label: 'Dashboard',
    icon: 'dashboard',
    matchSegments: ['(tabs)', 'index'],
    destination: '/(tabs)/',
  },
  {
    name: 'products',
    label: 'Products',
    icon: 'products',
    matchSegments: [
      'products', 'add-product', 'product-detail', 'product-editor',
      'product-store', 'product-import', 'product-size-chart',
      'product-bundles', 'product-bundle-edit', 'drafts',
      'product-launches',
      'waitlist-demand',
      'product-variants',
    ],
    destination: '/(tabs)/products',
  },
  {
    name: 'orders',
    label: 'Orders',
    icon: 'orders',
    matchSegments: [
      'orders', 'order-detail', 'shipping-label', 'return-detail',
      'refund-detail', 'dispute-detail', 'return-request',
    ],
    destination: '/(tabs)/orders',
  },
  {
    name: 'profile',
    label: 'Profile',
    icon: 'profile',
    matchSegments: [
      'profile', 'settings', 'seller-settings', 'edit-profile',
      'billing', 'users', 'roles', 'security', 'general-settings',
      'push-notifications', 'biometric-unlock', 'app-icon', 'app-theme', 'appearance', 'plan-details',
      'payouts', 'subscription', 'seller-data-export', 'account-switcher',
      'login-methods', 'account-type-settings', 'seller-verification',
    ],
    destination: '/(tabs)/profile',
  },
];

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
  'product-launches': 'products',
  'waitlist-demand': 'products',
  'product-variants': 'products',
  'drafts': 'products',
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
  'app-theme': 'profile',
  'appearance': 'profile',
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
  /** True on a full-screen creation/camera/live flow (see
   *  SELLER_TAB_BAR_FULL_SCREEN_SEGMENTS in app/_layout.tsx) — the bar
   *  stays mounted but slides fully off the bottom of the screen instead of
   *  unmounting, then slides back to its exact resting position when this
   *  flips back to false. Defaults to false so every other call site (none
   *  today; SellerBarGate always passes it explicitly) keeps the bar shown. */
  hidden?: boolean;
}

export function SellerGlobalTabBar({ onOpenStudio, hidden: hiddenProp = false }: SellerGlobalTabBarProps) {
  // Also slides away for any screen with a bottom composer (useHideTabBar).
  const hiddenByScreen = useTabBarHiddenByScreen();
  const hidden = hiddenProp || hiddenByScreen;
  const metrics = useTabBarMetrics(2);
  const router = useRouter();
  const segments = useSegments();
  const api = useApi();
  const { userId } = useAuth();
  const { theme } = useAppTheme();

  const activeTab = getActiveTab(segments as string[]);
  const activeIndex = TABS.findIndex((tabDef) => tabDef.name === activeTab);
  const reducedMotion = useReducedMotion();
  // Owns the pill's position so a tab press can kick the glide immediately,
  // before the screen swap — see the hook's doc in TabBarParts.
  const { x: indicatorX, target: indicatorTarget, opacity: indicatorOpacity, press: pressIndicator } =
    useTabBarActiveIndex(activeIndex, reducedMotion);

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
    hapticLight();
    // Map active tab to AI context. `activeTab === 'index'` is ambiguous on
    // its own — getActiveTab() returns 'index' both for the genuine
    // Dashboard tab AND as its safe fallback for every unmapped screen
    // (Settings, Customers, Analytics, …), so the fallback used to collapse
    // both into 'home' — every screen outside Products/Orders showed the AI
    // Brain header as "Seller Home", wrong and misleading everywhere else.
    // Only pass 'home' when segments actually resolve to the Dashboard tab
    // itself; anything else falls back to 'general' ("Brandthread AI").
    const segmentStrings = segments as string[];
    const onDashboard = segmentStrings[0] === '(tabs)' && (segmentStrings[1] ?? 'index') === 'index';
    const screen =
      activeTab === 'products' ? 'products' :
      activeTab === 'orders' ? 'orders' :
      onDashboard ? 'home' :
      'general';
    router.push({
      pathname: '/ai-brain',
      params: { context: JSON.stringify({ screen }) },
    });
  };

  const openStudio = () => {
    hapticLight();
    onOpenStudio();
  };

  // ── Slide off/on screen for full-screen creation flows (`hidden` prop) ──
  // Measured via onLayout (not a fixed guess) so "fully off-screen, nothing
  // peeking" holds regardless of device/metrics — mirrors
  // components/ui/BottomSheet.tsx's onSheetLayout pattern. Falls back to a
  // generous default before the first layout so an extremely early `hidden`
  // still clears the screen.
  const [barHeight, setBarHeight] = useState(96);
  const offscreenY = barHeight + metrics.bottomOffset;
  const translateY = useSharedValue(hidden ? offscreenY : 0);
  useEffect(() => {
    // Always withTiming toward the exact target — never a bare `.set()` —
    // so the bar can never rest at a stuck partial offset; see
    // lib/tabBarSlide.ts's doc for why (the #490 web "stuck mid-transform"
    // bug class this guards against).
    translateY.set(withTiming(tabBarSlideTargetY(hidden, offscreenY), {
      duration: TAB_BAR_SLIDE_MS,
      easing: TAB_BAR_SLIDE_EASING,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden, offscreenY]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  return (
    <Animated.View
      onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[styles.bar, { bottom: metrics.bottomOffset, gap: metrics.gap }, slideStyle]}
      testID="seller-global-tab-bar"
    >
      <TabBarCircle
        theme={theme}
        size={metrics.circleSize}
        testID="seller-bottom-menu"
        accessibilityLabel="Open Studio tools"
        onPress={openStudio}
      >
        <BuyerNavIcon name="studio" color={theme.text} size={metrics.iconSize} />
      </TabBarCircle>

      <View
        style={[
          TAB_BAR_SHADOW,
          {
            width: metrics.capsuleWidth,
            height: metrics.capsuleHeight,
            borderRadius: metrics.capsuleHeight / 2,
          },
        ]}
      >
        <TabBarGlass theme={theme} radius={metrics.capsuleHeight / 2} />
        <TabBarIndicator x={indicatorX} target={indicatorTarget} opacity={indicatorOpacity} metrics={metrics} theme={theme} />

        <View
          accessibilityRole="tablist"
          style={[styles.slotRow, { marginLeft: metrics.capsulePadding }]}
        >
          {TABS.map((tabDef, index) => {
            const isFocused = activeTab === tabDef.name;
            const showOrderBadge =
              tabDef.name === 'orders' && newOrderCount > 0 && !isFocused;

            const onPress = () => {
              if (!isFocused) hapticTabChange();
              // navigate() (not replace()) so the (tabs) navigator sees a
              // real focus change and runs its transitionSpec — replace()
              // swaps the route with no transition at all.
              router.navigate(tabDef.destination as never);
            };

            return (
              <TabBarSlot
                key={tabDef.name}
                focused={isFocused}
                width={metrics.itemWidth}
                height={metrics.capsuleHeight}
                theme={theme}
                accessibilityLabel={
                  showOrderBadge
                    ? `${tabDef.label} tab, ${newOrderCount} new orders`
                    : `${tabDef.label} tab`
                }
                onPress={onPress}
                onPressIn={() => pressIndicator(index)}
                testID={`seller-tab-${tabDef.name}`}
                badge={showOrderBadge ? <TabBarBadge count={newOrderCount} theme={theme} /> : null}
                pillTarget={indicatorTarget}
                pillIndex={index}
              >
                <BuyerNavIcon
                  name={tabDef.icon}
                  color={tabIconColor(theme, isFocused)}
                  focused={isFocused}
                  size={metrics.iconSize}
                />
              </TabBarSlot>
            );
          })}
        </View>
      </View>

      <TabBarCircle
        theme={theme}
        size={metrics.circleSize}
        testID="seller-bottom-ai"
        accessibilityLabel="Open Brandthread AI"
        onPress={openAI}
      >
        <BrandthreadLogo size={metrics.iconSize - 1} opacity={1} />
      </TabBarCircle>
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bar: {
    position:       'absolute',
    left:           0,
    right:          0,
    zIndex:         30,
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'center',
  },
  slotRow: {
    flexDirection: 'row',
    alignSelf:     'flex-start',
    alignItems:    'center',
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
