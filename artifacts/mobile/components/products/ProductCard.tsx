/**
 * "The Rack" — editorial product card for the seller Products tab.
 *
 * A tall lookbook-style card (image-forward, ~4:5) instead of a thin admin
 * row: the thumbnail is the hero, status/stock read as small chips on the
 * image, and name/price/meta sit on the card's solid background below it so
 * text stays legible in every theme (light and dark alike).
 *
 * Wrapped in `Swipeable` (already a transitive capability of
 * react-native-gesture-handler, which wraps the whole app) so a left swipe
 * reveals quick Archive/Delete actions — a nice-to-have layered on top of
 * the tap → action sheet, which remains the primary, fully-featured path.
 */

import React, { useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { StatusBadge, PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { Product } from '@/services/productTypes';
import { formatCents, integerPercent } from '@/lib/money';

export function getCategoryColors(category: string, theme: AppThemePreset): readonly [string, string] {
  if (category === 'T-shirt' || category === 'Sweatshirt') return [theme.accent, theme.secondary];
  if (category === 'Hoodie' || category === 'Sweatpants') return [theme.secondary, theme.accentLight];
  if (category === 'Jacket' || category === 'Shorts') return [theme.accentLight, theme.secondaryDim];
  if (category === 'Denim' || category === 'Dress' || category === 'Skirt') return [theme.accentDim, theme.accent];
  return [theme.accent, theme.secondary];
}

export function statusVariant(status: string): 'success' | 'warning' | 'purple' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'scheduled') return 'purple';
  return 'neutral';
}

export function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface ProductCardProps {
  product: Product;
  width: number;
  onPress: (product: Product) => void;
  onPressIn?: (product: Product) => void;
  onMore: (product: Product) => void;
  onQuickArchive: (product: Product) => void;
  onQuickDelete: (product: Product) => void;
}

// Memoized with stable handlers so a recycled card only re-renders when its
// own product changes, not on every search keystroke or stats refresh.
export const ProductCard = React.memo(function ProductCard({
  product, width, onPress, onPressIn, onMore, onQuickArchive, onQuickDelete,
}: ProductCardProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const swipeRef = useRef<Swipeable>(null);

  const coverUri = product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri;
  const gradColors = getCategoryColors(product.category, theme);

  const stock = product.inventory.totalStock;
  const threshold = product.inventory.lowStockThreshold;
  const stockColor = stock === 0 ? theme.error : stock <= threshold ? theme.warning : theme.success;
  const stockLabel = stock === 0 ? 'Out of stock' : stock <= threshold ? `${stock} in stock` : `${stock} in stock`;

  const price = product.pricing.priceCents;
  const compare = product.pricing.compareAtPriceCents;
  const discountPct = compare && compare > price
    ? integerPercent(compare - price, compare)
    : null;

  const isArchived = product.status === 'archived';
  const imageHeight = Math.round((width * 5) / 4);

  function closeSwipe() {
    swipeRef.current?.close();
  }

  function renderRightActions() {
    return (
      <View style={[s.swipeActions, { height: imageHeight }]}>
        <PressableScale
          style={[s.swipeBtn, { backgroundColor: theme.warning }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); closeSwipe(); onQuickArchive(product); }}
          accessibilityLabel={isArchived ? `Unarchive ${product.name}` : `Archive ${product.name}`}
        >
          <Feather name={isArchived ? 'rotate-ccw' : 'archive'} size={ICON.md} color={theme.background} />
        </PressableScale>
        <PressableScale
          style={[s.swipeBtn, { backgroundColor: theme.error }]}
          onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); closeSwipe(); onQuickDelete(product); }}
          accessibilityLabel={`Delete ${product.name}`}
        >
          <Feather name="trash-2" size={ICON.md} color={theme.background} />
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={[s.wrap, { width }]}>
      <Swipeable
        ref={swipeRef}
        renderRightActions={renderRightActions}
        onSwipeableWillOpen={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
        overshootRight={false}
        friction={2}
      >
        <PressableScale
          style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => onPress(product)}
          onPressIn={onPressIn ? () => onPressIn(product) : undefined}
          activeScale={0.98}
          accessibilityLabel={`${product.name}, ${statusLabel(product.status)}, ${formatCents(price)}`}
        >
          {/* Hero image */}
          <View style={[s.imageBox, { height: imageHeight }]}>
            {coverUri ? (
              <CachedImage source={{ uri: coverUri }} style={s.image} contentFit="cover" recyclingKey={product.id} />
            ) : (
              <LinearGradient colors={gradColors} style={s.image} />
            )}

            {/* Status chip */}
            <View style={s.chipTopLeft}>
              <StatusBadge label={statusLabel(product.status)} variant={statusVariant(product.status)} small />
            </View>

            {/* Quick more button */}
            <PressableScale
              style={s.moreBtn}
              onPress={() => onMore(product)}
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              accessibilityLabel={`More actions for ${product.name}`}
            >
              <View style={[s.moreBtnInner, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                <Feather name="more-horizontal" size={ICON.sm} color="#FFFFFF" />
              </View>
            </PressableScale>

            {/* Stock warning chip, bottom of image */}
            {(stock === 0 || stock <= threshold) && (
              <View style={[s.chipBottomLeft, { backgroundColor: stockColor }]}>
                <Text style={s.chipBottomLabel} numberOfLines={1}>{stockLabel}</Text>
              </View>
            )}
          </View>

          {/* Content below image */}
          <View style={s.content}>
            <Text style={[s.name, { color: theme.text }]} numberOfLines={1}>{product.name}</Text>
            <Text style={[s.meta, { color: theme.muted }]} numberOfLines={1}>
              {product.category}
              {product.variants.length > 0 ? ` · ${product.variants.length} variant${product.variants.length !== 1 ? 's' : ''}` : ''}
            </Text>

            <View style={s.priceRow}>
              <Text style={[s.price, { color: theme.text }]}>{formatCents(price)}</Text>
              {compare && compare > price && (
                <Text style={[s.compare, { color: theme.subtle }]}>{formatCents(compare)}</Text>
              )}
              {discountPct !== null && (
                <Text style={[s.discount, { color: theme.error }]}>-{discountPct}%</Text>
              )}
            </View>

            {stock > threshold && (
              <Text style={[s.stock, { color: stockColor }]}>{stockLabel}</Text>
            )}
          </View>
        </PressableScale>
      </Swipeable>
    </View>
  );
});

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  wrap: {
    marginBottom: SP.md,
  },
  card: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageBox: {
    width: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  chipTopLeft: {
    position: 'absolute',
    top: SP.xs,
    left: SP.xs,
  },
  chipBottomLeft: {
    position: 'absolute',
    left: SP.xs,
    right: SP.xs,
    bottom: SP.xs,
    borderRadius: RADIUS.xs,
    paddingHorizontal: SP.xs,
    paddingVertical: 3,
  },
  chipBottomLabel: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  moreBtn: {
    position: 'absolute',
    top: SP.xs,
    right: SP.xs,
  },
  moreBtnInner: {
    width: 28,
    height: 28,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: SP.sm,
    gap: 2,
  },
  name: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    letterSpacing: -0.1,
  },
  meta: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'wrap',
    marginTop: 2,
  },
  price: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
  },
  compare: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    textDecorationLine: 'line-through',
  },
  discount: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
  },
  stock: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    marginTop: 1,
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginLeft: SP.xs,
  },
  swipeBtn: {
    width: 56,
    marginLeft: SP.xs,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
