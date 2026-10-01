import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSegments, type Tabs } from 'expo-router';
import Animated, {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticTabChange } from '@/lib/haptics';
import { useActivityUnreadCount } from '@/components/ActivityBellButton';
import {
  TAB_BAR_SHADOW, TabBarBadge, TabBarCircle, TabBarGlass, TabBarIndicator, TabBarSlot, CrossfadeNavIcon, tabIconColor,
  useTabBarActiveIndex,
} from '@/components/tab-bar/TabBarParts';
import { BuyerNavIcon, type BuyerNavIconName } from './BuyerNavIcon';
import { COMPACT_ICON_SCALE, COMPACT_ICON_STROKE_SCALE, useBuyerTabBarMetrics } from './buyerTabBarMetrics';
import { TAB_BAR_SLIDE_EASING, TAB_BAR_SLIDE_MS } from '@/constants/motion';
import { tabBarSlideTargetY } from '@/lib/tabBarSlide';
import { useTabBarHiddenByScreen } from '@/lib/tabBarVisibility';

// Smooth ease-out, no bounce/overshoot — this round's explicit spec for the
// compact <-> regular capsule transition (superseding the earlier SHEET_EASING/
// 260ms pairing for this one motion, same way #225/#344 superseded a shared
// constant for the pill).
const BAR_MODE_TIMING = { duration: 220, easing: Easing.bezier(0.2, 0, 0, 1) } as const;

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

