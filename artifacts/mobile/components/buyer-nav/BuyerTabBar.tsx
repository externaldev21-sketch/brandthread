import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Tabs } from 'expo-router';
import Animated from 'react-native-reanimated';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticTabChange } from '@/lib/haptics';
import { useActivityUnreadCount } from '@/components/ActivityBellButton';
import {
  TAB_BAR_SHADOW, TabBarBadge, TabBarCircle, TabBarGlass, TabBarIndicator, TabBarSlot, CrossfadeNavIcon, tabIconColor,
} from '@/components/tab-bar/TabBarParts';
import { BuyerNavIcon, type BuyerNavIconName } from './BuyerNavIcon';
import { useBuyerTabBarMetrics } from './buyerTabBarMetrics';
import { TabBarGlassZone } from './TabBarGlassZone';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

// ─── Navigation contract ──────────────────────────────────────────────────────
// Capsule: Home · Discover · Inbox · Activity, plus a separate Profile
// circle. Activity is a Tabs.Screen in this navigator (app/(buyer)/activity.tsx,
// a thin re-export of the shared app/activity-center.tsx screen also used by
// the seller side) reached the same way as every other icon in this bar —
// navigation.navigate, not router.push to the root-level route — so the
// floating tab bar stays mounted and lit up on Activity instead of
// disappearing (that root route is still what the seller-side
// ActivityBellButton instances push to, unchanged).
// Search lives only as its own full-screen page (see app/buyer-search.tsx),
// reachable from the feed's top-row icon and Discover — it does NOT get a
// slot here, so there's exactly one way into it, not two.

export const BUYER_TAB_ITEMS: readonly {
  route: 'index' | 'discover' | 'inbox' | 'activity';
  label: string;
  icon: BuyerNavIconName;
}[] = [
  { route: 'index', label: 'Home', icon: 'home' },
  { route: 'discover', label: 'Discover', icon: 'discover' },
  { route: 'inbox', label: 'Inbox', icon: 'inbox' },
  { route: 'activity', label: 'Activity', icon: 'activity' },
] as const;

type Slot = 'index' | 'discover' | 'inbox' | 'activity' | 'profile';

/** Which bar control lights up for each buyer route, including hidden ones. */
export const BUYER_ROUTE_SLOT: Record<string, Slot> = {
  index: 'index',
  feed: 'index',
  friends: 'index',
  cart: 'index',
  discover: 'discover',
  inbox: 'inbox',
  activity: 'activity',
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
 *
 * 'cart' is a pushed screen (reached from the feed's cart icon or Shop the
 * Post, never its own tab slot) — showing the floating capsule underneath it
 * used to both cover its sticky checkout bar and light up "Home" as if Cart
 * were a tab, with no way to tell it was actually a pushed screen.
 */
const BUYER_TAB_BAR_HIDDEN_ROUTES = new Set<string>(['edit-profile', 'cart']);

export function BuyerTabBar({
  state,
  navigation,
  inboxBadgeCount,
}: BottomTabBarProps & { inboxBadgeCount: number }) {
  const metrics = useBuyerTabBarMetrics();
  const { theme } = useAppTheme();
  const activityUnread = useActivityUnreadCount();
  const { width } = useWindowDimensions();

  const activeRoute = state.routes[state.index]?.name ?? 'index';
  const activeSlot = BUYER_ROUTE_SLOT[activeRoute] ?? null;
  const activeIndex = BUYER_TAB_ITEMS.findIndex(item => item.route === activeSlot);

  const openRoute = React.useCallback((routeName: string) => {
    const route = state.routes.find(candidate => candidate.name === routeName);
    const focused = activeRoute === routeName;
    if (focused) return;
    const event = route
      ? navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
      : null;
    if (event?.defaultPrevented) return;
    hapticTabChange();
    navigation.navigate(routeName as never);
  }, [activeRoute, navigation, state.routes]);

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
      {/* Frosted glass over whatever's actually rendered behind the bar —
          the feed's full-bleed video, or an ordinary scrolling list on
          Discover/Inbox/Activity/Profile. `BuyerTabBar` is the one shared
          tab-bar container mounted for the whole buyer navigator (see
          app/(buyer)/_layout.tsx's `tabBar` prop), so rendering it here
          once — instead of each screen wiring its own copy — is what gets
          every one of those screens the same live-sampled treatment
          automatically, feed included.
          `bar`'s own coordinate origin is already offset by
          `metrics.bottomOffset` from the true screen bottom (see the
          `bottom` set on `styles.bar` above), so this needs the negative
          of that same offset to actually reach the screen's bottom edge —
          a plain `bottom: 0` would stop short by exactly that offset and
          leave a hard, unblurred edge below the glass. The height is
          `barTopInset` (not the more generous `occupiedHeight`) so the
          glass's own top edge lands exactly on the bar's top pixel, with
          no gap of sharp content between them. */}
      <TabBarGlassZone
        height={metrics.barTopInset}
        width={width}
        tint="dark"
        style={{ bottom: -metrics.bottomOffset }}
      />

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
            const badge = item.route === 'inbox' ? inboxBadgeCount : item.route === 'activity' ? activityUnread : 0;
            const hasBadge = item.route === 'inbox' || item.route === 'activity';
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
                badge={hasBadge ? <TabBarBadge count={badge} theme={theme} /> : null}
              >
                <CrossfadeNavIcon
                  name={item.icon}
                  focused={focused}
                  theme={theme}
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
