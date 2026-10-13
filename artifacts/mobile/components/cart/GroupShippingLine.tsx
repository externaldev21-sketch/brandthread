/**
 * One brand's shipping line in the bag's seller-group footer (polish 111).
 * Reference: Depop bag, where each seller block shows "+ $X shipping" /
 * "+ free shipping" right under that seller's total.
 *
 * Renders nothing when the rate is unknown: never a made-up number.
 */
import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { groupShippingLabel } from '@/lib/cart/bagShipping';

export function GroupShippingLine({ cents, sellerId }: { cents: number | undefined; sellerId: string }) {
  const { theme } = useAppTheme();
  const label = groupShippingLabel(cents);
  if (!label) return null;
  return (
    <Text
      style={[styles.text, { color: theme.muted }]}
      numberOfLines={1}
      testID={`cart-group-shipping-${sellerId}`}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Same size/weight as the footer's delivery estimate line.
  text: { fontSize: FS.meta, fontFamily: FONT.medium, ...TABULAR_NUMS },
});
