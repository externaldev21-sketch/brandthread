/**
 * Brandthread Design System — QuantityStepper (Phase 1)
 *
 * Layout/interaction reference only: Fresha / Taco Bell steppers.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT, TEXT_TERTIARY } from '@/lib/theme';
import { TABULAR_NUMS, TYPE_SCALE } from '@/constants/typography';
import { radius } from '@/constants/radii';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  testID?: string;
  /** 'default' (40pt, existing) or 'sm' (32pt) for a tighter row, e.g. the
   *  cart's per-item stepper. Defaults to 'default' so every existing call
   *  site is unaffected. */
  size?: 'default' | 'sm';
  /** Opt-in: at `min`, the − button turns into a trash icon and calls this
   *  instead of being disabled (foodpanda / Thrive Market cart pattern — the
   *  buyer can take a line to zero right from the stepper). Omit it and the
   *  stepper behaves exactly as before. */
  onRemoveAtMin?: () => void;
  /** Accessible name for the item, used in the remove label. */
  itemLabel?: string;
}

export function QuantityStepper({
  value, onChange, min = 1, max = 99, disabled, testID, size = 'default', onRemoveAtMin, itemLabel,
}: QuantityStepperProps) {
  const palette = useColors();
  const removeMode = !!onRemoveAtMin && value <= min;
  const canDecrement = !disabled && (value > min || removeMode);
  const canIncrement = !disabled && value < max;
  const sm = size === 'sm';

  const step = (delta: number) => {
    hapticToggle();
    onChange(Math.min(max, Math.max(min, value + delta)));
  };

  const decrement = () => {
    if (removeMode) {
      hapticToggle();
      onRemoveAtMin?.();
      return;
    }
    step(-1);
  };

  return (
    <View
      style={[styles.root, sm && styles.rootSm, { borderColor: palette.border, borderRadius: sm ? radius.sm : radius.md }]}
      testID={testID}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={removeMode ? `Remove${itemLabel ? ` ${itemLabel}` : ''} from cart` : 'Decrease quantity'}
        disabled={!canDecrement}
        onPress={decrement}
        style={[styles.btn, sm && styles.btnSm]}
        hitSlop={8}
        testID={testID ? `${testID}-decrement` : undefined}
      >
        <Feather name={removeMode ? 'trash-2' : 'minus'} size={sm ? 13 : 16} color={canDecrement ? palette.foreground : TEXT_TERTIARY} />
      </Pressable>
      <Text
        style={[TYPE_SCALE.headline, TABULAR_NUMS, { color: palette.foreground, minWidth: sm ? 18 : 22, textAlign: 'center', fontSize: sm ? 13 : undefined }]}
        accessibilityLabel={`Quantity ${value}`}
      >
        {value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        disabled={!canIncrement}
        onPress={() => step(1)}
        style={[styles.btn, sm && styles.btnSm]}
        hitSlop={8}
        testID={testID ? `${testID}-increment` : undefined}
      >
        <Feather name="plus" size={sm ? 13 : 16} color={canIncrement ? palette.foreground : TEXT_TERTIARY} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 4, height: 40 },
  rootSm: { paddingHorizontal: 2, height: 32 },
  btn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  btnSm: { width: 26, height: 26 },
});
