import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { identityOrNone } from '@/lib/animationUtils';
import { a11yHidden } from '@/lib/a11yHidden';
import { FONT } from '@/lib/theme';
import type { TabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { BuyerNavIcon, type BuyerNavIconName } from '@/components/buyer-nav/BuyerNavIcon';

/**
 * Shared building blocks for the buyer and seller floating tab bars.
 *
 * Both bars are drawn from these parts so they share one glass surface, one
 * icon-only slot, one gliding active pill and one feel: slots squish under the
 * finger and spring back, the newly selected icon pops, and the pill stretches
 * like liquid as it glides between tabs. Only the icons differ per side.
 */

// Press: a quick, firm squish, then a bouncy release that settles in ~300ms.
const PRESS_IN = { mass: 0.6, stiffness: 700, damping: 30 } as const;
const PRESS_OUT = { mass: 0.6, stiffness: 420, damping: 11 } as const;
// Selection pop: overshoot a little, then settle.
const POP_UP = { mass: 0.5, stiffness: 650, damping: 14 } as const;
const POP_SETTLE = { mass: 0.6, stiffness: 300, damping: 12 } as const;
// Pill glide between tabs: a plain ease-out timing, not a spring — the
// spring this replaced (mass 0.9/stiffness 360/damping 26, damping ratio
// ~0.72) was deliberately underdamped for "a touch of overshoot," which is
// exactly what the "FEEL 10x better" pass's own gate rules out (no bounce/
// overshoot anywhere). 220ms sits in the requested 200-250ms window.
const INDICATOR_TIMING = { duration: 220, easing: Easing.out(Easing.cubic) } as const;
const REDUCED_MOTION = { duration: 160 } as const;

// Wraps Pressable so it can take a Reanimated-driven `style` (the buyer bar's
// compact/regular capsule transition) alongside its normal static style —
// every prior call site that never passes an animated style renders exactly
// as before, since a plain style array works on an animated component too.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// ─── Glass surface ────────────────────────────────────────────────────────────

export function TabBarGlass({ theme, radius, animatedStyle }: { theme: AppThemePreset; radius: number; animatedStyle?: object }) {
  // iOS and web get a live backdrop blur. expo-blur's Android blur needs the
  // whole navigator wrapped in a BlurTargetView, which cannot sample video
  // surfaces and redraws the feed every frame, so Android uses a denser tint.
  const hasBlur = Platform.OS !== 'android';
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden', pointerEvents: 'none' }, animatedStyle]}>
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
        colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)' },
          animatedStyle,
        ]}
      />
    </Animated.View>
  );
}

// ─── Unread badge ─────────────────────────────────────────────────────────────

export function TabBarBadge({ count, theme }: { count: number; theme: AppThemePreset }) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(count > 0 ? 1 : 0);
  const previous = useRef(count);

  useEffect(() => {
    const was = previous.current;
    previous.current = count;
    if (count <= 0) {
      scale.set(withTiming(0, { duration: 140 }));
      return;
    }
    if (reduceMotion) {
      scale.set(1);
      return;
    }
    // Appearing springs in from nothing; a rising count gives a small bump.
    scale.set(was <= 0
      ? withSpring(1, POP_SETTLE)
      : count > was
        ? withSequence(withSpring(1.25, POP_UP), withSpring(1, POP_SETTLE))
        : 1);
  }, [count, reduceMotion, scale]);

  // At rest (no pop in progress) scale.value is 1 — an identity transform
  // that `identityOrNone` drops, instead of leaving every unread-count badge
  // pinned to its own `matrix(1,0,0,1,0,0)` compositing layer on web, which
  // would otherwise blur this fine-print number for as long as it's shown.
  const style = useAnimatedStyle(() => ({ transform: identityOrNone([{ scale: scale.value }]) }));

  if (count <= 0) return null;
  const label = count > 99 ? '99+' : String(count);
  return (
    <Animated.View
      style={[
        styles.badge,
        { backgroundColor: theme.accent, borderColor: theme.background },
        label.length > 1 && { paddingHorizontal: 4 },
        style,
      ]}
    >
      <Text style={[styles.badgeText, { color: theme.onAccent }]} maxFontSizeMultiplier={1.1}>
        {label}
      </Text>
    </Animated.View>
  );
}

// ─── Squishy press + selection pop ────────────────────────────────────────────

/** Scale/translate driven by press state and by becoming selected. */
function useTabMotion(focused: boolean) {
  const reduceMotion = useReducedMotion();
  const press = useSharedValue(0);
  const pop = useSharedValue(1);
  const wasFocused = useRef(focused);

  useEffect(() => {
    // Only a change *to* selected pops — never on first mount.
    if (focused && !wasFocused.current && !reduceMotion) {
      pop.set(withSequence(withSpring(1.18, POP_UP), withSpring(1, POP_SETTLE)));
    }
    wasFocused.current = focused;
  }, [focused, reduceMotion, pop]);

  const onPressIn = () => {
    if (reduceMotion) return;
    press.set(withSpring(1, PRESS_IN));
  };
  const onPressOut = () => {
    press.set(reduceMotion ? withTiming(0, REDUCED_MOTION) : withSpring(0, PRESS_OUT));
  };

  const iconStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(pop.value, [1, 1.18], [0, -2.5], Extrapolation.CLAMP) },
      { scale: pop.value * interpolate(press.value, [0, 1], [1, 0.82]) },
    ],
  }));

  return { onPressIn, onPressOut, iconStyle };
}

