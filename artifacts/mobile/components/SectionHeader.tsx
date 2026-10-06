import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

/**
 * NOTE: for new screens, prefer the `SectionHeader` exported from
 * `components/BrandthreadUI.tsx` (the version used by the large majority of
 * existing screens) — this file is kept for its one remaining call site and
 * now shares the same design-system tokens so the two never drift visually.
 */
interface SectionHeaderProps {
  title: string;
  action?: string;
  onAction?: () => void;
  colors?: { foreground: string; primary: string };
}

export function SectionHeader({ title, action, onAction, colors: colorsProp }: SectionHeaderProps) {
  const themeColors = useColors();
  const colors = colorsProp ?? themeColors;
  return (
    <View style={styles.row}>
      <View style={styles.titleWrap}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1} ellipsizeMode="tail">{title}</Text>
      </View>
      {action && (
        <TouchableOpacity onPress={onAction} activeOpacity={0.7} style={styles.actionBtn}>
          <Text style={[styles.action, { color: colors.primary }]} numberOfLines={1}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  // flex:1 + minWidth:0 lets a long title shrink and ellipsize instead of
  // forcing the row (and its sibling action) past the screen edge.
  titleWrap: { flex: 1, minWidth: 0, marginRight: SPACING.sm },
  title: { ...TYPE_SCALE.headline, fontFamily: FONT.semibold },
  actionBtn: { flexShrink: 0 },
  action: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium },
});
