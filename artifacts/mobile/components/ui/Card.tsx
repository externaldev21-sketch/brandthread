/**
 * Brandthread Design System — Card (Phase 1)
 *
 * A generic surface at the RADII.card (12pt) radius. `BrandthreadCard` in
 * components/BrandthreadUI.tsx remains available for existing screens (18pt
 * radius, glow option); this is the Phase 1 canonical shape for new work.
 */
import React from 'react';
import { Animated, Pressable, StyleProp, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Only used when `onPress` is set — labels the pressable surface for a11y. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Card({ children, onPress, elevated = false, style, testID, accessibilityLabel, accessibilityHint }: CardProps) {
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;

  const baseStyle: ViewStyle = {
    backgroundColor: elevated ? palette.elevated : palette.card,
    borderRadius: RADII.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: SPACING.md,
  };

  if (!onPress) {
    return <View style={[baseStyle, style]} testID={testID}>{children}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={() => { onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      testID={testID}
    >
      <Animated.View style={[baseStyle, { transform: [{ scale }] }, style]}>{children}</Animated.View>
    </Pressable>
  );
}
