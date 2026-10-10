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
import { Icon, ICON_SIZE } from '@/components/ui/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { StatusBadge, PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { Product } from '@/services/productTypes';
import { formatCents, integerPercent } from '@/lib/money';
import { stockStatusLabel } from '@/lib/productBulk';
import { stockFlagColors } from '@/components/products/StockFlag';

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
  /** Opens the quick per-variant stock editor. Tapping the stock chip/label
   *  specifically (not the rest of the card) — same nested-pressable-inside-
   *  the-card pattern already used by the "more" button below. */
  onEditStock: (product: Product) => void;
}

// Memoized with stable handlers so a recycled card only re-renders when its
// own product changes, not on every search keystroke or stats refresh.
export const ProductCard = React.memo(function ProductCard({
  product, width, onPress, onPressIn, onMore, onQuickArchive, onQuickDelete, onEditStock,
}: ProductCardProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const swipeRef = useRef<Swipeable>(null);

  const coverUri = product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri;
  const gradColors = getCategoryColors(product.category, theme);

  const stock = product.inventory.totalStock;
  const threshold = product.inventory.lowStockThreshold;
  // Monochrome stock marker (Shopify's "N available" line): silver count when
  // healthy, a white "Low stock" pill at/below the threshold, a quiet dark
  // "Out of stock" pill at 0 — no warning colours.
  const { level: stockLevelKey, label: stockLabel } = stockStatusLabel(stock, threshold);
  const flagColors = stockFlagColors(stockLevelKey === 'low_stock' ? 'low_stock' : 'out_of_stock', theme);

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
          style={[s.swipeBtn, { backgroundColor: theme.muted }]}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); closeSwipe(); onQuickArchive(product); }}
          accessibilityLabel={isArchived ? `Unarchive ${product.name}` : `Archive ${product.name}`}
        >
          <Icon name={isArchived ? 'rotate-ccw' : 'archive'} size={ICON_SIZE.md} color={theme.background} />
        </PressableScale>
        <PressableScale
          style={[s.swipeBtn, { backgroundColor: theme.error }]}
          onPress={() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); closeSwipe(); onQuickDelete(product); }}
          accessibilityLabel={`Delete ${product.name}`}
        >
          <Icon name="trash-2" size={ICON_SIZE.md} color={theme.background} />
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
        <View style={[s.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
          {/* Hero image */}
          <View style={[s.imageBox, { height: imageHeight }]}>
            <PressableScale
              style={StyleSheet.absoluteFill}
              onPress={() => onPress(product)}
              onPressIn={onPressIn ? () => onPressIn(product) : undefined}
              activeScale={0.98}
              accessibilityLabel={`${product.name}, ${statusLabel(product.status)}, ${formatCents(price)}`}
            >
            <View style={{ height: imageHeight, width: '100%' }}>
            {coverUri ? (
              <CachedImage source={{ uri: coverUri }} style={s.image} contentFit="cover" recyclingKey={product.id} />
            ) : (
              <LinearGradient colors={gradColors} style={s.image} />
            )}

            {/* Status chip */}
            <View style={s.chipTopLeft}>
              <StatusBadge label={statusLabel(product.status)} variant={statusVariant(product.status)} small />
            </View>
            </View>
            </PressableScale>

            {/* Quick more button */}
            <PressableScale
              style={s.moreBtn}
              onPress={() => onMore(product)}
              hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
              accessibilityLabel={`More actions for ${product.name}`}
            >
              <View style={[s.moreBtnInner, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                <Icon name="more-horizontal" size={ICON_SIZE.sm} color="#FFFFFF" />
              </View>
            </PressableScale>

            {/* Stock warning chip, bottom of image — tap opens the quick
                per-variant stock editor. */}
            {(stock === 0 || stock <= threshold) && (
              // Positioned by a plain View: PressableScale puts `style` on its
              // inner view, so an absolute `bottom` there anchored to a
              // zero-height wrapper at the top of the image and the chip was
              // clipped out of sight.
              <View style={s.chipBottomLeft} pointerEvents="box-none">
                <PressableScale
                  style={[s.chipBottomInner, { backgroundColor: flagColors.bg, borderColor: flagColors.border }]}
                  noMinHeight
                  onPress={() => onEditStock(product)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel={`Edit stock for ${product.name}, ${stockLabel}`}
                >
                  <Text style={[s.chipBottomLabel, { color: flagColors.fg }]} numberOfLines={1}>{stockLabel}</Text>
                </PressableScale>
              </View>
            )}
          </View>

          {/* Content below image */}
          <View style={s.content}>
            <PressableScale
              onPress={() => onPress(product)}
              onPressIn={onPressIn ? () => onPressIn(product) : undefined}
              accessibilityLabel={`View ${product.name}`}
            >
            <Text style={[s.name, { color: theme.text }]} numberOfLines={2}>{product.name}</Text>
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
            </PressableScale>

            {stock > threshold && (
              <PressableScale
                onPress={() => onEditStock(product)}
                hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                accessibilityLabel={`Edit stock for ${product.name}, ${stockLabel}`}
              >
                <Text style={[s.stock, { color: theme.muted }]}>{stockLabel}</Text>
              </PressableScale>
            )}
          </View>
        </View>
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
  },
  chipBottomInner: {
    borderWidth: StyleSheet.hairlineWidth,
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
  // lineHeight/minHeight reserve 2 full lines so the grid's rows stay aligned
  // whether a name wraps or not (was numberOfLines={1}, which clipped long
  // names like "Heavyweight Hoodie — Ember" instead of showing them in full).
  name: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    lineHeight: 17,
    minHeight: 34,
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
