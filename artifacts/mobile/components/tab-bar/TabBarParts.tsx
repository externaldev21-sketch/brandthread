import React, { useCallback, useEffect, useRef } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  interpolate,
  useAnimatedReaction,
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
import { Glass } from '@/components/ui/Glass';
import { radius, nestedRadius } from '@/constants/radii';
import {
  MAX_STRETCH_SLOTS, WEB_NAV_AFTER_PRESS_MS, currentStretch, planGlide,
} from '@/components/tab-bar/pillGlide';


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
// Pill glide between tabs, and the selected icon's pop — one spring drives
// both so they read as a single coordinated motion instead of two out-of-sync
// ones. Critically damped (damping 70 ≈ 2·√1200) so it can never ring past
// its target, and stiff enough to be front-loaded: ~30% of the way there on
// the second frame, ~90% by ~115ms, landed by ~215ms. The previous
// under-damped 220/20 spring (clamped at the target) only covered 3% in its
// first frame and 50% at ~100ms, then hit the target at full speed — a slow
// start and an abrupt stop, which is what read as a laggy, glitchy glide.
// `energyThreshold` ends the spring once it's within ~1% of the slot (well
// under a pixel for a one-tab move) instead of letting an invisible
// sub-pixel tail keep the pill's style worklet running for another ~170ms.
export const INDICATOR_SPRING = {
  mass: 1, stiffness: 1200, damping: 70, overshootClamping: true, energyThreshold: 1e-4,
} as const;
const REDUCED_MOTION = { duration: 160 } as const;

// Wraps Pressable so it can take a Reanimated-driven `style` (the buyer bar's
// compact/regular capsule transition) alongside its normal static style —
// every prior call site that never passes an animated style renders exactly
// as before, since a plain style array works on an animated component too.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// react-native-web's Pressable holds `onPressIn` back 50ms by default (to
// tell a tap from a scroll), so on web the pill and pop only started once
// that timer fired or the finger lifted. The tab bar never scrolls, so its
// slots fire press-in on the same frame as touch-down. Native Pressable
// already defaults to no press-in delay.
const NO_PRESS_IN_DELAY = (Platform.OS === 'web' ? { delayPressIn: 0 } : {}) as object;

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
function useTabMotion(
  focused: boolean,
  /** The shared pill-target position and this slot's own index (see
   *  `useTabBarActiveIndex`) — when given, the pop fires the instant a press
   *  sets `pillTarget` to `pillIndex`, on the UI thread, in the same frame
   *  the pill's own spring kicks off, rather than waiting for `focused` to
   *  flip after React commits the real navigation state. */
  pillTarget?: SharedValue<number>,
  pillIndex?: number,
) {
  const reduceMotion = useReducedMotion();
  const press = useSharedValue(0);
  const pop = useSharedValue(1);
  const wasFocused = useRef(focused);

  const popIn = useCallback(() => {
    pop.set(withSequence(withSpring(1.18, INDICATOR_SPRING), withSpring(1, INDICATOR_SPRING)));
  }, [pop]);

  useEffect(() => {
    // Correctness fallback for a focus change that never went through a
    // press below (back button, deep link, programmatic navigation). Only a
    // change *to* selected pops — never on first mount.
    if (focused && !wasFocused.current && !reduceMotion) popIn();
    wasFocused.current = focused;
  }, [focused, reduceMotion, popIn]);

  useAnimatedReaction(
    () => (pillTarget !== undefined && pillIndex !== undefined ? pillTarget.value === pillIndex : false),
    (isTarget, wasTarget) => {
      if (pillTarget === undefined || pillIndex === undefined || reduceMotion) return;
      if (isTarget && wasTarget === false) {
        pop.set(withSequence(withSpring(1.18, INDICATOR_SPRING), withSpring(1, INDICATOR_SPRING)));
      }
    },
    [pillIndex, reduceMotion],
  );

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

  // Fills in under the icon on press — a fixed-diameter circle (not the
  // slot's own width) so it's never clipped at the ends of a row: see
  // `PRESS_HIGHLIGHT_SIZE`/`highlightStyle` at each call site.
  const highlightStyle = useAnimatedStyle(() => ({ opacity: press.value }));

  return { onPressIn, onPressOut, iconStyle, highlightStyle };
}