// ─── Full-screen creation/story/video/live routes ──────────────────────────
// `BUYER_TAB_BAR_HIDDEN_ROUTES` above only covers routes registered INSIDE
// this Tabs navigator (`state.routes`) — it can't see a root-Stack sibling
// like buyer-story-create or camera-capture, which `detachInactiveScreens={
// false}` (app/(buyer)/_layout.tsx) keeps this whole Tabs navigator (and
// this bar) mounted underneath, just visually covered by. That covering
// screen is opaque (`contentStyle: OPAQUE_SCREEN_CONTENT`, app/_layout.tsx),
// so the bar was never actually visible through it — but it also never slid
// away, unlike the seller tab bar (SellerGlobalTabBar's `hidden` prop, same
// TAB_BAR_SLIDE_MS/tabBarSlideTargetY used below), which both looks
// inconsistent between the two shells and leaves no margin if that opacity
// assumption is ever wrong (a gesture-driven dismiss, a platform quirk).
// `useSegments()` reads the true current app-wide route regardless of
// whether this Tabs navigator is the one currently on top, same technique
// app/_layout.tsx's SellerBarGate uses.
//
// Regression guard: tests/tab-bar-full-screen-slide.test.ts asserts every
// buyer-reachable creation/story/video/live route below is covered.
const BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS = new Set([
  'camera-capture',
  'create-post',
  'buyer-story-create',
  'buyer-story-viewer',
  'story-mention-viewer',
  'buyer-live',
  'live-feed',
  'live',
]);

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
  const reducedMotion = useReducedMotion();

  const activeRoute = state.routes[state.index]?.name ?? 'index';
  const activeSlot = BUYER_ROUTE_SLOT[activeRoute] ?? null;
  const activeIndex = BUYER_TAB_ITEMS.findIndex(item => item.route === activeSlot);
  // Home is the only full-bleed video tab — every other buyer screen keeps
  // the regular capsule exactly as shipped.
  const isCompact = activeSlot === 'index';

  // True whenever a root-Stack full-screen creation/story/video/live route
  // is the one actually on top — see BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS'
  // doc above for why this can't be read from `state`/`activeRoute`.
  const segments = useSegments();
  const firstSegment = (segments[0] as string | undefined) ?? '';
  // Also slides away for any screen with a bottom composer (useHideTabBar).
  const hiddenByScreen = useTabBarHiddenByScreen();
  const isFullScreenRoute = BUYER_TAB_BAR_FULL_SCREEN_SEGMENTS.has(firstSegment) || hiddenByScreen;

  // Owns the pill's position so a tab press can kick the glide immediately,
  // before the tabPress event and the screen swap — see the hook's doc.
  const {
    x: indicatorX, target: indicatorTarget, opacity: indicatorOpacity,
    press: pressIndicator, hide: hideIndicator,
  } = useTabBarActiveIndex(activeIndex, reducedMotion);

  // 0 = regular, 1 = compact. Every animated style below reads this one
  // value so the capsule/circle/pill/icons all move as one coordinated
  // transition instead of several out-of-sync ones.
  //
  // Driven entirely on the UI thread off `indicatorTarget` (the same shared
  // value the pill's own eager glide uses — see useTabBarActiveIndex) rather
  // than a React useEffect keyed on the real, committed `isCompact`: a press
  // on Home (index 0) sets `indicatorTarget` to 0 on press-in, so this
  // reaction — and the capsule resize it drives — starts the same frame,
  // before the tabPress event and the destination screen's mount, instead of
  // waiting for React to commit the real navigation state and competing with
  // that mount for the JS thread.
  const progress = useSharedValue(isCompact ? 1 : 0);
  useAnimatedReaction(
    () => indicatorTarget.value === 0,
    (nowCompact, wasCompact) => {
      if (nowCompact === wasCompact) return;
      progress.set(reducedMotion ? (nowCompact ? 1 : 0) : withTiming(nowCompact ? 1 : 0, BAR_MODE_TIMING));
    },
    [reducedMotion],
  );

  // Capsule/circle scale factors, in "regular -> compact" ratio form so the
  // capsule and circle can each be rendered at a FIXED (regular) layout size
  // and resized purely with `transform: scale` — no width/height/borderRadius
  // animated per frame, so no relayout and no BlurView resize (TabBarGlass's
  // own box never changes size; only the whole already-blurred result gets
  // scaled down as one compositor operation). The capsule's own width and
  // height shrink by very slightly different ratios (~1% apart, see
  // buyerTabBarMetrics.ts's COMPACT_*_SCALE constants), so it gets its own
  // non-uniform scaleX/scaleY; the circle is a true circle in both modes
  // (circleSize === capsuleHeight always), so one scalar covers it exactly.
  const capsuleScaleX = compactMetrics.capsuleWidth / regularMetrics.capsuleWidth;
  const capsuleScaleY = compactMetrics.capsuleHeight / regularMetrics.capsuleHeight;
  // How far the circle needs to slide toward the capsule to close both the
  // capsule's own shrink (half its width delta, since it scales from its
  // center) and the gap's own shrink — derived once from the metrics
  // (plain numbers, not per-frame), not from an animated `gap` layout prop.
  const circleShiftXTarget = (compactMetrics.capsuleWidth - regularMetrics.capsuleWidth) / 2
    + (compactMetrics.circleSize - regularMetrics.circleSize) / 2
    + (compactMetrics.gap - regularMetrics.gap);

  const capsuleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scaleX: 1 + (capsuleScaleX - 1) * progress.value },
      { scaleY: 1 + (capsuleScaleY - 1) * progress.value },
    ],
  }));
  const circleAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: circleShiftXTarget * progress.value },
      { scale: 1 + (capsuleScaleY - 1) * progress.value },
    ],
  }));
  // Icons shrink less than the capsule itself ("slightly smaller", not
  // tiny). They're nested inside the capsule/circle's own transform above,
  // so this counter-scales against that parent scale first (dividing it
  // out) and then applies the icon's own, gentler target ratio — net result
  // is the icon's true COMPACT_ICON_SCALE regardless of how much its parent
  // shrunk, composited in the same frame as one transform, no extra layer.
  const slotIconScaleStyle = useAnimatedStyle(() => {
    const iconScale = 1 + (COMPACT_ICON_SCALE - 1) * progress.value;
    const parentScaleX = 1 + (capsuleScaleX - 1) * progress.value;
    const parentScaleY = 1 + (capsuleScaleY - 1) * progress.value;
    return { transform: [{ scaleX: iconScale / parentScaleX }, { scaleY: iconScale / parentScaleY }] };
  });
  const circleIconScaleStyle = useAnimatedStyle(() => {
    const iconScale = 1 + (COMPACT_ICON_SCALE - 1) * progress.value;
    const parentScale = 1 + (capsuleScaleY - 1) * progress.value;
    return { transform: [{ scale: iconScale / parentScale }] };
  });
  // Static (not interpolated) compensation: a smaller icon rendered with a
  // proportionally heavier stroke reads as the same visual weight instead of
  // going thin. Snapping this once per mode (rather than animating it frame
  // by frame) is imperceptible over a 220ms transition and keeps the vector
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
    if (event?.defaultPrevented) {
      // The press-in already moved the pill ahead of this tab's own
      // navigation — a listener vetoing it means that never happens, so put
      // the pill (and, for Profile, its hidden state) back where it was.
      if (activeIndex >= 0) pressIndicator(activeIndex);
      else hideIndicator();
      return;
    }
    hapticTabChange();
    navigation.navigate(routeName as never);
  }, [activeRoute, activeIndex, navigation, state.routes, pressIndicator, hideIndicator]);

  const onLongPress = React.useCallback((routeName: string) => {
    const route = state.routes.find(candidate => candidate.name === routeName);
    if (route) navigation.emit({ type: 'tabLongPress', target: route.key });
  }, [navigation, state.routes]);

  const profileFocused = activeSlot === 'profile';

  // ── Slide off/on screen for full-screen creation/story/video/live routes
  // (`isFullScreenRoute`) — same TAB_BAR_SLIDE_MS/TAB_BAR_SLIDE_EASING/
  // tabBarSlideTargetY the seller tab bar uses (SellerGlobalTabBar.tsx),
  // including the onLayout-measured (not guessed) offscreen distance and
  // the guaranteed-end-state discipline documented in lib/tabBarSlide.ts.
  // This must run before BUYER_TAB_BAR_HIDDEN_ROUTES's early return below so
  // hook order stays stable.
  const [barHeight, setBarHeight] = useState(96);
  const offscreenY = barHeight + metrics.bottomOffset;
  const translateY = useSharedValue(isFullScreenRoute ? offscreenY : 0);
  useEffect(() => {
    translateY.set(withTiming(tabBarSlideTargetY(isFullScreenRoute, offscreenY), {
      duration: TAB_BAR_SLIDE_MS,
      easing: TAB_BAR_SLIDE_EASING,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullScreenRoute, offscreenY]);
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  // Pushed, modal-style screens (Edit profile) never show the floating bar.
  // This check runs after every hook above so hook order stays stable while
  // the bar itself mounts/unmounts as the user navigates in and out.
  if (BUYER_TAB_BAR_HIDDEN_ROUTES.has(activeRoute)) return null;

  return (
    <Animated.View
      testID="buyer-bottom-tab-bar"
      onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}
      pointerEvents={isFullScreenRoute ? 'none' : 'box-none'}
      style={[
        styles.bar,
        { bottom: metrics.bottomOffset, gap: metrics.gap },
        slideStyle,
      ]}
    >
      {/* ── Capsule ─────────────────────────────────────────────────────── */}
      {/* Fixed at its regular layout size always — `capsuleAnimatedStyle`
          resizes it purely via `transform: scale`, so this box (and the
          TabBarGlass/BlurView inside it) never triggers a relayout. */}
      <Animated.View
        style={[
          styles.shadow,
          { width: regularMetrics.capsuleWidth, height: regularMetrics.capsuleHeight, borderRadius: regularMetrics.capsuleHeight / 2 },
          capsuleAnimatedStyle,
        ]}
      >
        <TabBarGlass theme={theme} radius={regularMetrics.capsuleHeight / 2} />

        <TabBarIndicator
          x={indicatorX}
          target={indicatorTarget}
          opacity={indicatorOpacity}
          metrics={regularMetrics}
          theme={theme}
        />

        <View
          accessibilityRole="tablist"
          style={[styles.slotRow, { marginLeft: metrics.capsulePadding }]}
        >
          {BUYER_TAB_ITEMS.map((item, index) => {
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
                theme={theme}
                hitSlop={isCompact ? compactHitSlop : undefined}
                onPress={() => openRoute(item.route)}
                onPressIn={() => pressIndicator(index)}
                onLongPress={() => onLongPress(item.route)}
                testID={`buyer-tab-${item.route}`}
                accessibilityLabel={label}
                badge={hasBadge ? <TabBarBadge count={badge} theme={theme} /> : null}
                pillTarget={indicatorTarget}
                pillIndex={index}
              >
                <Animated.View style={slotIconScaleStyle}>
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
      {/* Also fixed at its regular size — `circleAnimatedStyle` both shrinks
          it (transform: scale) and slides it toward the capsule by exactly
          the space that shrink + the gap's own shrink reclaim, in place of
          animating `gap` (a real layout property on `styles.bar`'s row). */}
      <TabBarCircle
        theme={theme}
        size={metrics.circleSize}
        animatedStyle={circleAnimatedStyle}
        hitSlop={isCompact ? compactCircleHitSlop : undefined}
        active={profileFocused}
        accessibilityLabel="Profile tab"
        selected={profileFocused}
        onPress={() => openRoute('profile')}
        onPressIn={hideIndicator}
        onLongPress={() => onLongPress('profile')}
        testID="buyer-tab-profile"
      >
        <Animated.View style={circleIconScaleStyle}>
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
  },
  // Shadow lives on an unclipped wrapper; the glass inside clips to the radius.
  shadow: TAB_BAR_SHADOW,
  slotRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
  },
});