// ─── Icon-only tab slot ───────────────────────────────────────────────────────

export function TabBarSlot({
  focused, width, height, onPress, onLongPress, testID, accessibilityLabel, hidden = false, badge, children,
  animatedStyle, hitSlop,
}: {
  focused: boolean;
  width: number;
  height: number;
  onPress: () => void;
  onLongPress?: () => void;
  testID: string;
  accessibilityLabel: string;
  /** Visually covered (buyer search) — removed from touch and screen readers. */
  hidden?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
  /** Reanimated style layered on top of the static width/height above — the
   *  buyer bar's only use of this is the compact/regular capsule transition;
   *  every other call site (seller bar, buyer search) omits it and renders
   *  identically to before. */
  animatedStyle?: object;
  /** Extends the touch target beyond the visual slot — the buyer bar uses
   *  this in compact mode so the tappable area never shrinks below 44pt even
   *  though the visual glyph does. */
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
}) {
  const { onPressIn, onPressOut, iconStyle } = useTabMotion(focused);
  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      {...a11yHidden(hidden)}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      hitSlop={hitSlop}
      style={[styles.slot, { width, height, pointerEvents: hidden ? 'none' : 'auto' }, animatedStyle]}
    >
      <Animated.View style={iconStyle}>
        {children}
        {badge}
      </Animated.View>
    </AnimatedPressable>
  );
}

// ─── Side circle (Profile / Close, Studio, AI) ───────────────────────────────

export function TabBarCircle({
  theme, size, active = false, onPress, onLongPress, testID, accessibilityLabel, accessibilityRole = 'button',
  selected, children, animatedStyle, hitSlop, glassAnimatedStyle,
}: {
  theme: AppThemePreset;
  size: number;
  active?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  testID: string;
  accessibilityLabel: string;
  accessibilityRole?: 'button' | 'tab';
  selected?: boolean;
  children: React.ReactNode;
  /** Reanimated style layered on top of the static size above — see
   *  TabBarSlot's `animatedStyle` doc; only the buyer bar's compact/regular
   *  transition uses this, every other call site is unaffected. */
  animatedStyle?: object;
  /** Extends the touch target beyond the visual circle in compact mode. */
  hitSlop?: { top?: number; bottom?: number; left?: number; right?: number };
  /** Reanimated style layered onto the inner glass surface's own radius so
   *  its corner rounding tracks an animated `size` (see `animatedStyle`). */
  glassAnimatedStyle?: object;
}) {
  const { onPressIn, onPressOut, iconStyle } = useTabMotion(active);
  const inset = 5;
  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? {} : { selected }}
      aria-selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      hitSlop={hitSlop}
      style={[TAB_BAR_SHADOW, { width: size, height: size, borderRadius: size / 2 }, animatedStyle]}
    >
      <TabBarGlass theme={theme} radius={size / 2} animatedStyle={glassAnimatedStyle} />
      {active && (
        <View
          style={[
            styles.activeFill,
            {
              top: inset, left: inset, right: inset, bottom: inset,
              borderRadius: (size - inset * 2) / 2,
              backgroundColor: `${theme.accent}26`,
              borderColor: `${theme.accent}59`,
            },
          ]}
        />
      )}
      <Animated.View style={[styles.circleContent, iconStyle]}>{children}</Animated.View>
    </AnimatedPressable>
  );
}

// ─── Gliding active pill ──────────────────────────────────────────────────────

/**
 * The pill behind the active icon. It glides on a lightly under-damped spring
 * and stretches toward where it's heading while in flight, then snaps back to
 * its resting size, so switching tabs feels like dragging a drop of liquid.
 */
