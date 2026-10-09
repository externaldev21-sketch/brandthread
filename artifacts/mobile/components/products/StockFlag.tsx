/**
 * Monochrome stock marker shared by the Products grid and the bulk editor.
 * Low stock reads as a solid white pill (the loudest thing in a black UI);
 * out of stock is a quiet outlined pill with silver text — no warning colours.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { FONT, FS, RADIUS } from '@/lib/theme';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import type { StockLevel } from '@/lib/productBulk';

export function stockFlagColors(level: Exclude<StockLevel, 'in_stock'>, theme: AppThemePreset) {
  return level === 'low_stock'
    ? { bg: theme.text, fg: theme.background, border: theme.text }
    : { bg: theme.background, fg: theme.muted, border: theme.border };
}

export function StockFlag({ level, label, theme, style }: {
  level: Exclude<StockLevel, 'in_stock'>; label: string; theme: AppThemePreset; style?: StyleProp<ViewStyle>;
}) {
  const c = stockFlagColors(level, theme);
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }, style]}>
      <Text style={[styles.text, { color: c.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderRadius: RADIUS.xs, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, paddingVertical: 2 },
  text: { fontFamily: FONT.bold, fontSize: FS.xs },
});
