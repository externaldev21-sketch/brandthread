import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { Tabs } from 'expo-router';
import { useRouter } from 'expo-router';
import Animated from 'react-native-reanimated';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSelection } from '@/lib/haptics';
import {
  TAB_BAR_SHADOW, TabBarBadge, TabBarCircle, TabBarGlass, TabBarIndicator, TabBarSlot, tabIconColor,
} from '@/components/tab-bar/TabBarParts';
import { BuyerNavIcon, type BuyerNavIconName } from './BuyerNavIcon';
import { useBuyerTabBarMetrics } from './buyerTabBarMetrics';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

// ─── Navigation contract ──────────────────────────────────────────────────────
// Capsule: Home · Discover · Inbox · Search, plus a separate Profile circle.
// Search is its own full-screen page (see app/buyer-search.tsx), pushed onto
// the root stack like TikTok's search — tapping its slot never opens a tab or
// morphs the bar into a text field; it just navigates there directly, the
// same as every other icon in this bar.

export const BUYER_TAB_ITEMS: readonly {
  route: 'index' | 'discover' | 'inbox' | 'search';
  label: string;
  icon: BuyerNavIconName;
}[] = [
  { route: 'index', label: 'Home', icon: 'home' },
  { route: 'discover', label: 'Discover', icon: 'discover' },
  { route: 'inbox', label: 'Inbox', icon: 'inbox' },
  { route: 'search', label: 'Search', icon: 'search' },
] as const;

type Slot = 'index' | 'discover' | 'inbox' | 'search' | 'profile';

/** Which bar control lights up for each buyer route, including hidden ones. */
export const BUYER_ROUTE_SLOT: Record<string, Slot> = {
  index: 'index',
  feed: 'index',
  friends: 'index',
  cart: 'index',
  discover: 'discover',
  inbox: 'inbox',
  search: 'search',
  profile: 'profile',
  orders: 'profile',
  following: 'profile',
  'edit-profile': 'profile',
};

/**
 * Routes that are pushed, modal-style screens inside the buyer tab navigator
 * (kept as Tabs.Screen entries with href: null so the bar stays mounted
 * behind them for a nice cross-fade, per the layout comment) but that must
 * not show the floating tab bar over their own content/keyboard/footer.
 */
const BUYER_TAB_BAR_HIDDEN_ROUTES = new Set<string>(['edit-profile']);

export function BuyerTabBar({
  state,
  navigation,
  inboxBadgeCount,
}: BottomTabBarProps & { inboxBadgeCount: number }) {
  const metrics = useBuyerTabBarMetrics();
  const { theme } = useAppTheme();
  const router = useRouter();

  const activeRoute = state.routes[state.index]?.name ?? 'index';
  const activeSlot = BUYER_ROUTE_SLOT[activeRoute] ?? null;
  const activeIndex = BUYER_TAB_ITEMS.findIndex(item => item.route === activeSlot);

  const openRoute = React.useCallback((routeName: string) => {
    if (routeName === 'search') {
      hapticSelection();
      router.push('/buyer-search' as never);
      return;
    }
    const route = state.routes.find(candidate => candidate.name === routeName);
    const focused = activeRoute === routeName;
    if (focused) return;
    const event = route
      ? navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
      : null;
    if (event?.defaultPrevented) return;
    hapticSelection();
    navigation.navigate(routeName as never);
  }, [activeRoute, navigation, router, state.routes]);

  const onLongPress = React.useCallback((routeName: string) => {
    const route = state.routes.find(candidate => candidate.name === routeName);
    if (route) navigation.emit({ type: 'tabLongPress', target: route.key });
  }, [navigation, state.routes]);

  const profileFocused = activeSlot === 'profile';

  // Pushed, modal-style screens (Edit profile) never show the floating bar.
  // This check runs after every hook above so hook order stays stable while
  // the bar itself mounts/unmounts as the user navigates in and out.
  if (BUYER_TAB_BAR_HIDDEN_ROUTES.has(activeRoute)) return null;

  return (
    <Animated.View
      testID="buyer-bottom-tab-bar"
      style={[
        styles.bar,
        { bottom: metrics.bottomOffset, gap: metrics.gap },
      ]}
    >
      {/* ── Capsule ─────────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.shadow,
          { height: metrics.capsuleHeight, borderRadius: metrics.capsuleHeight / 2, width: metrics.capsuleWidth },
        ]}
      >
        <TabBarGlass theme={theme} radius={metrics.capsuleHeight / 2} />

        <TabBarIndicator
          activeIndex={activeIndex}
          visible
          metrics={metrics}
          theme={theme}
        />

        <View
          accessibilityRole="tablist"
          style={[styles.slotRow, { marginLeft: metrics.capsulePadding }]}
        >
          {BUYER_TAB_ITEMS.map((item) => {
            const focused = activeSlot === item.route;
            const badge = item.route === 'inbox' ? inboxBadgeCount : 0;
            const label = badge > 0
              ? `${item.label} tab, ${badge} unread ${badge === 1 ? 'item' : 'items'}`
              : `${item.label} tab`;
            return (
              <TabBarSlot
                key={item.route}
                focused={focused}
                width={metrics.itemWidth}
                height={metrics.capsuleHeight}
                onPress={() => openRoute(item.route)}
                onLongPress={() => onLongPress(item.route)}
                testID={`buyer-tab-${item.route}`}
                accessibilityLabel={label}
                badge={item.route === 'inbox' ? <TabBarBadge count={badge} theme={theme} /> : null}
              >
                <BuyerNavIcon
                  name={item.icon}
                  color={tabIconColor(theme, focused)}
                  focused={focused}
                  size={metrics.iconSize}
                />
              </TabBarSlot>
            );
          })}
        </View>
      </Animated.View>

      {/* ── Profile circle ──────────────────────────────────────────────── */}
      <TabBarCircle
        theme={theme}
        size={metrics.circleSize}
        active={profileFocused}
        accessibilityLabel="Profile tab"
        selected={profileFocused}
        onPress={() => openRoute('profile')}
        onLongPress={() => onLongPress('profile')}
        testID="buyer-tab-profile"
      >
        <BuyerNavIcon
          name="profile"
          color={tabIconColor(theme, profileFocused)}
          focused={profileFocused}
          size={metrics.iconSize}
        />
      </TabBarCircle>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'box-none',
  },
  // Shadow lives on an unclipped wrapper; the glass inside clips to the radius.
  shadow: TAB_BAR_SHADOW,
  slotRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
  },
});
