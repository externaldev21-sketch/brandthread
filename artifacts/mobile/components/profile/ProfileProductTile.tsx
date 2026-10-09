/**
 * Product grid cell for a seller profile's Products tab (Depop's shop grid,
 * our skin): photo, price, name. A visitor's tile opens the buyer product page
 * (Buy now / Add to cart live there); the owner's tile shows an edit badge and
 * opens the seller's own product screen — no Buy affordance for the owner.
 */
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon } from '@/components/ui/Icon';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { SaveHeart } from '@/components/SaveHeart';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import type { ShopProduct } from '@/services/profileService';
import { InteractionLayer } from './ProfileControls';
import { PROFILE_GRID_GAP } from './profileLayout';

export const ProfileProductTile = React.memo(function ProfileProductTile({
  product, width, height, owner, onPress,
}: {
  product: ShopProduct;
  width: number;
  height: number;
  /** Owner mode: edit affordance instead of buying. */
  owner: boolean;
  onPress: (product: ShopProduct) => void;
}) {
  const { theme } = useAppTheme();
  const handlePress = useCallback(() => onPress(product), [onPress, product]);
  const soldOut = !product.inStock;
  const price = product.priceCents > 0 ? formatCents(product.priceCents) : null;
  return (
    <View style={{ width, height, marginBottom: PROFILE_GRID_GAP }}>
      <PressableScale
        onPress={handlePress}
        activeScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={`${owner ? 'Edit ' : ''}${product.name}${price ? `, ${price}` : ''}${soldOut ? ', sold out' : ''}`}
        testID={`profile-product-tile-${product.id}`}
        style={[styles.tile, { width, height, backgroundColor: theme.cardElevated }]}
      >
        {(state) => (
          <>
            {product.imageUri ? (
              <CachedImage source={{ uri: product.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={150} />
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
                <Icon name="shopping-bag" size={22} color={theme.muted} />
              </View>
            )}
            <LinearGradient
              pointerEvents="none"
              colors={[`${theme.shadowColor}00`, `${theme.shadowColor}C7`]}
              style={styles.scrim}
            />
            {owner ? (
              <View style={[styles.editBadge, { backgroundColor: theme.cardGlass }]} pointerEvents="none" testID={`profile-product-edit-${product.id}`}>
                <Icon name="edit-2" size={12} color={theme.text} />
              </View>
            ) : null}
            {soldOut ? (
              <View style={[styles.soldOut, { borderColor: theme.border, backgroundColor: theme.cardGlass }]} pointerEvents="none">
                <Text style={[styles.soldOutText, { color: theme.text }]}>{product.isPreOrder ? 'Pre-order' : 'Sold out'}</Text>
              </View>
            ) : null}
            <View style={styles.caption} pointerEvents="none">
              {price ? <Text style={[styles.price, { color: theme.text }]}>{price}</Text> : null}
              <Text style={[styles.name, { color: theme.muted }]} numberOfLines={1}>{product.name}</Text>
            </View>
            <InteractionLayer state={state as { pressed: boolean }} radius={0} theme={theme} />
          </>
        )}
      </PressableScale>
      {/* Visitors only — the owner's tile carries the edit badge instead.
          Sibling of the tile Pressable, never nested. */}
      {!owner ? (
        <SaveHeart
          productId={product.id}
          title={product.name}
          priceCents={product.priceCents > 0 ? product.priceCents : undefined}
          size={26}
          style={{ position: 'absolute', top: SP.sm, right: SP.sm }}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  caption: { position: 'absolute', left: SP.sm, right: SP.sm, bottom: SP.sm },
  price: { fontFamily: FONT.bold, fontSize: FS.sm },
  name: { fontFamily: FONT.regular, fontSize: FS.xs },
  editBadge: {
    position: 'absolute', top: SP.sm, right: SP.sm, width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  soldOut: {
    position: 'absolute', top: SP.sm, left: SP.sm, borderWidth: 1, borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  soldOutText: { fontFamily: FONT.semibold, fontSize: FS.xs },
});
