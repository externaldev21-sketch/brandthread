/**
 * Brandthread Design System — SuccessCheck (Motion Phase 2)
 *
 * The spring-in checkmark circle used by the buy-now flow's "Order placed!"
 * confirmation (components/buy-now/OrderSuccessSheet.tsx), extracted as a
 * shared primitive so every other success moment (product published, mockup
 * saved, verification approved, …) gets the same feel instead of a plain
 * Alert or a one-off animation. Always theme.accent (monochrome brand —
 * never a green checkmark), matching the design system's "one look" rule.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { hapticSuccessAction } from '@/lib/haptics';

export interface SuccessCheckProps {
  size?: number;
  iconSize?: number;
  /** Fires once, when the spring-in starts (haptic is best-effort). */
  haptic?: boolean;
}

export function SuccessCheck({ size = 76, iconSize = 38, haptic = true }: SuccessCheckProps) {
  const { theme } = useAppTheme();
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (haptic) hapticSuccessAction();
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }).start();
    // Only ever plays once per mount — a success moment is shown, then dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View style={[styles.wrap, { transform: [{ scale }] }]}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accent }]}>
        <Feather name="check" size={iconSize} color={theme.onAccent} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  circle: { alignItems: 'center', justifyContent: 'center' },
});
