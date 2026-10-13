/**
 * Plain, sentence-case section title for the seller Dashboard's flat
 * sections ("To do", "Recent activity", …) — Shopify Home style: no
 * eyebrow caps, no card, an optional quiet text action on the right.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/BrandthreadUI';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';

export function SellerDashboardSectionTitle({
  title,
  theme,
  action,
  onAction,
  testID,
}: {
  title: string;
  theme: AppThemePreset;
  action?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.row} testID={testID}>
      <Text style={[styles.title, { color: theme.text }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <PressableScale onPress={onAction} noMinHeight hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} accessibilityRole="button" accessibilityLabel={action}>
          <Text style={[styles.action, { color: theme.muted }]} numberOfLines={1}>{action}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
    gap: SP.sm,
  },
  title: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: 17, lineHeight: 22 },
  action: { fontFamily: FONT.medium, fontSize: 15 },
});
