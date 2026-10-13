/**
 * Buyer Threads Home feed — product tag chip.
 *
 * Lives INSIDE the bottom-left caption stack (CaptionBlock, via its
 * `topSlot`), directly above the creator name, left-aligned with it.
 *
 * Less-AI visual pass (V4/V10): the chip shows the tagged product itself —
 * frosted dark pill, 24pt product thumbnail, product name, price (or "Sold
 * out" when the product is sold out), chevron — instead of a bare "Shop"
 * pill that had to be tapped once to reveal the product and again to open
 * it. One tap now opens `ShopProductSheet`, like TikTok's product anchor on
 * a shoppable video (Mobbin, TikTok For You:
 * https://mobbin.com/screens/e8a9730d-ff55-4ed9-b969-3918178bdf4a — the
 * frosted anchor pill above the creator name). Static: no entrance motion,
 * no expand animation (Dev: only the product tag may have a delayed
 * appearance if one already existed — none did, so none is added).
 *
 * Still `<Glass noBlur>`: the pill sits over the playing video, and a live
 * backdrop blur would re-sample every frame (visible shimmer + cost).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CachedImage } from '@/components/CachedImage';
import { Glass } from '@/components/ui/Glass';
import { TABULAR_NUMS } from '@/constants/typography';
import { FONT, ON_DARK } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { tagPriceLabel } from '@/lib/productStockInfo';

export interface ShopSideTabTag {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri?: string;
}

const CHIP_HEIGHT = 36;
const THUMB_SIZE = 24;

export function ShopTagPill({
  tag, extraCount, onPress, soldOut = false,
}: {
  tag: ShopSideTabTag;
  extraCount: number;
  onPress: () => void;
  /** Real stock state from the public stock-info endpoint (see
   *  lib/productStockInfo.ts); false while unknown. */
  soldOut?: boolean;
}) {
  const priceLabel = tagPriceLabel(tag.priceCents, soldOut);
  return (
    <View style={styles.pill}>
      <Glass variant="regular" tint="dark" radius={CHIP_HEIGHT / 2} noBlur style={StyleSheet.absoluteFill} />
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.85}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Shop ${tag.productName}, ${priceLabel}${extraCount > 0 ? `, ${extraCount + 1} products` : ''}`}
        testID="shop-tag-pill"
      >
        <View style={styles.thumb}>
          {tag.imageUri ? (
            <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <Feather name="shopping-bag" size={13} color="#111111" />
          )}
        </View>
        <Text style={styles.name} numberOfLines={1}>{tag.productName}</Text>
        <Text style={[styles.price, soldOut && styles.soldOut]} numberOfLines={1}>
          {priceLabel}{extraCount > 0 ? ` +${extraCount}` : ''}
        </Text>
        <Feather name="chevron-right" size={14} color={ON_DARK} pointerEvents="none" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: CHIP_HEIGHT,
    borderRadius: RADII.pill,
    overflow: 'hidden',
  },
  row: {
    height: CHIP_HEIGHT,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingLeft: 6, paddingRight: 10,
  },
  thumb: {
    width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  // `minWidth: 0` lets a long name ellipsize before the price is squeezed.
  name: { flexShrink: 1, minWidth: 0, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  price: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },
  soldOut: { fontFamily: FONT.semibold },
});
