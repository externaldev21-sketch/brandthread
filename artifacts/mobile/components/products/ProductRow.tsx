/**
 * Seller Products — list row (Shopify iOS Products list, reskinned):
 * 56pt thumbnail · name · price and stock · status chip · more.
 * Tapping the stock text opens the quick stock editor, same as the grid card.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import { deriveProductListStatus, PRODUCT_LIST_STATUS_LABEL, totalStockAcrossVariants } from '@/lib/productListStatus';
import type { Product } from '@/services/productTypes';
import { ProductStatusChip } from './ProductStatusChip';

export const PRODUCT_ROW_THUMB = 56;

interface Props {
  product: Product;
  onPress: (product: Product) => void;
  onPressIn?: (product: Product) => void;
  onMore: (product: Product) => void;
  onEditStock: (product: Product) => void;
}

export function productRowStockLabel(product: Product): string {
  if (product.inventory?.trackQuantity === false) return 'Not tracked';
  const stock = totalStockAcrossVariants(product);
  const variants = product.variants?.length ?? 0;
  const base = stock === 0 ? 'Out of stock' : `${stock} in stock`;
  return variants > 1 ? `${base} · ${variants} variants` : base;
}

export const ProductRow = React.memo(function ProductRow({ product, onPress, onPressIn, onMore, onEditStock }: Props) {
  const { theme } = useAppTheme();
  const status = deriveProductListStatus(product);
  const coverUri = product.media?.find(m => m.isCover)?.uri ?? product.media?.[0]?.uri;
  const price = formatCents(product.pricing.priceCents);
  const stockLabel = productRowStockLabel(product);

  return (
    <View style={[styles.row, { borderBottomColor: theme.borderSubtle }]} testID={`product-row-${product.id}`}>
      <PressableScale
        style={styles.main}
        onPress={() => onPress(product)}
        onPressIn={onPressIn ? () => onPressIn(product) : undefined}
        activeScale={0.99}
        accessibilityLabel={`${product.name}, ${PRODUCT_LIST_STATUS_LABEL[status]}, ${price}`}
      >
        <View style={[styles.thumb, { backgroundColor: theme.surfaceGlass, borderColor: theme.borderSubtle }]}>
          {coverUri ? (
            <CachedImage source={{ uri: coverUri }} style={styles.thumbImg} contentFit="cover" recyclingKey={product.id} />
          ) : (
            <Feather name="image" size={ICON.sm} color={theme.muted} />
          )}
        </View>
        <View style={styles.text}>
          <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{product.name}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.price, { color: theme.text }]} numberOfLines={1}>{price}</Text>
            <Text style={[styles.dot, { color: theme.muted }]}>·</Text>
            <PressableScale
              onPress={() => onEditStock(product)}
              hitSlop={{ top: 12, bottom: 12, left: 4, right: 8 }}
              noMinHeight
              accessibilityLabel={`Edit stock for ${product.name}, ${stockLabel}`}
              style={styles.stockWrap}
            >
              <Text style={[styles.stock, { color: theme.muted }]} numberOfLines={1}>{stockLabel}</Text>
            </PressableScale>
          </View>
        </View>
        <ProductStatusChip status={status} testID={`product-status-${product.id}`} />
      </PressableScale>
      <PressableScale
        style={styles.more}
        onPress={() => onMore(product)}
        accessibilityLabel={`More actions for ${product.name}`}
      >
        <Feather name="more-horizontal" size={ICON.md} color={theme.muted} />
      </PressableScale>
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minWidth: 0,
  },
  thumb: {
    width: PRODUCT_ROW_THUMB,
    height: PRODUCT_ROW_THUMB,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: SP.xs,
  },
  name: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    minWidth: 0,
  },
  price: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  dot: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
  },
  stockWrap: {
    flexShrink: 1,
    minWidth: 0,
  },
  stock: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    lineHeight: 18,
  },
  more: {
    marginRight: -12,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