export function TabBarIndicator({
  activeIndex, visible, metrics, theme, progress, compactMetrics,
}: {
  activeIndex: number;
  visible: boolean;
  metrics: TabBarMetrics;
  theme: AppThemePreset;
  /** 0 (regular) → 1 (compact) — only the buyer bar passes this, to shrink
   *  the pill together with the capsule/circle during the compact-mode
   *  transition. Omitted everywhere else, which renders exactly as before. */
  progress?: SharedValue<number>;
  /** The compact-mode counterpart of `metrics`, required alongside `progress`. */
  compactMetrics?: TabBarMetrics;
}) {
  const reduceMotion = useReducedMotion();
  // Tracked in slot-index "units" rather than raw pixels so the resting/glide
  // position stays correct while `itemWidth` itself is also animating
  // between its regular and compact values (see the style worklet below) —
  // a pixel-space position computed against one fixed itemWidth would no
  // longer line up once the capsule has resized.
  const restingX = Math.max(activeIndex, 0);
  const x = useSharedValue(restingX);
  const target = useSharedValue(restingX);
  const opacity = useSharedValue(visible && activeIndex >= 0 ? 1 : 0);
  const shown = visible && activeIndex >= 0;

  useEffect(() => {
    if (shown) {
      target.set(restingX);
      // Appearing (e.g. back from Profile or search) fades in place; only a
      // move between tabs glides.
      if (opacity.get() < 0.5 || reduceMotion) x.set(reduceMotion ? withTiming(restingX, REDUCED_MOTION) : restingX);
      else x.set(withTiming(restingX, INDICATOR_TIMING));
    }
    opacity.set(withTiming(shown ? 1 : 0, { duration: 180 }));
  }, [shown, restingX, reduceMotion, x, target, opacity]);

  const style = useAnimatedStyle(() => {
    const p = progress && compactMetrics ? progress.value : 0;
    const itemWidth = compactMetrics ? interpolate(p, [0, 1], [metrics.itemWidth, compactMetrics.itemWidth]) : metrics.itemWidth;
    const pad = compactMetrics ? interpolate(p, [0, 1], [metrics.capsulePadding, compactMetrics.capsulePadding]) : metrics.capsulePadding;
    const baseWidth = compactMetrics ? interpolate(p, [0, 1], [metrics.indicatorWidth, compactMetrics.indicatorWidth]) : metrics.indicatorWidth;
    const capsuleHeight = compactMetrics ? interpolate(p, [0, 1], [metrics.capsuleHeight, compactMetrics.capsuleHeight]) : metrics.capsuleHeight;
    const indicatorHeight = compactMetrics ? interpolate(p, [0, 1], [metrics.indicatorHeight, compactMetrics.indicatorHeight]) : metrics.indicatorHeight;
    const maxStretch = itemWidth * 0.55;

    const distanceUnits = Math.abs(target.value - x.value);
    const distance = distanceUnits * itemWidth;
    const stretch = Math.min(distance * 0.45, maxStretch);
    const width = baseWidth + stretch;
    // The leading edge reaches ahead toward the destination tab.
    const direction = target.value >= x.value ? 1 : -1;
    const center = (x.value + 0.5) * itemWidth + (direction * stretch) / 2;
    return {
      opacity: opacity.value,
      width,
      height: indicatorHeight,
      top: (capsuleHeight - indicatorHeight) / 2,
      borderRadius: indicatorHeight / 2,
      left: pad + center - width / 2,
      transform: [{ scaleY: 1 - Math.min(stretch / maxStretch, 1) * 0.12 }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.indicator,
        {
          backgroundColor: `${theme.accent}26`,
          borderColor: `${theme.accent}59`,
        },
        style,
      ]}
    />
  );
}

/** Colour for a tab icon. */
export function tabIconColor(theme: AppThemePreset, focused: boolean) {
  return focused ? theme.accent : theme.muted;
}

// Cross-fade duration for the outline -> filled icon swap — same 220ms
// window as the pill's own glide (INDICATOR_TIMING) so both read as one
// motion instead of two out-of-sync ones.
const ICON_CROSSFADE_MS = 220;

/**
 * Tab icon that cross-fades between its outline (unfocused) and filled
 * (focused) rendering instead of `BuyerNavIcon`'s own instant `fill` swap —
 * two stacked copies (outline always underneath, filled on top), only their
 * opacity animated. Colour changes (muted -> accent) ride along for free
 * since it's the same crossfade.
 */
export function CrossfadeNavIcon({
  name, focused, theme, size, strokeWidth,
}: {
  name: BuyerNavIconName;
  focused: boolean;
  theme: AppThemePreset;
  size: number;
  /** Overrides BuyerNavIcon's default 1.8 stroke — the buyer bar's compact
   *  mode passes a slightly heavier stroke here so a smaller icon keeps the
   *  same visual weight instead of reading thin. */
  strokeWidth?: number;
}) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    const target = focused ? 1 : 0;
    progress.set(reduceMotion ? withTiming(target, REDUCED_MOTION) : withTiming(target, { duration: ICON_CROSSFADE_MS }));
  }, [focused, reduceMotion, progress]);

  const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const filledStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View style={[StyleSheet.absoluteFill, outlineStyle]}>
        <BuyerNavIcon name={name} color={tabIconColor(theme, false)} focused={false} size={size} strokeWidth={strokeWidth} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, filledStyle]}>
        <BuyerNavIcon name={name} color={tabIconColor(theme, true)} focused size={size} strokeWidth={strokeWidth} />
      </Animated.View>
    </View>
  );
}

// Shadow lives on an unclipped wrapper; the glass inside clips to the radius.
export const TAB_BAR_SHADOW = {
  boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.38), 0px 2px 6px rgba(0, 0, 0, 0.22)',
} as const;

const styles = StyleSheet.create({
  slot: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    pointerEvents: 'none',
    borderWidth: StyleSheet.hairlineWidth,
  },
  activeFill: {
    position: 'absolute',
    pointerEvents: 'none',
    borderWidth: StyleSheet.hairlineWidth,
  },
  circleContent: {
    pointerEvents: 'none',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
});