/**
 * Every press/active highlight in the tab bar is this same fixed-diameter
 * circle, centered on the touch target — never sized to the row/slot's own
 * (often edge-adjacent) width, which is what let it read as "cut off flat"
 * on the first/last item (see tests/seller-tab-switch-transition.test.ts).
 */
const PRESS_HIGHLIGHT_SIZE = 40;

// ─── Icon-only tab slot ───────────────────────────────────────────────────────

export function TabBarSlot({
  focused, width, height, onPress, onPressIn: onExternalPressIn, onLongPress, testID, accessibilityLabel, hidden = false, badge, children,
  animatedStyle, hitSlop, pillTarget, pillIndex, theme,
}: {
  focused: boolean;
  width: number;
  height: number;
  onPress: () => void;
  /** Tints the press highlight — see PRESS_HIGHLIGHT_SIZE. */
  theme: AppThemePreset;
  /** Fires before `onPress`/the real navigation commit — the tab bars use
   *  this to kick the pill's spring and this slot's own pop immediately on
   *  touch-down (see `pillTarget`/`pillIndex`), so the glide starts the same
   *  frame the finger lands instead of waiting on React + the screen swap. */
  onPressIn?: () => void;
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
  /** This slot's shared pill-target position and its own index — see
   *  `useTabMotion`'s eager pop. Omitted where there's no pill (none
   *  currently — both bars' capsule slots pass these). */
  pillTarget?: SharedValue<number>;
  pillIndex?: number;
}) {
  const { onPressIn, onPressOut, iconStyle, highlightStyle } = useTabMotion(focused, pillTarget, pillIndex);
  const handlePressIn = () => {
    onExternalPressIn?.();
    onPressIn();
  };
  return (
    <AnimatedPressable
      accessibilityRole="tab"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      aria-selected={focused}
      {...a11yHidden(hidden)}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={onPressOut}
      testID={testID}
      hitSlop={hitSlop}
      {...NO_PRESS_IN_DELAY}
      style={[styles.slot, { width, height, pointerEvents: hidden ? 'none' : 'auto' }, animatedStyle]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pressHighlight,
          { backgroundColor: `${theme.accent}22` },
          highlightStyle,
        ]}
      />
      <Animated.View style={iconStyle}>
        {children}
        {badge}
      </Animated.View>
    </AnimatedPressable>
  );
}

// ─── Side circle (Profile / Close, Studio, AI) ───────────────────────────────

