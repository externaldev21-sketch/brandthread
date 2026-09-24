/**
 * Brandthread Design System — IconButton (Phase 1)
 *
 * A 44x44pt minimum hit-area icon button. Thin wrapper over the existing
 * PressableScale press-feel with design-system tokens (RADII.chip, SPACING).
 */
import React from 'react';
import { Animated, Platform, Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticLight } from '@/lib/haptics';
import { COMP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export interface IconButtonProps {
  name: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  color?: string;
  size?: number;
  variant?: 'plain' | 'filled';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function IconButton({
  name, onPress, accessibilityLabel, accessibilityHint, color, size = 20,
  variant = 'filled', disabled = false, style, testID,
}: IconButtonProps) {
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';
  const resolvedColor = color ?? palette.foreground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { hapticLight(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      testID={testID}
      style={styles.hit}
    >
      <Animated.View
        style={[
          styles.root,
          variant === 'filled' && { backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, borderRadius: RADII.chip },
          disabled && { opacity: 0.4 },
          { transform: [{ scale }] },
          style,
        ]}
      >
        <Feather name={name} size={size} color={resolvedColor} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
  root: { width: COMP.iconBtn, height: COMP.iconBtn, alignItems: 'center', justifyContent: 'center' },
});
