/**
 * Brandthread Design System — RetryRow
 *
 * The inline companion to `useQueryResult`'s 'unavailable' status: a quiet,
 * monochrome, single-line row — "Couldn't load — Tap to retry" — for money
 * and analytics surfaces where a fetch failure must never look like a
 * genuine `$0` / `0` result.
 *
 * Deliberately NOT `ErrorState` (components/ui/ErrorState.tsx): that is a
 * full centered block for whole-screen failures. This is the small inline
 * shape for a single stat/row/section that failed to load while the rest of
 * the screen still renders — a balance line, a single list section, a chart.
 *
 * No banners, no colored alert chrome — a plain row using the same
 * foreground/muted/border tokens as everything else, Inter via FONT.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

export interface RetryRowProps {
  /** Defaults to "Couldn't load". Pass a specific noun, e.g. "Couldn't load balance". */
  label?: string;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function RetryRow({ label = "Couldn't load", onRetry, style, testID }: RetryRowProps) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onRetry}
      style={[styles.row, { borderColor: colors.border }, style]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to retry.`}
      testID={testID}
      noMinHeight
    >
      <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
      <Text style={[TYPE_SCALE.footnote, styles.text, { color: colors.mutedForeground }]} numberOfLines={1}>
        {label} — Tap to retry
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xxs + 2,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderWidth: 1,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  text: {
    fontFamily: FONT.medium,
  },
});
