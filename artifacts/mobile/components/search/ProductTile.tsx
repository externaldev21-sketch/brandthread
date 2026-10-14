import { savedProducts, toggleSavedProduct } from '@/lib/saved/savedProducts';
import { openContextMenu } from '@/lib/contextMenu';
import { buildProductUrl } from '@/lib/shareLinks';
import { hapticPrimaryAction, haptics } from '@/lib/haptics';
import { copyLink, shareLink } from '@/lib/shareActions';
import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { ProductPhoto } from '@/components/media/ProductPhoto';
import { SaveHeart } from '@/components/SaveHeart';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { productTransitionKey, setPendingTileTransition } from '@/lib/tileTransition';
import { prefetchProductOnPressIn } from '@/lib/detailPrefetch';
import { formatMoney } from '@/lib/format';
import { SharedPhotoFrame } from '@/components/sharedPhoto/SharedPhotoFrame';
import { openWithSharedPhoto } from '@/lib/sharedPhoto';

// Fixed 4:5 aspect ratio for every card so the grid never has uneven row
// heights — no per-image aspect-ratio measurement.
export const GRID_CARD_ASPECT = 0.8;

export type SearchProductTileItem = {
  id: string;
  /** Real product id when it differs from the row id. */
  productId?: string;
  name: string;
  brand: string;
  color: string;
  initials: string;
  imageUri?: string | null;
  /** Omitted for the "suggested products" empty-state set, which has no price. */
  priceCents?: number;
};

/**
 * Product grid card — a 4:5 image, price chip overlay, name and brand row.
 * `sharedPhoto`: the caller opens `/thread-product-detail`, so the photo grows
 * into the product page (lib/sharedPhoto.ts).
 */
export function ProductTile({ item, accent: _accent, onPress, width, sharedPhoto = false }: {
  item: SearchProductTileItem;
  accent: string;
  onPress: () => void;
  width: number;
  sharedPhoto?: boolean;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const mediaRef = React.useRef<View>(null);

  // The photo grows into the product page (lib/tileTransition.ts); measure
  // it first, then navigate either way.
  const handlePress = () => {
    hapticPrimaryAction();
    if (sharedPhoto) { openWithSharedPhoto(item.productId ?? item.id, onPress); return; }
    const media = mediaRef.current;
    if (!item.imageUri || !media?.measureInWindow) { onPress(); return; }
    media.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) {
        setPendingTileTransition({ postId: productTransitionKey(item.productId ?? item.id), uri: item.imageUri ?? null, rect: { x, y, width: w, height: h } });
      }
      onPress();
    });
  };

  // Long-press: the Instagram grid preview menu — the product enlarged over a
  // blurred screen with Save / Share / Copy link under it; tapping the
  // preview opens the product. Only for real products (with a share URL).
  const productId = item.productId ?? item.id;
  const url = typeof item.priceCents === 'number' ? buildProductUrl(productId) : null;
  const openMenu = () => {
    if (!url) return;
    const saved = savedProducts.has(productId);
    const price = typeof item.priceCents === 'number' ? formatMoney(item.priceCents) : null;
    openContextMenu({
      preview: {
        imageUri: item.imageUri,
        aspectRatio: GRID_CARD_ASPECT,
        title: item.name,
        subtitle: [item.brand, price].filter(Boolean).join(' · '),
      },
      onPreviewPress: onPress,
      items: [
        {
          key: 'save', label: saved ? 'Remove from saved' : 'Save', icon: 'bookmark',
          onPress: () => {
            haptics.light();
            void toggleSavedProduct({ productId, title: item.name, brand: item.brand, priceCents: item.priceCents });
          },
        },
        { key: 'share', label: 'Share', icon: 'share', onPress: () => { void shareLink(url, `${item.name} on Brandthread`); } },
        { key: 'copy', label: 'Copy link', icon: 'link', onPress: () => { void copyLink(url); } },
      ],
    });
  };

  return (
    <View style={{ width }}>
    <Pressable
      onPress={handlePress}
      onPressIn={() => {
        // Preserve press-in prefetch while adding the shared long-press preview.
        pressScaleAnim(scale, PRESS_SCALE).start();
        prefetchProductOnPressIn(item.productId ?? item.id, item.imageUri);
      }}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      onLongPress={url ? openMenu : undefined}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}, ${item.brand}`}
    >
      <Animated.View style={[styles.card, { width, transform: [{ scale }] }]}>
        <SharedPhotoFrame productId={item.productId ?? item.id} uri={item.imageUri} radius={RADII.card}>
        <View ref={mediaRef} collapsable={false} style={[styles.media, { width, height: width / GRID_CARD_ASPECT }]}>
          <ProductPhoto uri={item.imageUri} brand={item.brand} name={item.name} style={StyleSheet.absoluteFill} />
        </View>
          {typeof item.priceCents === 'number' && (
            <View style={styles.priceChip}>
              <Text style={styles.priceText}>{formatMoney(item.priceCents)}</Text>
            </View>
          )}
        </SharedPhotoFrame>
        <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
        <View style={styles.brandRow}>
          <View style={[styles.brandDot, { backgroundColor: item.color }]} />
          <Text style={styles.brand} numberOfLines={1}>{item.brand}</Text>
        </View>
      </Animated.View>
    </Pressable>
    {/* Sibling of the card Pressable (never nested): bottom-right of the photo. */}
    <SaveHeart
      productId={item.productId ?? item.id}
      title={item.name}
      brand={item.brand}
      priceCents={item.priceCents}
      style={{ position: 'absolute', right: SPACING.xs + 1, top: width / GRID_CARD_ASPECT - 30 - SPACING.xs - 1 }}
    />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  card: {},
  media: { borderRadius: RADII.card, overflow: 'hidden', justifyContent: 'flex-end' },
  fallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.background}24` },
  fallbackInitials: { color: theme.onAccent, ...TYPE_SCALE.title1, fontFamily: FONT.bold },
  fallbackLine: { width: 42, height: 2, borderRadius: 1, backgroundColor: `${theme.onAccent}8A`, marginTop: SPACING.xs + 2 },
  priceChip: { alignSelf: 'flex-start', backgroundColor: `${theme.background}C7`, borderRadius: RADII.chip, paddingHorizontal: SPACING.sm + 2, paddingVertical: SPACING.xxs + 2, margin: SPACING.xs + 1 },
  priceText: { color: theme.text, ...TYPE_SCALE.caption, fontFamily: FONT.bold },
  // Fixed height accommodates two lines so cards never shift height whether
  // the product name wraps or not (numberOfLines={2} below).
  name: { color: theme.text, ...TYPE_SCALE.callout, height: 36, fontFamily: FONT.bold, marginTop: SPACING.xs },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs + 2, marginTop: 5, height: 20 },
  brandDot: { width: 15, height: 15, borderRadius: RADII.avatar },
  brand: { color: theme.muted, ...TYPE_SCALE.caption, flex: 1 },
});
