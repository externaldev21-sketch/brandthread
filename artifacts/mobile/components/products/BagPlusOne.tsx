/**
 * "+1" that rises off the bag icon when an item is added (polish 103),
 * alongside the existing badge bounce (hooks/useCartBadgeBump.ts). It says
 * exactly what happened (one more item in the bag), so it passes the
 * "animation only when something happened" rule. Skipped under Reduce Motion
 * (the badge count still changes).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { FONT } from '@/lib/theme';
import { shouldAnimateCartSuccess } from '@/lib/cartFlight';

/** `trigger` changes on every successful add; `quantity` is how many were added. */
export function BagPlusOne({ trigger, quantity, reduceMotion }: { trigger: number; quantity: number; reduceMotion: boolean | null }) {
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!trigger || !shouldAnimateCartSuccess(reduceMotion)) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [trigger, progress, reduceMotion]);

  if (!trigger) return null;
  return (
    <Animated.Text
      pointerEvents="none"
      testID="bag-plus-one"
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.text, {
        opacity: progress.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, -18] }) }],
      }]}
    >
      +{quantity}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  text: {
    position: 'absolute', top: -14, right: -6,
    color: '#FFFFFF', // theme-exempt: same fixed white as the bag icon over the photo
    fontFamily: FONT.bold, fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3, // theme-exempt: legibility over the photo
  },
});
