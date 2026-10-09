import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { SaveHeart } from '@/components/SaveHeart';
import { hapticPrimaryAction } from '@/lib/haptics';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_SCALE, pressScaleAnim } from '@/constants/motion';
import { productTransitionKey, setPendingTileTransition } from '@/lib/tileTransition';

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

/** Product grid card — a 4:5 image, price chip overlay, name and brand row. */
export function ProductTile({ item, accent: _accent, onPress, width }: {
  item: SearchProductTileItem;
  accent: string;
  onPress: () => void;
  width: number;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const scale = React.useRef(new Animated.Value(1)).current;
  const mediaRef = React.useRef<View>(null);

  // The photo grows into the product page (lib/tileTransition.ts); measure
  // it first, then navigate either way.
  const handlePress = () => {
    hapticPrimaryAction();
    const media = mediaRef.current;
    if (!item.imageUri || !media?.measureInWindow) { onPress(); return; }
    media.measureInWindow((x, y, w, h) => {
      if (w > 0 && h > 0) {
        setPendingTileTransition({ postId: productTransitionKey(item.productId ?? item.id), uri: item.imageUri ?? null, rect: { x, y, width: w, height: h } });
      }
      onPress();
    });
  };

  return (
    <View style={{ width }}>
    <Pressable
      onPress={handlePress}
      onPressIn={() => pressScaleAnim(scale, PRESS_SCALE).start()}
      onPressOut={() => pressScaleAnim(scale, 1).start()}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}, ${item.brand}`}
    >
      <Animated.View style={[styles.card, { width, transform: [{ scale }] }]}>
        <View ref={mediaRef} collapsable={false} style={[styles.media, { width, height: width / GRID_CARD_ASPECT, backgroundColor: item.color }]}>
          {item.imageUri ? (
            <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.fallback}>
              <Text style={styles.fallbackInitials}>{item.initials}</Text>
              <View style={styles.fallbackLine} />
            </View>
          )}
          {typeof item.priceCents === 'number' && (
            <View style={styles.priceChip}>
              <Text style={styles.priceText}>{formatCents(item.priceCents)}</Text>
            </View>
          )}
        </View>
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
