/**
 * Brandthread Design System — SuccessCheck (Motion Phase 2)
 *
 * The spring-in checkmark circle used by the buy-now flow's "Order placed!"
 * confirmation (components/buy-now/OrderSuccessSheet.tsx), extracted as a
 * shared primitive so every other success moment (product published, mockup
 * saved, verification approved, …) gets the same feel instead of a plain
 * Alert or a one-off animation. Always theme.accent (monochrome brand —
 * never a green checkmark), matching the design system's "one look" rule.
 *
 * `variant="draw"` — the confetti-free "it's done" moment for the big
 * success screens (order confirmed, product published): a thin white ring
 * draws itself clockwise from 12 o'clock, then a white checkmark draws in
 * (Mobbin: Gojek "Purchase received" ring caught mid-draw; Crypto.com
 * "Order Placed" / Fresha "Order placed!" thin ring + stroke check end
 * state). No fill, no color, no particles. Same Reanimated + react-native-svg
 * strokeDashoffset technique as the intro splash's thread draw
 * (components/splash/AppIntroSplash.tsx) — no new animation dependency.
 * Reduced motion shows the finished mark immediately.
 */
import React, { useEffect, useRef } from 'react';
import { Animated as RNAnimated, View, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSuccessAction } from '@/lib/haptics';

export interface SuccessCheckProps {
  size?: number;
  iconSize?: number;
  /** Fires once, when the spring-in starts (haptic is best-effort). */
  haptic?: boolean;
  /** 'filled' (default): accent disc + check. 'draw': white ring + check drawn in. */
  variant?: 'filled' | 'draw';
  testID?: string;
}

export function SuccessCheck({ size = 76, iconSize = 38, haptic = true, variant = 'filled', testID }: SuccessCheckProps) {
  if (variant === 'draw') return <DrawnSuccessCheck size={size} haptic={haptic} testID={testID} />;
  return <FilledSuccessCheck size={size} iconSize={iconSize} haptic={haptic} testID={testID} />;
}

function FilledSuccessCheck({ size, iconSize, haptic, testID }: { size: number; iconSize: number; haptic: boolean; testID?: string }) {
  const { theme } = useAppTheme();
  const scale = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    if (haptic) hapticSuccessAction();
    RNAnimated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
    // Only ever plays once per mount — a success moment is shown, then dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RNAnimated.View style={[styles.wrap, { transform: [{ scale }] }]} testID={testID}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accent }]}>
        <Feather name="check" size={iconSize} color={theme.onAccent} />
      </View>
    </RNAnimated.View>
  );
}

// ─── Draw variant ────────────────────────────────────────────────────────────

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Geometry in a 72×72 viewBox; the Svg scales it to `size`. */
const BOX = 72;
const RING_STROKE = 1.5;
const RING_R = (BOX - RING_STROKE) / 2;
const RING_LENGTH = 2 * Math.PI * RING_R;
const CHECK_STROKE = 3;
// Short leg then long leg, optically centred in the ring.
const CHECK_PATH = 'M23 37.5 L32 46.5 L50 27.5';
const CHECK_LENGTH = Math.hypot(9, 9) + Math.hypot(18, 19) + 1;
const WHITE = '#FFFFFF';

// Timing: ring 450ms, check starts as the ring closes and takes 280ms — the
// whole mark is finished in ~0.7s, before the eye reaches the headline.
const RING_MS = 450;
const CHECK_DELAY_MS = 330;
const CHECK_MS = 280;
const EASE = Easing.out(Easing.cubic);

function DrawnSuccessCheck({ size, haptic, testID }: { size: number; haptic: boolean; testID?: string }) {
  const reduceMotion = useReducedMotion();
  const ring = useSharedValue(reduceMotion ? 1 : 0);
  const check = useSharedValue(reduceMotion ? 1 : 0);
  // A settle, not a bounce: 0.94 → 1 with the ring, no overshoot.
  const scale = useSharedValue(reduceMotion ? 1 : 0.94);

  useEffect(() => {
    if (haptic) hapticSuccessAction();
    if (reduceMotion) return;
    ring.value = withTiming(1, { duration: RING_MS, easing: EASE });
    scale.value = withTiming(1, { duration: RING_MS, easing: EASE });
    check.value = withDelay(CHECK_DELAY_MS, withTiming(1, { duration: CHECK_MS, easing: EASE }));
    // Plays once per mount — a success moment is shown, then dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - ring.value) }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - check.value) }));
  const wrapStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[styles.wrap, { width: size, height: size }, wrapStyle]}
      testID={testID ?? 'success-check-draw'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
        <AnimatedCircle
          cx={BOX / 2}
          cy={BOX / 2}
          r={RING_R}
          stroke={WHITE}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${RING_LENGTH} ${RING_LENGTH}`}
          // Start the draw at 12 o'clock, going clockwise.
          transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}
          animatedProps={ringProps}
        />
        <AnimatedPath
          d={CHECK_PATH}
          stroke={WHITE}
          strokeWidth={CHECK_STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={`${CHECK_LENGTH} ${CHECK_LENGTH}`}
          animatedProps={checkProps}
        />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
});
