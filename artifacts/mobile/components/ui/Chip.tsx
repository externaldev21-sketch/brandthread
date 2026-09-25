/**
 * Brandthread Design System — Chip / Pill (Phase 1)
 *
 * A selectable chip usable standalone or inside `ChipGroup` for single- or
 * multi-select filter rows. Generalizes the existing FilterChip
 * (components/BrandthreadUI.tsx), which remains for legacy call sites.
 *
 * Layout/interaction reference only: UNIQLO and Alta filter chips.
 */
import React from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticToggle } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  disabled?: boolean;
  testID?: string;
}

export function Chip({ label, selected, onPress, count, disabled, testID }: ChipProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count !== undefined ? `${label}, ${count}` : label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { hapticToggle(); onPress(); }}
      onPressIn={() => Animated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.chip,
          {
            borderRadius: RADII.pill,
            backgroundColor: selected ? theme.accentDim : palette.card,
            borderColor: selected ? theme.accent : palette.border,
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        <Text style={[TYPE_SCALE.footnote, { fontFamily: selected ? FONT.semibold : FONT.medium, color: selected ? theme.accentLight : palette.mutedForeground }]}>
          {label}
        </Text>
        {count !== undefined && (
          <View style={[styles.count, { backgroundColor: selected ? theme.accentDim : 'rgba(255,255,255,0.08)' }]}>
            <Text style={[TYPE_SCALE.caption, { color: selected ? theme.accentLight : palette.mutedForeground }]}>{count}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

/** A row of chips that manages single- or multi-select state for the caller. */
export interface ChipGroupProps {
  options: { id: string; label: string; count?: number }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  style?: React.ComponentProps<typeof View>['style'];
}

export function ChipGroup({ options, selectedIds, onChange, multiple = false, style }: ChipGroupProps) {
  const toggle = (id: string) => {
    if (multiple) {
      onChange(selectedIds.includes(id) ? selectedIds.filter((existing) => existing !== id) : [...selectedIds, id]);
    } else {
      onChange(selectedIds.includes(id) ? [] : [id]);
    }
  };
  return (
    <View style={[styles.group, style]}>
      {options.map((option) => (
        <Chip
          key={option.id}
          label={option.label}
          count={option.count}
          selected={selectedIds.includes(option.id)}
          onPress={() => toggle(option.id)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs,
    paddingHorizontal: SPACING.sm, height: 34, borderWidth: 1,
  },
  count: { borderRadius: RADII.pill, paddingHorizontal: 5, paddingVertical: 1 },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
});
