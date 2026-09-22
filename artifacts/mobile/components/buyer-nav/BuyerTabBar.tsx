import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type LayoutChangeEvent,
} from 'react-native';
import type { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { useBuyerSearch } from '@/contexts/BuyerSearchContext';
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { BuyerNavIcon, type BuyerNavIconName } from './BuyerNavIcon';
import { BUYER_TAB_SLOT_COUNT, useBuyerTabBarMetrics, type BuyerTabBarMetrics } from './buyerTabBarMetrics';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

// ─── Navigation contract ──────────────────────────────────────────────────────
// Capsule: Home · Discover · Inbox · Search. Separate circle: Profile, which
// becomes Close while search is open. Home never leaves the capsule.

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

// Critically damped with clamping: the morph settles in ~350ms and can never
// overshoot, so the capsule does not bounce when search opens or closes.
const MORPH_SPRING = { mass: 1, stiffness: 320, damping: 36, overshootClamping: true } as const;
const INDICATOR_SPRING = { mass: 1, stiffness: 420, damping: 40, overshootClamping: true } as const;
const REDUCED_MOTION = { duration: 160 } as const;

const FIELD_GLYPH_CENTER = 22;

// ─── Keyboard tracking ────────────────────────────────────────────────────────
// Mounted only while search is open, so Reanimated's Android inset listener is
// never attached while buyers type elsewhere in the app. Both translucency
// flags are set because the app is edge-to-edge; without them Reanimated would
// add status/navigation bar margins to the root view while subscribed.

function NativeKeyboardFollower({ target }: { target: SharedValue<number> }) {
  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  useAnimatedReaction(
    () => keyboard.height.value,
    (height) => { target.value = height; },
  );
  return null;
}

// Web has no software keyboard event. Development previews accept a simulated
// keyboard height so the search-open state can be reviewed in screenshots.
function WebKeyboardSimulator({ target }: { target: SharedValue<number> }) {
  useEffect(() => {
    if (!__DEV__ || typeof window === 'undefined') return undefined;
    const onSimulate = (event: Event) => {
      const height = Number((event as CustomEvent<number>).detail) || 0;
      target.set(withTiming(height, { duration: 250 }));
    };
    window.addEventListener('bt:simulate-keyboard', onSimulate);
    return () => window.removeEventListener('bt:simulate-keyboard', onSimulate);
  }, [target]);
  return null;
}

// ─── Glass surface ────────────────────────────────────────────────────────────

function GlassSurface({ theme, radius }: { theme: AppThemePreset; radius: number }) {
  // iOS and web get a live backdrop blur. expo-blur's Android blur needs the
  // whole navigator wrapped in a BlurTargetView, which cannot sample video
  // surfaces and redraws the feed every frame, so Android uses a denser tint.
  const hasBlur = Platform.OS !== 'android';
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }]}>
      {hasBlur && (
        <BlurView
          intensity={Platform.OS === 'ios' ? 60 : 70}
          tint={Platform.OS === 'ios' ? 'systemThinMaterialDark' : 'dark'}
          style={StyleSheet.absoluteFill}
        />
      )}
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: hasBlur ? `${theme.background}8C` : `${theme.surface}EB` },
        ]}
      />
      <LinearGradient
        colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
        ]}
      />
    </View>
  );
}

// ─── Unread badge ─────────────────────────────────────────────────────────────

function UnreadBadge({ count, theme }: { count: number; theme: AppThemePreset }) {
  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: theme.accent, borderColor: theme.background },
        label.length > 1 && { paddingHorizontal: 4 },
      ]}
    >
      <Text style={[styles.badgeText, { color: theme.onAccent }]} maxFontSizeMultiplier={1.1}>
        {label}
      </Text>
    </View>
  );
}

// ─── Tab slot ─────────────────────────────────────────────────────────────────

