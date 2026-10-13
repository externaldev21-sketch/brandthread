/**
 * Buyer-facing stock line for the product page: "Only 3 left",
 * "Limited edition · 12 of 50 left" or "Sold out". Reads the public
 * stock-info endpoint (no auth) through lib/stockInfo.ts and renders nothing
 * when the seller has not opted in or the request fails.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { stockCounterText, useStockInfo } from '@/lib/stockInfo';
import { FONT, FS, RADIUS } from '@/lib/theme';

export { stockCounterText };

export function StockCounter({ productId }: { productId?: string | null }) {
  const colors = useColors();
  const info = useStockInfo(productId);

  const text = info ? stockCounterText(info) : null;
  if (!text) return null;
  return (
    <View style={[styles.pill, { borderColor: colors.border, backgroundColor: colors.surface }]} accessible accessibilityLabel={text}>
      <Text style={[styles.text, { color: info?.soldOut ? colors.mutedForeground : colors.foreground }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  text: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
