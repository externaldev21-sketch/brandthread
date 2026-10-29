/**
 * A badge count that "ticks up" (Instagram / Shop bag): when the value goes
 * up, the new number rolls in from just below while fading in, inside a
 * clip the size of the text — alongside the icon's own bump
 * (hooks/useCartBadgeBump.ts). A drop, a first value or Reduce Motion just
 * swaps the number. Same Text, same style: nothing about the resting badge
 * changes.
 */
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/** How far (pt) the incoming digit travels, and how long it takes. */
export const TICK_DISTANCE = 8;
export const TICK_MS = 200;

/** Whether a change from `prev` to `next` rolls (only a real increase does). */
export function shouldTick(prev: number | null, next: number, reduceMotion: boolean): boolean {
  return !reduceMotion && prev != null && next > prev;
}

export function TickingCount({
  value, max = 99, style, maxFontSizeMultiplier, testID,
}: {
  value: number;
  /** Above this shows `${max}+`. */
  max?: number;
  style?: StyleProp<TextStyle>;
  maxFontSizeMultiplier?: number;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const prev = useRef<number | null>(null);
  const ty = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (shouldTick(prev.current, value, !!reduceMotion)) {
      ty.value = TICK_DISTANCE;
      opacity.value = 0;
      ty.value = withTiming(0, { duration: TICK_MS, easing: Easing.out(Easing.cubic) });
      opacity.value = withTiming(1, { duration: TICK_MS * 0.7 });
    }
    prev.current = value;
  }, [value, reduceMotion, ty, opacity]);

  const rollStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: ty.value }] }));

  return (
    <View style={styles.clip}>
      <Animated.Text style={[style, rollStyle]} maxFontSizeMultiplier={maxFontSizeMultiplier} testID={testID}>
        {value > max ? `${max}+` : value}
      </Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
