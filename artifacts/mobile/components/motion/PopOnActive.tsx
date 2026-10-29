/**
 * The like / save icon "pop" outside the Home rail: when `active` turns on,
 * the icon dips, overshoots and settles (Instagram's heart); turning off is a
 * soft dip back. Same curves as RightActionRail's 'pop' / 'bounce' kinds so
 * every like and save in the app moves the same way. Nothing on mount, and
 * nothing under Reduce Motion.
 */
import React, { useEffect, useRef } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from '@/hooks/useReduceMotion';

export function PopOnActive({ active, kind = 'pop', children, testID }: {
  active: boolean;
  /** 'pop' = heart (bigger overshoot), 'bounce' = bookmark. */
  kind?: 'pop' | 'bounce';
  children: React.ReactNode;
  testID?: string;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const prev = useRef(active);

  useEffect(() => {
    if (prev.current === active) return;
    prev.current = active;
    if (reduceMotion) return;
    if (kind === 'pop') {
      scale.value = active
        ? withSequence(withTiming(0.8, { duration: 70 }), withSpring(1.25, { damping: 6, stiffness: 400 }), withSpring(1, { damping: 12, stiffness: 300 }))
        : withSequence(withTiming(0.82, { duration: 110 }), withSpring(1, { damping: 14, stiffness: 320 }));
    } else {
      scale.value = active
        ? withSequence(withTiming(0.85, { duration: 80 }), withSpring(1.15, { damping: 5, stiffness: 380 }), withSpring(1))
        : withSequence(withTiming(0.9, { duration: 90 }), withSpring(1));
    }
  }, [active, kind, reduceMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return <Animated.View style={style} testID={testID}>{children}</Animated.View>;
}