function TabSlot({
  item, focused, metrics, theme, badgeCount, onPress, onLongPress, testID, accessibilityLabel,
  hiddenForSearch,
}: {
  item: (typeof BUYER_TAB_ITEMS)[number];
  focused: boolean;
  metrics: BuyerTabBarMetrics;
  theme: AppThemePreset;
  badgeCount: number;
  onPress: () => void;
  onLongPress: () => void;
  testID: string;
  accessibilityLabel: string;
  hiddenForSearch: boolean;
}) {
  const color = focused ? theme.accent : theme.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      aria-hidden={hiddenForSearch}
      accessibilityElementsHidden={hiddenForSearch}
      importantForAccessibility={hiddenForSearch ? 'no-hide-descendants' : 'auto'}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={testID}
      style={({ pressed }) => [
        styles.slot,
        { width: metrics.itemWidth, height: metrics.capsuleHeight, pointerEvents: hiddenForSearch ? 'none' : 'auto' },
        pressed && styles.pressed,
      ]}
    >
      <View>
        <BuyerNavIcon name={item.icon} color={color} focused={focused} size={metrics.iconSize} />
        {item.route === 'inbox' && <UnreadBadge count={badgeCount} theme={theme} />}
      </View>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.2}
        style={[
          styles.label,
          { fontSize: metrics.labelSize, color: focused ? theme.text : theme.muted },
          focused && { fontFamily: FONT.semibold },
        ]}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

// ─── Bar ──────────────────────────────────────────────────────────────────────

