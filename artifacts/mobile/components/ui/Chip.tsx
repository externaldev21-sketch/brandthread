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
import { Animated, Platform, Pressable, StyleSheet, Text, View, type Insets } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { useColors } from '@/hooks/useColors';

import { haptics, hapticToggle, hapticSelection, haptic } from '@/lib/haptics';


import { BORDER_SUBTLE, FONT, TEXT_DISABLED, FS } from '@/lib/theme';



import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII, radius } from '@/constants/radii';

import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';

import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

import { minHitSlop } from '@/lib/hitSlop';

import { Icon, type IconName } from '@/components/ui/Icon';

import { DISABLED_OPACITY } from '@/constants/states';

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
  /** Keeps the `disabled` look and announcement but still fires `onPress` —
   *  a sold-out size that can be selected to reach "Notify me". On Android
   *  the a11y `disabled` state is left off: TalkBack will not activate a
   *  disabled node (the label already says "sold out"). */
  pressableWhenDisabled?: boolean;
  accessibilityHint?: string;
  /** Trailing text after the label, not struck or dimmed (e.g. "Notify me"
   *  on a sold-out size; Zalando size picker convention). */
  trailingLabel?: string;
  /** Overrides the default touch padding, e.g. for a one-character chip
   *  ("1") that draws narrower than the 40pt the default assumes. */
  hitSlop?: Insets;
}

export function Chip({
  label, selected, onPress, count, disabled, testID, icon, iconColor, onRemove, removeAccessibilityLabel, variant = 'default',
  strikethrough = false, accessibilityLabel, accessibilityRole = 'button',
  pressableWhenDisabled = false, accessibilityHint, trailingLabel, hitSlop,
}: ChipProps) {
  const { theme } = useAppTheme();
  const palette = useColors();
  const scale = React.useRef(new Animated.Value(1)).current;
  // Solid when selected, outline when not (one chip rule app-wide).
  const contentColor = selected ? theme.onAccent : palette.foreground;
  const isQuickReply = variant === 'quickReply';

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? (count !== undefined ? `${label}, ${count}` : label)}
      accessibilityState={{ selected, disabled: !!disabled && !(pressableWhenDisabled && Platform.OS === 'android') }}
      accessibilityHint={accessibilityHint}
      disabled={disabled && !pressableWhenDisabled}
      onPress={() => { hapticToggle(); onPress(); }}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      // Drawn 34pt (32pt quick-reply) tall — pad the touch area to 44pt.
      hitSlop={hitSlop ?? (isQuickReply ? QUICK_REPLY_HIT_SLOP : CHIP_HIT_SLOP)}
      testID={testID}
    >
      <Animated.View
        style={[
          styles.chip,
          {
            borderRadius: radius.sm,
            backgroundColor: selected ? theme.accent : 'transparent',
            borderColor: selected ? theme.accent : palette.border,
            borderWidth: isQuickReply ? StyleSheet.hairlineWidth : 1,
            height: isQuickReply ? 32 : undefined,
            opacity: disabled && !trailingLabel ? 0.5 : 1,
            transform: [{ scale }],
          },
        ]}
      >
        <View style={[styles.lead, disabled && !!trailingLabel && styles.dim]}>
          {icon && <Icon name={icon} size={12} color={iconColor ?? contentColor} />}
          <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[TYPE_SCALE.footnote, isQuickReply && { fontSize: FS.base }, { fontFamily: selected ? FONT.semibold : FONT.medium, color: contentColor }, strikethrough && styles.struck]}>
            {label}
          </Text>
        </View>
        {!!trailingLabel && (
          <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[TYPE_SCALE.footnote, styles.trailing, { color: theme.text }]}>
            {trailingLabel}
          </Text>
        )}
        {count !== undefined && (
          <View style={[styles.count, { backgroundColor: selected ? `${theme.onAccent}26` : theme.borderSubtle }]}>
            <Text maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER} style={[TYPE_SCALE.caption, { color: contentColor }]}>{count}</Text>
          </View>
        )}
        {onRemove && (
          <Pressable
            onPress={() => { onRemove(); }}
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
  /** Passed to every chip (see ChipProps.hitSlop). */
  chipHitSlop?: Insets;
}

export function ChipGroup({ options, selectedIds, onChange, multiple = false, style, chipHitSlop }: ChipGroupProps) {
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
          hitSlop={chipHitSlop}
        />
      ))}
    </View>
  );
}

// Width 40 = the narrowest one-word chip ("All"); a 2pt side pad stays
// inside the 8pt gap between chips.
const CHIP_HIT_SLOP = minHitSlop({ width: 40, height: 34 });
const QUICK_REPLY_HIT_SLOP = minHitSlop({ width: 40, height: 32 });

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs,
    paddingHorizontal: SPACING.sm, height: 34, borderWidth: 1,
  },
  count: { borderRadius: RADII.pill, paddingHorizontal: 5, paddingVertical: 1 },
  struck: { textDecorationLine: 'line-through' },
  lead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs },
  dim: { opacity: 0.5 },
  trailing: { fontFamily: FONT.semibold, marginLeft: SPACING.xs },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
});
