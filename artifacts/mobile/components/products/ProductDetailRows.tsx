/**
 * Product page details from the seller (polish 87, 88, 91).
 *
 *  - ModelInfoLine: lululemon's line under the photos, word for word:
 *    "Model is 6'1" and wears a size L".
 *  - ProductDetailRows: Fabric / Care / Origin as collapsible rows with a
 *    chevron, closed by default (lululemon's "How it feels / Features" rows).
 *  - InBagCount: "12 people have this in their bag", real counts from other
 *    shoppers' bags, hidden below 3 (the server never sends a smaller number).
 *
 * Each renders nothing when the seller left the field empty.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { detailRows, formatModelLine, type ProductPageDetails } from '@/lib/productPageDetails';
import { isPreviewProductId } from '@/lib/previewProducts';
import { FONT, FS, SP } from '@/lib/theme';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

function deviceLocale(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return undefined; }
}

export function ModelInfoLine({ details }: { details: ProductPageDetails | null }) {
  const { theme } = useAppTheme();
  const line = details ? formatModelLine(details, deviceLocale()) : null;
  if (!line) return null;
  return (
    <Text style={[styles.modelLine, { color: theme.muted }]} testID="product-model-line">{line}</Text>
  );
}

export function ProductDetailRows({ details }: { details: ProductPageDetails | null }) {
  const { theme } = useAppTheme();
  const rows = useMemo(() => (details ? detailRows(details) : []), [details]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!rows.length) return null;
  return (
    <View style={[styles.rows, { borderTopColor: theme.border }]} testID="product-detail-rows">
      {rows.map(row => {
        const expanded = !!open[row.key];
        return (
          <View key={row.key} style={[styles.row, { borderBottomColor: theme.border }]}>
            <Pressable
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.create(180, 'easeInEaseOut', 'opacity'));
                setOpen(prev => ({ ...prev, [row.key]: !prev[row.key] }));
              }}
              style={({ pressed }) => [styles.rowHead, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={row.title}
              accessibilityState={{ expanded }}
              testID={`product-detail-row-${row.key}`}
            >
              <Text style={[styles.rowTitle, { color: theme.text }]}>{row.title}</Text>
              <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
            </Pressable>
            {expanded && <Text style={[styles.rowBody, { color: theme.muted }]}>{row.body}</Text>}
          </View>
        );
      })}
    </View>
  );
}

export function InBagCount({ productId }: { productId: string }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    setCount(null);
    if (isPreviewProductId(productId)) return () => { live = false; };
    api.productPageDetails.inBags(productId)
      .then(res => { if (live) setCount(typeof res?.count === 'number' && res.count >= 3 ? res.count : null); })
      .catch(() => { if (live) setCount(null); });
    return () => { live = false; };
  }, [productId, api]);
  if (count == null) return null;
  return (
    <View style={styles.inBag} testID="product-in-bag-count">
      <Feather name="shopping-bag" size={14} color={theme.muted} />
      <Text style={[styles.inBagText, { color: theme.muted }]}>
        {count.toLocaleString()} people have this in their bag
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  modelLine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, textAlign: 'center', paddingVertical: SP.sm },
  rows: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: SP.md },
  row: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowHead: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontFamily: FONT.semibold, fontSize: FS.base },
  rowBody: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 18, paddingBottom: SP.md },
  inBag: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  inBagText: { fontFamily: FONT.medium, fontSize: FS.sm },
});