export function BuyerTabBar({
  state,
  navigation,
  inboxBadgeCount,
}: BottomTabBarProps & { inboxBadgeCount: number }) {
  const metrics = useBuyerTabBarMetrics();
  const { theme } = useAppTheme();
  const reduceMotion = useReducedMotion();
  const {
    query, setQuery, requestFilters, submit, activeFilterCount, keyboardHeight,
  } = useBuyerSearch();
  const inputRef = useRef<TextInput>(null);

  const activeRoute = state.routes[state.index]?.name ?? 'index';
  const searchActive = activeRoute === 'search';
  const activeSlot = BUYER_ROUTE_SLOT[activeRoute] ?? null;
  const activeIndex = BUYER_TAB_ITEMS.findIndex(item => item.route === activeSlot);

  // Close returns to wherever search was opened from.
  const returnRouteRef = useRef<string>('index');
  useEffect(() => {
    if (!searchActive) returnRouteRef.current = activeRoute;
  }, [activeRoute, searchActive]);

  // ── Search morph ───────────────────────────────────────────────────────────
  const progress = useSharedValue(searchActive ? 1 : 0);
  // The field stays mounted until the closing animation finishes, then leaves
  // the tree so screen readers and UI tests only ever see one mode.
  const [fieldMounted, setFieldMounted] = useState(searchActive);

  useEffect(() => {
    const target = searchActive ? 1 : 0;
    if (searchActive) setFieldMounted(true);
    const onDone = (finished?: boolean) => {
      'worklet';
      if (finished && target === 0) runOnJS(setFieldMounted)(false);
    };
    progress.set(reduceMotion
      ? withTiming(target, REDUCED_MOTION, onDone)
      : withSpring(target, MORPH_SPRING, onDone));
    if (!searchActive) keyboardHeight.set(withTiming(0, { duration: 220 }));
  }, [searchActive, reduceMotion, progress, keyboardHeight]);

  useEffect(() => {
    if (!searchActive || !fieldMounted) return undefined;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [searchActive, fieldMounted]);

  // ── Measured geometry ──────────────────────────────────────────────────────
  // The slot row has an intrinsic width that never depends on the animation,
  // so measuring it cannot feed back into the layout it drives.
  const slotRowWidth = useSharedValue(metrics.itemWidth * BUYER_TAB_SLOT_COUNT);
  const searchExtraWidth = metrics.searchCapsuleWidth - metrics.capsuleWidth;
  const onSlotRowLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0 && Math.abs(width - slotRowWidth.get()) > 0.5) slotRowWidth.set(width);
  }, [slotRowWidth]);

  // ── Active indicator ───────────────────────────────────────────────────────
  const indicatorX = useSharedValue(Math.max(activeIndex, 0) * metrics.itemWidth);
  const indicatorVisible = useSharedValue(activeIndex >= 0 && !searchActive ? 1 : 0);
  useEffect(() => {
    // Entering search only fades the pill where it is; it never glides
    // under the field that is sliding in.
    if (activeIndex >= 0 && !searchActive) {
      const x = activeIndex * metrics.itemWidth;
      indicatorX.set(reduceMotion ? withTiming(x, REDUCED_MOTION) : withSpring(x, INDICATOR_SPRING));
    }
    indicatorVisible.set(withTiming(activeIndex >= 0 && !searchActive ? 1 : 0, { duration: 180 }));
  }, [activeIndex, searchActive, metrics.itemWidth, reduceMotion, indicatorX, indicatorVisible]);

  // ── Animated styles ────────────────────────────────────────────────────────
  const pad = metrics.capsulePadding;
  const fieldHeight = metrics.fieldHeight;

  const barStyle = useAnimatedStyle(() => {
    const lift = Math.max(0, keyboardHeight.value + metrics.keyboardGap - metrics.bottomOffset);
    return { transform: [{ translateY: -lift }] };
  });

  const capsuleStyle = useAnimatedStyle(() => {
    const base = slotRowWidth.value + pad * 2;
    return { width: base + searchExtraWidth * progress.value };
  });

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorVisible.value,
    transform: [{ translateX: indicatorX.value }],
  }));

  const fieldStyle = useAnimatedStyle(() => {
    const slot = slotRowWidth.value / BUYER_TAB_SLOT_COUNT;
    const capsuleWidth = slotRowWidth.value + pad * 2 + searchExtraWidth * progress.value;
    // Collapsed: a circle centred on the Search icon. Expanded: everything
    // right of Home. Both edges come from the measured slot width.
    const collapsedLeft = pad + slot * 3.5 - FIELD_GLYPH_CENTER;
    const expandedLeft = pad + slot + 2;
    const left = interpolate(progress.value, [0, 1], [collapsedLeft, expandedLeft]);
    const right = interpolate(progress.value, [0, 1], [collapsedLeft + fieldHeight, capsuleWidth - pad - 4]);
    return {
      left,
      width: Math.max(fieldHeight, right - left),
      opacity: interpolate(progress.value, [0, 0.18], [0, 1], Extrapolation.CLAMP),
    };
  });

  const fieldContentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.35, 0.85], [0, 1], Extrapolation.CLAMP),
  }));

  const coveredSlotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
    transform: [
      { translateX: interpolate(progress.value, [0, 1], [0, -10]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.9]) },
    ],
  }));

  const searchSlotStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.16], [1, 0], Extrapolation.CLAMP),
  }));

  const profileIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.5], [1, 0], Extrapolation.CLAMP),
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [0, -90])}deg` }, { scale: interpolate(progress.value, [0, 1], [1, 0.7]) }],
  }));

  const closeIconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.5, 1], [0, 1], Extrapolation.CLAMP),
    transform: [{ rotate: `${interpolate(progress.value, [0, 1], [90, 0])}deg` }, { scale: interpolate(progress.value, [0, 1], [0.7, 1]) }],
  }));

  // ── Actions ────────────────────────────────────────────────────────────────
  const dismissKeyboard = useCallback(() => {
    inputRef.current?.blur();
    Keyboard.dismiss();
  }, []);

  const openRoute = useCallback((routeName: string) => {
    const route = state.routes.find(candidate => candidate.name === routeName);
    const focused = activeRoute === routeName;
    const event = route
      ? navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
      : null;
    if (focused) {
      if (routeName === 'search') inputRef.current?.focus();
      return;
    }
    if (event?.defaultPrevented) return;
    hapticSelection();
    if (searchActive) dismissKeyboard();
    navigation.navigate(routeName as never);
  }, [activeRoute, dismissKeyboard, navigation, searchActive, state.routes]);

  const onLongPress = useCallback((routeName: string) => {
    const route = state.routes.find(candidate => candidate.name === routeName);
    if (route) navigation.emit({ type: 'tabLongPress', target: route.key });
  }, [navigation, state.routes]);

  const closeSearch = useCallback(() => {
    hapticLight();
    dismissKeyboard();
    setQuery('');
    const destination = returnRouteRef.current === 'search' ? 'index' : returnRouteRef.current;
    navigation.navigate(destination as never);
  }, [dismissKeyboard, navigation, setQuery]);

  const openFilters = useCallback(() => {
    hapticLight();
    dismissKeyboard();
    requestFilters();
  }, [dismissKeyboard, requestFilters]);

  const profileFocused = activeSlot === 'profile';
  const circleLabel = searchActive ? 'Close' : 'Profile';

  return (
    <Animated.View
      testID="buyer-bottom-tab-bar"
      style={[
        styles.bar,
        { bottom: metrics.bottomOffset, gap: metrics.gap },
        barStyle,
      ]}
    >
      {Platform.OS === 'web'
        ? <WebKeyboardSimulator target={keyboardHeight} />
        : searchActive && <NativeKeyboardFollower target={keyboardHeight} />}

      {/* ── Capsule ─────────────────────────────────────────────────────── */}
      <Animated.View
        style={[
          styles.shadow,
          { height: metrics.capsuleHeight, borderRadius: metrics.capsuleHeight / 2 },
          capsuleStyle,
        ]}
      >
        <GlassSurface theme={theme} radius={metrics.capsuleHeight / 2} />

        <Animated.View
          style={[
            styles.indicator,
            {
              left: pad + 3,
              top: 4,
              width: metrics.itemWidth - 6,
              height: metrics.capsuleHeight - 8,
              borderRadius: (metrics.capsuleHeight - 8) / 2,
            },
            indicatorStyle,
          ]}
        />

        <View
          accessibilityRole="tablist"
          onLayout={onSlotRowLayout}
          style={[styles.slotRow, { marginLeft: pad }]}
        >
          {BUYER_TAB_ITEMS.map((item) => {
            const focused = !searchActive && activeSlot === item.route;
            const isHome = item.route === 'index';
            const coveredBySearch = !isHome && searchActive;
            const badge = item.route === 'inbox' ? inboxBadgeCount : 0;
            const label = badge > 0
              ? `${item.label} tab, ${badge} unread ${badge === 1 ? 'item' : 'items'}`
              : `${item.label} tab`;
            const slot = (
              <TabSlot
                item={item}
                focused={focused}
                metrics={metrics}
                theme={theme}
                badgeCount={badge}
                onPress={() => openRoute(item.route)}
                onLongPress={() => onLongPress(item.route)}
                testID={isHome && searchActive ? 'buyer-search-home' : `buyer-tab-${item.route}`}
                accessibilityLabel={label}
                hiddenForSearch={coveredBySearch}
              />
            );
            if (isHome) return <View key={item.route}>{slot}</View>;
            return (
              <Animated.View
                key={item.route}
                style={item.route === 'search' ? searchSlotStyle : coveredSlotStyle}
              >
                {slot}
              </Animated.View>
            );
          })}
        </View>

        {fieldMounted && (
          <Animated.View
            style={[
              styles.field,
              {
                pointerEvents: searchActive ? 'box-none' : 'none',
                top: (metrics.capsuleHeight - fieldHeight) / 2,
                height: fieldHeight,
                borderRadius: fieldHeight / 2,
              },
              fieldStyle,
            ]}
          >
            <View style={[StyleSheet.absoluteFill, styles.fieldFill, { borderRadius: fieldHeight / 2 }]} />
            <View style={styles.fieldGlyph}>
              <BuyerNavIcon name="search" color={theme.text} size={20} strokeWidth={2} />
            </View>
            <Animated.View style={[styles.fieldContent, fieldContentStyle]}>
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={theme.muted}
                accessibilityLabel="Search Brandthread"
                accessibilityHint="Results update as you type"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                enablesReturnKeyAutomatically
                keyboardAppearance="dark"
                selectionColor={theme.accent}
                cursorColor={theme.accent}
                editable={searchActive}
                onSubmitEditing={submit}
                maxFontSizeMultiplier={1.3}
                testID="buyer-tab-search-input"
                style={[
                  styles.input,
                  { color: theme.text, fontSize: metrics.isTablet ? 16 : 15 },
                  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
                ]}
              />
              {query.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  onPress={() => { hapticSelection(); setQuery(''); inputRef.current?.focus(); }}
                  hitSlop={4}
                  testID="buyer-tab-search-clear"
                  style={({ pressed }) => [styles.fieldButton, pressed && styles.pressed]}
                >
                  <View style={[styles.clearDisc, { backgroundColor: `${theme.text}33` }]}>
                    <BuyerNavIcon name="close" color={theme.text} size={12} strokeWidth={2.4} />
                  </View>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={activeFilterCount > 0 ? `Open search filters, ${activeFilterCount} active` : 'Open search filters'}
                onPress={openFilters}
                hitSlop={4}
                testID="buyer-tab-search-filters"
                style={({ pressed }) => [styles.fieldButton, pressed && styles.pressed]}
              >
                <BuyerNavIcon name="filters" color={theme.accent} size={20} strokeWidth={1.9} />
                {activeFilterCount > 0 && (
                  <View style={[styles.filterDot, { backgroundColor: theme.accent, borderColor: theme.background }]} />
                )}
              </Pressable>
            </Animated.View>
          </Animated.View>
        )}
      </Animated.View>

      {/* ── Profile / Close circle ──────────────────────────────────────── */}
      <Pressable
        accessibilityRole={searchActive ? 'button' : 'tab'}
        accessibilityLabel={searchActive ? 'Close search' : 'Profile tab'}
        accessibilityState={searchActive ? {} : { selected: profileFocused }}
        aria-selected={searchActive ? undefined : profileFocused}
        onPress={searchActive ? closeSearch : () => openRoute('profile')}
        onLongPress={searchActive ? undefined : () => onLongPress('profile')}
        testID={searchActive ? 'buyer-search-close' : 'buyer-tab-profile'}
        style={({ pressed }) => [
          styles.shadow,
          {
            width: metrics.circleSize,
            height: metrics.circleSize,
            borderRadius: metrics.circleSize / 2,
          },
          pressed && styles.pressed,
        ]}
      >
        <GlassSurface theme={theme} radius={metrics.circleSize / 2} />
        {profileFocused && !searchActive && (
          <View
            style={[
              styles.circleActive,
              { borderRadius: (metrics.circleSize - 8) / 2 },
            ]}
          />
        )}
        <View style={styles.circleContent}>
          <View style={{ width: metrics.iconSize, height: metrics.iconSize }}>
            <Animated.View style={[StyleSheet.absoluteFill, profileIconStyle]}>
              <BuyerNavIcon
                name="profile"
                color={profileFocused ? theme.accent : theme.muted}
                focused={profileFocused}
                size={metrics.iconSize}
              />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, closeIconStyle]}>
              <BuyerNavIcon name="close" color={theme.text} size={metrics.iconSize} strokeWidth={2} />
            </Animated.View>
          </View>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[
              styles.label,
              { fontSize: metrics.labelSize, color: profileFocused || searchActive ? theme.text : theme.muted },
              (profileFocused || searchActive) && { fontFamily: FONT.semibold },
            ]}
          >
            {circleLabel}
          </Text>
        </View>
      </Pressable>
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
  shadow: {
    boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.38), 0px 2px 6px rgba(0, 0, 0, 0.22)',
  },
  slotRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
  },
  slot: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: {
    fontFamily: FONT.medium,
    lineHeight: 14,
    letterSpacing: 0.1,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  indicator: {
    position: 'absolute',
    pointerEvents: 'none',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  badge: {
    position: 'absolute',
    pointerEvents: 'none',
    top: -6,
    left: 14,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: FONT.bold,
    fontSize: 11,
    lineHeight: 13,
  },
  field: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  fieldFill: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  fieldGlyph: {
    pointerEvents: 'none',
    width: FIELD_GLYPH_CENTER * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldContent: {
    pointerEvents: 'box-none',
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  input: {
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    fontFamily: FONT.regular,
    padding: 0,
    marginLeft: -4,
  },
  fieldButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearDisc: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  circleActive: {
    position: 'absolute',
    pointerEvents: 'none',
    top: 4,
    left: 4,
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  circleContent: {
    pointerEvents: 'none',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
});
