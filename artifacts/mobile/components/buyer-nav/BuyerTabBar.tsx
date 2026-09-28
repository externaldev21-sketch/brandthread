import React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Tabs } from 'expo-router';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticTabChange } from '@/lib/haptics';
import { useActivityUnreadCount } from '@/components/ActivityBellButton';
import { SHEET_EASING, SHEET_OPEN_MS } from '@/constants/motion';
import {
  TAB_BAR_SHADOW, TabBarBadge, TabBarCircle, TabBarGlass, TabBarIndicator, TabBarSlot, CrossfadeNavIcon, tabIconColor,
} from '@/components/tab-bar/TabBarParts';
import { BuyerNavIcon, type BuyerNavIconName } from './BuyerNavIcon';
import { COMPACT_ICON_SCALE, COMPACT_ICON_STROKE_SCALE, useBuyerTabBarMetrics } from './buyerTabBarMetrics';
import { TabBarGlassZone } from './TabBarGlassZone';

// Reuse the app's established no-bounce/no-overshoot sheet timing (constants/
// motion.ts, PRs #170/#176) for the compact <-> regular capsule transition,
// rather than inventing a new curve/duration — 260ms sits in the requested
// 250-300ms window.
const BAR_MODE_TIMING = { duration: SHEET_OPEN_MS, easing: SHEET_EASING } as const;

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
  // Regular is pixel-identical to #210/#212; compact is the Instagram
  // iOS 26-style condensed capsule shown only over the feed's full-bleed
  // video (Home). Both are computed up front so the transition between them
  // can be interpolated on the UI thread instead of jumping between two
  // discrete React-rendered layouts.
  const regularMetrics = useBuyerTabBarMetrics();
  const compactMetrics = useBuyerTabBarMetrics(1, 'compact');
  const { theme } = useAppTheme();
  const activityUnread = useActivityUnreadCount();
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();

  const activeRoute = state.routes[state.index]?.name ?? 'index';
  const activeSlot = BUYER_ROUTE_SLOT[activeRoute] ?? null;
  const activeIndex = BUYER_TAB_ITEMS.findIndex(item => item.route === activeSlot);
  // Home is the only full-bleed video tab — every other buyer screen keeps
  // the regular capsule exactly as shipped.
  const isCompact = activeSlot === 'index';

  // 0 = regular, 1 = compact. Every animated style below reads this one
  // value so width, height, icon scale and the selection pill all move as
  // one coordinated transition instead of several out-of-sync ones.
  const progress = useSharedValue(isCompact ? 1 : 0);
  React.useEffect(() => {
    const target = isCompact ? 1 : 0;
    // Reduced Motion: snap instantly, no animated transition at all.
    progress.set(reducedMotion ? target : withTiming(target, BAR_MODE_TIMING));
  }, [isCompact, reducedMotion, progress]);

  // TabBarGlassZone isn't a Reanimated-aware component (its native path
  // renders several plain BlurView bands, its web path a CSS mask) — its
  // `height` prop is kept in sync with `progress` every frame via this
  // reaction instead, so the glass strip's top edge never lags behind or
  // outruns the capsule's own animated top edge in either mode.
  const [barTopInset, setBarTopInset] = React.useState(
    isCompact ? compactMetrics.barTopInset : regularMetrics.barTopInset,
  );
  useAnimatedReaction(
    () => interpolate(progress.value, [0, 1], [regularMetrics.barTopInset, compactMetrics.barTopInset]),
    (current, previous) => {
      if (current !== previous) runOnJS(setBarTopInset)(current);
    },
    [regularMetrics.barTopInset, compactMetrics.barTopInset],
  );

  const barGapStyle = useAnimatedStyle(() => ({
    gap: interpolate(progress.value, [0, 1], [regularMetrics.gap, compactMetrics.gap]),
  }));
  const capsuleAnimatedStyle = useAnimatedStyle(() => {
    const h = interpolate(progress.value, [0, 1], [regularMetrics.capsuleHeight, compactMetrics.capsuleHeight]);
    return {
      height: h,
      borderRadius: h / 2,
      width: interpolate(progress.value, [0, 1], [regularMetrics.capsuleWidth, compactMetrics.capsuleWidth]),
    };
  });
  const capsuleGlassStyle = useAnimatedStyle(() => {
    const h = interpolate(progress.value, [0, 1], [regularMetrics.capsuleHeight, compactMetrics.capsuleHeight]);
    return { borderRadius: h / 2 };
  });
  const circleAnimatedStyle = useAnimatedStyle(() => {
    const size = interpolate(progress.value, [0, 1], [regularMetrics.circleSize, compactMetrics.circleSize]);
    return { width: size, height: size, borderRadius: size / 2 };
  });
  const circleGlassStyle = useAnimatedStyle(() => {
    const size = interpolate(progress.value, [0, 1], [regularMetrics.circleSize, compactMetrics.circleSize]);
    return { borderRadius: size / 2 };
  });
  const slotAnimatedStyle = useAnimatedStyle(() => ({
    width: interpolate(progress.value, [0, 1], [regularMetrics.itemWidth, compactMetrics.itemWidth]),
    height: interpolate(progress.value, [0, 1], [regularMetrics.capsuleHeight, compactMetrics.capsuleHeight]),
  }));
  // Icons shrink less than the capsule itself ("slightly smaller", not
  // tiny) — a uniform scale transform on the icon's own wrapper, driven by
  // the same `progress` value, so it moves in lockstep with the capsule/
  // circle/pill resize rather than as a separate, staggered animation.
  const iconScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, COMPACT_ICON_SCALE]) }],
  }));
  // Static (not interpolated) compensation: a smaller icon rendered with a
  // proportionally heavier stroke reads as the same visual weight instead of
  // going thin. Snapping this once per mode (rather than animating it frame
  // by frame) is imperceptible over a 260ms transition and keeps the vector
  // icons themselves out of the per-frame animation path.
  const iconStrokeWidth = isCompact ? 1.8 * COMPACT_ICON_STROKE_SCALE : undefined;

  // Compact mode shrinks the visual capsule/circle below 44pt on the
  // smallest phones — hitSlop extends the actual touch target back out to
  // at least 44pt without changing anything visible.
  const compactHitSlop = React.useMemo(() => {
    const vertical = Math.max(0, (44 - compactMetrics.capsuleHeight) / 2);
    const horizontal = Math.max(0, (44 - compactMetrics.itemWidth) / 2);
    return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
  }, [compactMetrics.capsuleHeight, compactMetrics.itemWidth]);
  const compactCircleHitSlop = React.useMemo(() => {
    const inset = Math.max(0, (44 - compactMetrics.circleSize) / 2);
    return { top: inset, bottom: inset, left: inset, right: inset };
  }, [compactMetrics.circleSize]);

  // Everything below that isn't itself animated (accessibility labels, the
  // slot row's left margin, badge placement, …) reads from `regularMetrics`
  // — it's identical to `compactMetrics` for every field that doesn't change
  // between modes (capsulePadding, iconSize, bottomOffset, …), and using one
  // consistent object keeps this section byte-for-byte what it was before
  // compact mode existed.
  const metrics = regularMetrics;

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
        { bottom: metrics.bottomOffset },
        barGapStyle,
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
          no gap of sharp content between them. `barTopInset` itself is kept
          in sync with the capsule's animated height every frame (see the
          `useAnimatedReaction` above) so this never falls behind or overlaps
          the real edge while switching in/out of compact mode. */}
      <TabBarGlassZone
        height={barTopInset}
        width={width}
        tint="dark"
        style={{ bottom: -metrics.bottomOffset }}
      />

      {/* ── Capsule ─────────────────────────────────────────────────────── */}
      <Animated.View style={[styles.shadow, capsuleAnimatedStyle]}>
        <TabBarGlass theme={theme} radius={metrics.capsuleHeight / 2} animatedStyle={capsuleGlassStyle} />

        <TabBarIndicator
          activeIndex={activeIndex}
          visible
          metrics={regularMetrics}
          compactMetrics={compactMetrics}
          progress={progress}
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
                animatedStyle={slotAnimatedStyle}
                hitSlop={isCompact ? compactHitSlop : undefined}
                onPress={() => openRoute(item.route)}
                onLongPress={() => onLongPress(item.route)}
                testID={`buyer-tab-${item.route}`}
                accessibilityLabel={label}
                badge={hasBadge ? <TabBarBadge count={badge} theme={theme} /> : null}
              >
                <Animated.View style={iconScaleStyle}>
                  <CrossfadeNavIcon
                    name={item.icon}
                    focused={focused}
                    theme={theme}
                    size={metrics.iconSize}
                    strokeWidth={iconStrokeWidth}
                  />
                </Animated.View>
              </TabBarSlot>
            );
          })}
        </View>
      </Animated.View>

      {/* ── Profile circle ──────────────────────────────────────────────── */}
      <TabBarCircle
        theme={theme}
        size={metrics.circleSize}
        animatedStyle={circleAnimatedStyle}
        glassAnimatedStyle={circleGlassStyle}
        hitSlop={isCompact ? compactCircleHitSlop : undefined}
        active={profileFocused}
        accessibilityLabel="Profile tab"
        selected={profileFocused}
        onPress={() => openRoute('profile')}
        onLongPress={() => onLongPress('profile')}
        testID="buyer-tab-profile"
      >
        <Animated.View style={iconScaleStyle}>
          <BuyerNavIcon
            name="profile"
            color={tabIconColor(theme, profileFocused)}
            focused={profileFocused}
            size={metrics.iconSize}
            strokeWidth={iconStrokeWidth}
          />
        </Animated.View>
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