export function TabBarCircle({
  theme, size, active = false, onPress, onPressIn: onExternalPressIn, onLongPress, testID, accessibilityLabel, accessibilityRole = 'button',
  selected, children, animatedStyle, hitSlop, glassAnimatedStyle,
}: {
  theme: AppThemePreset;
  size: number;
  active?: boolean;
  onPress: () => void;
  /** Fires before `onPress` — the buyer bar's Profile circle uses this to
   *  eagerly hide the capsule's pill (see `useTabBarActiveIndex.hide`) the
   *  instant it's pressed, since Profile isn't one of the pill's slots. */
  onPressIn?: () => void;
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
  const { onPressIn, onPressOut, iconStyle, highlightStyle } = useTabMotion(active);
  const handlePressIn = () => {
    onExternalPressIn?.();
    onPressIn();
  };
  const inset = 5;
  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? {} : { selected }}
      aria-selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={onPressOut}
      testID={testID}
      hitSlop={hitSlop}
      {...NO_PRESS_IN_DELAY}
      style={[TAB_BAR_SHADOW, { width: size, height: size, borderRadius: radius.bar }, animatedStyle]}
    >
      <TabBarGlass theme={theme} radius={radius.bar} animatedStyle={glassAnimatedStyle} />
      {/* Full-circle press fill — this button IS the circle (no row/capsule
          edge to clip against), so it's sized to the whole button rather
          than the fixed PRESS_HIGHLIGHT_SIZE the packed capsule slots use. */}
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.bar, backgroundColor: `${theme.accent}22` },
          highlightStyle,
        ]}
      />
      {active && (
        <View
          style={[
            styles.activeFill,
            {
              top: inset, left: inset, right: inset, bottom: inset,
              borderRadius: nestedRadius(radius.bar, inset),
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
 * Owns the pill's position, so a tab bar can kick the glide from a press
 * *before* React commits the real navigation state — call `press(index)`
 * from a slot's `onPressIn`. `x`/`target`/`opacity` feed `TabBarIndicator`
 * directly, and the same `target` also drives each slot's eager icon pop
 * (see `useTabMotion`'s `pillTarget`/`pillIndex`), so the pill and the icon
 * move as one motion from the same frame.
 *
 * The `useEffect` below is the correctness fallback for a focus change that
 * never went through `press()` — back button, deep link, programmatic
 * navigation, or a press that got cancelled before `onPress` fired.
 */
export function useTabBarActiveIndex(activeIndex: number, reduceMotion: boolean) {
  const restingX = Math.max(activeIndex, 0);
  const shown = activeIndex >= 0;
  // Tracked in slot-index "units" rather than raw pixels so the resting/glide
  // position stays correct while `itemWidth` itself is also animating
  // between its regular and compact values (see TabBarIndicator's style
  // worklet) — a pixel-space position computed against one fixed itemWidth
  // would no longer line up once the capsule has resized.
  const x = useSharedValue(restingX);
  const target = useSharedValue(restingX);
  // Where the current glide started from and how far (in slot units) the
  // pill stretches at the middle of it — see TabBarIndicator's stretch.
  const origin = useSharedValue(restingX);
  const peakStretch = useSharedValue(0);
  const opacity = useSharedValue(shown ? 1 : 0);
  const committedIndex = useRef(restingX);
  const committedShown = useRef(shown);
  const pressedAt = useRef(0);

  const glideTo = useCallback((index: number) => {
    if (reduceMotion) {
      target.set(index);
      origin.set(index);
      peakStretch.set(0);
      x.set(index);
      return;
    }
    const next = planGlide(x.get(), index, { origin: origin.get(), target: target.get(), peak: peakStretch.get() });
    target.set(index);
    origin.set(next.origin);
    peakStretch.set(next.peak);
    x.set(withSpring(index, INDICATOR_SPRING));
  }, [reduceMotion, x, target, origin, peakStretch]);

  const jumpTo = useCallback((index: number) => {
    target.set(index);
    origin.set(index);
    peakStretch.set(0);
    x.set(index);
  }, [x, target, origin, peakStretch]);

  useEffect(() => {
    opacity.set(withTiming(shown ? 1 : 0, { duration: 180 }));
    if (committedShown.current !== shown) {
      // Appearing (e.g. back from Profile or search) or hiding fades in
      // place — only a move between tabs glides.
      committedShown.current = shown;
      committedIndex.current = restingX;
      jumpTo(restingX);
      return;
    }
    if (committedIndex.current === restingX) return;
    committedIndex.current = restingX;
    glideTo(restingX);
  }, [shown, restingX, glideTo, jumpTo, opacity]);

  const press = useCallback((index: number) => {
    // Only a press that actually moves the pill holds navigation back.
    pressedAt.current = index !== committedIndex.current || !committedShown.current ? Date.now() : 0;
    committedShown.current = true;
    committedIndex.current = index;
    opacity.set(withTiming(1, { duration: 180 }));
    glideTo(index);
  }, [glideTo, opacity]);

  /** For a side circle (e.g. buyer Profile) that isn't one of the pill's own
   *  slots — hides the pill the instant that circle is pressed. */
  const hide = useCallback(() => {
    committedShown.current = false;
    opacity.set(withTiming(0, { duration: 180 }));
  }, [opacity]);

  /**
   * Runs a tab bar's navigation call. On web, Reanimated animates on the
   * same main thread that renders the next tab, so dispatching the switch
   * the moment the finger lifts froze the pill mid-glide for as long as that
   * render took (80–650ms measured in the web preview). There it waits until
   * the pill is ~95% of the way to its slot (`WEB_NAV_AFTER_PRESS_MS` after
   * the press-in, usually only a few frames after the finger lifts), so the
   * glide completes and the new screen appears as it lands. On iOS/Android
   * the pill runs on the UI thread and can't be blocked by the JS render, so
   * navigation stays immediate.
   */
  const afterGlide = useCallback((navigate: () => void) => {
    if (Platform.OS !== 'web' || reduceMotion) {
      navigate();
      return;
    }
    const wait = WEB_NAV_AFTER_PRESS_MS - (Date.now() - pressedAt.current);
    if (wait <= 0) navigate();
    else setTimeout(navigate, wait);
  }, [reduceMotion]);

  return { x, target, origin, peakStretch, opacity, press, hide, afterGlide };
}

/**
 * The pill behind the active icon. It glides on a critically-damped,
 * non-overshooting spring and stretches toward where it's heading while in
 * flight, then snaps back to its resting size, so switching tabs feels like
 * dragging a drop of liquid. Position and size are driven by
 * `useTabBarActiveIndex`, owned by the tab bar so a press can kick the glide
 * ahead of the real navigation — see that hook's doc.
 *
 * Always sized from `metrics` alone — the buyer bar's compact/regular
 * capsule transition (see BuyerTabBar) shrinks this along with everything
 * else in the capsule via one outer `transform: scale`, rather than this
 * component interpolating its own width/height/position toward a second
 * `compactMetrics` (which used to mean this pill's `width`/`height` — a
 * layout property — animated on every capsule-mode transition frame too).
 */
export function TabBarIndicator({
  x, target, origin, peakStretch, opacity, metrics, theme,
}: {
  x: SharedValue<number>;
  target: SharedValue<number>;
  origin: SharedValue<number>;
  peakStretch: SharedValue<number>;
  opacity: SharedValue<number>;
  metrics: TabBarMetrics;
  theme: AppThemePreset;
}) {
  const style = useAnimatedStyle(() => {
    const itemWidth = metrics.itemWidth;
    const pad = metrics.capsulePadding;
    const baseWidth = metrics.indicatorWidth;
    const capsuleHeight = metrics.capsuleHeight;
    const indicatorHeight = metrics.indicatorHeight;
    const maxStretch = itemWidth * MAX_STRETCH_SLOTS;

    const stretch = currentStretch(x.value, origin.value, target.value, peakStretch.value) * itemWidth;
    const width = baseWidth + stretch;
    // The leading edge reaches ahead toward the destination tab.
    const direction = target.value >= origin.value ? 1 : -1;
    const center = (x.value + 0.5) * itemWidth + (direction * stretch) / 2;
    return {
      opacity: opacity.value,
      width,
      height: indicatorHeight,
      top: (capsuleHeight - indicatorHeight) / 2,
      borderRadius: nestedRadius(radius.bar, pad),
      // `translateX`, not `left` — a layout property like `left` forces a
      // reflow every frame (especially costly on react-native-web, where
      // this bar is verified at 390x844), while `transform` is
      // compositor-only. Only `width` (unavoidable for the liquid stretch)
      // still triggers layout.
      transform: [
        { translateX: pad + center - width / 2 },
        { scaleY: 1 - Math.min(stretch / maxStretch, 1) * 0.12 },
      ],
    };
  });

  return (
    <Animated.View
      style={[styles.indicator, { borderWidth: 0, overflow: 'hidden' }, style]}
    >
      {/* Real glass (folded in from #225's overnight-batch item 21), not a
          flat tinted fill — `noBlur` because this sits inside the tab bar's
          own already-blurred `TabBarGlass` surface: a second live blur
          stacked directly on top of the first would double the cost for no
          visible gain. The specular edge + border still read as glass on
          their own, on top of the bar's already-refracted backdrop. */}
      <Glass variant="regular" tint="dark" radius={nestedRadius(radius.bar, metrics.capsulePadding)} noBlur style={StyleSheet.absoluteFill} />
    </Animated.View>
  );
}

/** Colour for a tab icon. */
export function tabIconColor(theme: AppThemePreset, focused: boolean) {
  return focused ? theme.accent : theme.muted;
}

// Cross-fade duration for the outline -> filled icon swap. Deliberately kept
// tied to the real, committed focus change (not the pill's eager press-in
// start) — reverting a filled icon back to outline if a press gets cancelled
// before it becomes a real navigation would itself read as a glitch.
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
  // Fixed-diameter circle, centered regardless of the parent's own size —
  // never sized to the row/slot width, so it can't be clipped at either end
  // of the capsule (see PRESS_HIGHLIGHT_SIZE).
  pressHighlight: {
    position: 'absolute',
    width: PRESS_HIGHLIGHT_SIZE,
    height: PRESS_HIGHLIGHT_SIZE,
    borderRadius: PRESS_HIGHLIGHT_SIZE / 2,
    top: '50%',
    left: '50%',
    marginTop: -PRESS_HIGHLIGHT_SIZE / 2,
    marginLeft: -PRESS_HIGHLIGHT_SIZE / 2,
  },
  slot: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indicator: {
    position: 'absolute',
    // Fixed at the origin — the animated style's own `transform: translateX`
    // (not `left`) does all the horizontal positioning, so this never
    // triggers a layout reflow as the pill moves.
    left: 0,
    top: 0,
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
