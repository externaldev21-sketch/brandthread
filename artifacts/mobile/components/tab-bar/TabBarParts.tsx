import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  Extrapolation,
} from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { identityOrNone } from '@/lib/animationUtils';
import { FONT } from '@/lib/theme';
import type { TabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';

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
// Pill glide: a touch of overshoot so arrivals feel physical, never floaty.
export const INDICATOR_SPRING = { mass: 0.9, stiffness: 360, damping: 26 } as const;
const REDUCED_MOTION = { duration: 160 } as const;

// ─── Glass surface ────────────────────────────────────────────────────────────

export function TabBarGlass({ theme, radius }: { theme: AppThemePreset; radius: number }) {
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
        colors={['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.03)', 'rgba(255,255,255,0)']}
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
}) {
  const { onPressIn, onPressOut, iconStyle } = useTabMotion(focused);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      aria-hidden={hidden}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      style={[styles.slot, { width, height, pointerEvents: hidden ? 'none' : 'auto' }]}
    >
      <Animated.View style={iconStyle}>
        {children}
        {badge}
      </Animated.View>
    </Pressable>
  );
}

// ─── Side circle (Profile / Close, Studio, AI) ───────────────────────────────

export function TabBarCircle({
  theme, size, active = false, onPress, onLongPress, testID, accessibilityLabel, accessibilityRole = 'button',
  selected, children,
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
}) {
  const { onPressIn, onPressOut, iconStyle } = useTabMotion(active);
  const inset = 5;
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? {} : { selected }}
      aria-selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      testID={testID}
      style={[TAB_BAR_SHADOW, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <TabBarGlass theme={theme} radius={size / 2} />
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
    </Pressable>
  );
}

// ─── Gliding active pill ──────────────────────────────────────────────────────

/**
 * The pill behind the active icon. It glides on a lightly under-damped spring
 * and stretches toward where it's heading while in flight, then snaps back to
 * its resting size, so switching tabs feels like dragging a drop of liquid.
 */
export function TabBarIndicator({
  activeIndex, visible, metrics, theme,
}: {
  activeIndex: number;
  visible: boolean;
  metrics: TabBarMetrics;
  theme: AppThemePreset;
}) {
  const reduceMotion = useReducedMotion();
  const restingX = Math.max(activeIndex, 0) * metrics.itemWidth;
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
      else x.set(withSpring(restingX, INDICATOR_SPRING));
    }
    opacity.set(withTiming(shown ? 1 : 0, { duration: 180 }));
  }, [shown, restingX, reduceMotion, x, target, opacity]);

  const pad = metrics.capsulePadding;
  const baseWidth = metrics.indicatorWidth;
  const maxStretch = metrics.itemWidth * 0.55;

  const style = useAnimatedStyle(() => {
    const distance = Math.abs(target.value - x.value);
    const stretch = Math.min(distance * 0.45, maxStretch);
    const width = baseWidth + stretch;
    // The leading edge reaches ahead toward the destination tab.
    const direction = target.value >= x.value ? 1 : -1;
    const center = x.value + metrics.itemWidth / 2 + (direction * stretch) / 2;
    return {
      opacity: opacity.value,
      width,
      left: pad + center - width / 2,
      transform: [{ scaleY: 1 - Math.min(stretch / maxStretch, 1) * 0.12 }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.indicator,
        {
          top: (metrics.capsuleHeight - metrics.indicatorHeight) / 2,
          height: metrics.indicatorHeight,
          borderRadius: metrics.indicatorHeight / 2,
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
