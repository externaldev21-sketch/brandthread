/**
 * Buyer-facing stock line for the product page: "Only 3 left",
 * "Limited edition · 12 of 50 left" or "Sold out". Fetches its own data from
 * the public stock-info endpoint (no auth) and renders nothing when the
 * seller has not opted in or the request fails.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { API_BASE_URL } from '@/lib/api';
import { FONT, FS, RADIUS } from '@/lib/theme';

interface StockInfo {
  soldOut: boolean;
  limited: boolean;
  editionSize: number | null;
  remaining: number | null;
}

export function stockCounterText(info: StockInfo): string | null {
  if (info.soldOut) return info.limited ? 'Limited edition · Sold out' : 'Sold out';
  if (info.limited && info.remaining !== null && info.editionSize) {
    return `Limited edition · ${info.remaining} of ${info.editionSize} left`;
  }
  if (info.limited) return 'Limited edition';
  if (info.remaining !== null) return info.remaining === 1 ? 'Only 1 left' : `Only ${info.remaining} left`;
  return null;
}

export function StockCounter({ productId }: { productId?: string | null }) {
  const colors = useColors();
  const [info, setInfo] = useState<StockInfo | null>(null);

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setInfo(null);
    fetch(`${API_BASE_URL}/api/catalog-public/products/${encodeURIComponent(productId)}/stock-info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data && typeof data.soldOut === 'boolean') setInfo(data as StockInfo); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [productId]);

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
