/**
 * Brandthread Design System — QuantityStepper (Phase 1)
 *
 * Layout/interaction reference only: Fresha / Taco Bell steppers.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { RADII } from '@/constants/radii';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  testID?: string;
}

export function QuantityStepper({ value, onChange, min = 1, max = 99, disabled, testID }: QuantityStepperProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const canDecrement = !disabled && value > min;
  const canIncrement = !disabled && value < max;

  const step = (delta: number) => {
    hapticToggle();
    onChange(Math.min(max, Math.max(min, value + delta)));
  };

  return (
    <View
      style={[styles.root, { borderColor: palette.border, borderRadius: RADII.pill }]}
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        disabled={!canDecrement}
        onPress={() => step(-1)}
        style={[styles.btn, !canDecrement && styles.disabled]}
        hitSlop={8}
      >
        <Feather name="minus" size={16} color={canDecrement ? palette.foreground : palette.mutedForeground} />
      </Pressable>
      <Text
        style={[TYPE_SCALE.headline, TABULAR_NUMS, { color: palette.foreground, minWidth: 22, textAlign: 'center' }]}
        accessibilityLabel={`Quantity ${value}`}
      >
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        disabled={!canIncrement}
        onPress={() => step(1)}
        style={[styles.btn, !canIncrement && styles.disabled]}
        hitSlop={8}
      >
        <Feather name="plus" size={16} color={canIncrement ? theme.accentLight : palette.mutedForeground} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 4, height: 40 },
  btn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
});
