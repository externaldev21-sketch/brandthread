/**
 * One line under the price on the buyer product page (BT-263):
 * "Shipping $5.95 · Free over $75" from the seller's own domestic rate
 * (GET /api/public/products/:id `sellerShipping`, the same zones / flat rate
 * checkout charges). Public data, so guests see it too. Renders nothing when
 * the seller has no rate. The delivery promise is a separate line (not here).
 */
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { shippingCostLine, type SellerShippingSummary } from '@/lib/productTrust';

export function ProductShippingLine({ shipping }: { shipping: SellerShippingSummary | null | undefined }) {
  const { theme } = useAppTheme();
  const line = shippingCostLine(shipping);
  if (!line) return null;
  return (
    <Text style={[styles.line, { color: theme.muted }]} testID="product-shipping-line">
      {line}
    </Text>
  );
}

const styles = StyleSheet.create({
  // Pulls up under the price row (its marginBottom is SP.md).
  line: { fontSize: 15, fontFamily: FONT.regular, fontVariant: ['tabular-nums'], marginTop: -8, marginBottom: 16 },
});
