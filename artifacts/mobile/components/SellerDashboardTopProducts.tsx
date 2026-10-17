import React from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { TopProductSummary } from '@/lib/sellerDashboardStats';

export function SellerDashboardTopProducts({
  products,
  theme,
  onOpenProduct,
  onSeeAll,
  emptyMessage,
}: {
  products: TopProductSummary[];
  theme: AppThemePreset;
  onOpenProduct: (productId: string) => void;
  onSeeAll: () => void;
  /** Shown under the section title when nothing has sold yet; omit to hide
   *  the section entirely. */
  emptyMessage?: string;
}) {
  if (products.length === 0 && !emptyMessage) return null;

  return (
    <View testID="seller-dashboard-top-products">
      <View style={styles.headerRow}>
        <Text style={[styles.sectionHeader, { color: theme.muted }]}>Top products</Text>
        <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all products">
          <Text style={[styles.seeAll, { color: theme.subtle }]}>See all</Text>
        </TouchableOpacity>
      </View>
      {products.length === 0 && (
        <Text style={[styles.emptyText, { color: theme.muted }]}>{emptyMessage}</Text>
      )}
      <View>
        {products.slice(0, 5).map((product, index) => (
          <PressableScale
            key={product.productId}
            onPress={() => onOpenProduct(product.productId)}
            style={[styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
            accessibilityRole="button"
            accessibilityLabel={`${product.name}: ${product.unitsSold} sold, ${formatCents(product.revenueCents)}`}
          >
            {product.imageUrl ? (
              <Image source={{ uri: product.imageUrl }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder, { backgroundColor: theme.cardElevated }]}>
                <Text style={[styles.thumbLetter, { color: theme.subtle }]}>{product.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.copy}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]} numberOfLines={1}>
                {product.unitsSold} {product.unitsSold === 1 ? 'unit' : 'units'} sold
              </Text>
            </View>
            <Text style={[styles.revenue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {formatCents(product.revenueCents)}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontFamily: FONT.regular, fontSize: FS.sm, paddingVertical: SP.sm },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SP.sm,
  },
  sectionHeader: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  seeAll: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    minHeight: 64,
    paddingVertical: SP.sm,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
  },
  copy: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: 2,
  },
  revenue: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    fontVariant: ['tabular-nums'],
    maxWidth: 100,
  },
});
