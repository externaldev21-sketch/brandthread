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
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useColors } from '@/hooks/useColors';
import { hapticToggle, hapticSelection } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII, radius } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  count?: number;
  disabled?: boolean;
  testID?: string;
  /** Optional leading glyph, e.g. a trending/history icon ahead of the label. */
  icon?: IconName;
  iconColor?: string;
  /** Optional trailing remove control (e.g. clearing a single recent search). */
  onRemove?: () => void;
  removeAccessibilityLabel?: string;
  /** @deprecated no longer has any effect — every Chip now uses the same
   *  critically damped, no-overshoot press spring (see PRESS_SPRING in
   *  constants/motion.ts); kept only so existing call sites don't need
   *  editing. */
  bounce?: boolean;
  /** 32pt tall / hairline border / 14pt text — Instagram-style quick-reply
   *  chip, instead of the default filter-chip sizing. */
  variant?: 'default' | 'quickReply';
  /** Strike the label through — the sold-out size treatment (with `disabled`
   *  and a leading `slash` icon), Nike / GOAT / alias size-grid convention. */
  strikethrough?: boolean;
  /** Overrides the default spoken label (e.g. "Size, M, sold out"). */
  accessibilityLabel?: string;
  /** Defaults to "button"; option pickers pass "radio". */
  accessibilityRole?: 'button' | 'radio';
}

export function Chip({
  label, selected, onPress, count, disabled, testID, icon, iconColor, onRemove, removeAccessibilityLabel, variant = 'default',
  strikethrough = false, accessibilityLabel, accessibilityRole = 'button',
}: ChipProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  const contentColor = selected ? theme.onAccent : palette.mutedForeground;
  const isQuickReply = variant === 'quickReply';

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? (count !== undefined ? `${label}, ${count}` : label)}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => { hapticToggle(); onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.chip,
          {
            borderRadius: radius.sm,
            backgroundColor: selected ? theme.accent : palette.card,
            borderColor: selected ? theme.accent : palette.border,
            borderWidth: isQuickReply ? StyleSheet.hairlineWidth : 1,
            height: isQuickReply ? 32 : undefined,
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        {icon && <Icon name={icon} size={12} color={iconColor ?? contentColor} />}
        <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[TYPE_SCALE.footnote, isQuickReply && { fontSize: 14 }, { fontFamily: selected ? FONT.semibold : FONT.medium, color: contentColor }, strikethrough && styles.struck]}>
          {label}
        </Text>
        {count !== undefined && (
          <View style={[styles.count, { backgroundColor: selected ? `${theme.onAccent}26` : theme.borderSubtle }]}>
            <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[TYPE_SCALE.caption, { color: contentColor }]}>{count}</Text>
          </View>
        )}
        {onRemove && (
          <Pressable
            onPress={() => { hapticSelection(); onRemove(); }}
            hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={removeAccessibilityLabel ?? `Remove ${label}`}
          >
            <Icon name="x" size={13} color={contentColor} />
          </Pressable>
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
  struck: { textDecorationLine: 'line-through' },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
});
