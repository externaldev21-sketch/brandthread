/**
 * "Best seller" / "Slow mover" text pill on a seller product card.
 *
 * Monochrome and neutral on purpose: it sits in the card's text block, apart
 * from the coloured status chip (top of the photo) and the low / out-of-stock
 * chip (bottom of the photo), so the two kinds of flags never compete.
 * Shopify iOS shows this kind of product state as plain meta text on the
 * product row ("$100 · Active · 0 available").
 */
import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SALES_FLAG_LABEL, type SalesFlag } from '@/lib/productSalesFlags';

export function SalesFlagBadge({ flag }: { flag?: SalesFlag | null }) {
  const { theme } = useAppTheme();
  if (!flag) return null;
  return (
    <View
      style={[styles.pill, { borderColor: theme.border }]}
      accessibilityRole="text"
      accessibilityLabel={SALES_FLAG_LABEL[flag]}
      testID={`sales-flag-${flag}`}
    >
      <Text style={[styles.label, { color: theme.muted }]} numberOfLines={1}>{SALES_FLAG_LABEL[flag]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 4,
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
  },
});
