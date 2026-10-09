/**
 * Editorial tile — the product-card look used by the Just Dropped / High
 * Demand rails wherever they appear (the original full-bleed Discover page,
 * and now inserted as rows inside the Explore grid). Extracted from
 * app/(buyer)/discover.tsx so both places share one implementation.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { SaveHeart } from '@/components/SaveHeart';
import { SkeletonBlock } from '@/components/layout';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT, FS, GUTTER } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { hapticLight } from '@/lib/haptics';
import { prefetchProductOnPressIn } from '@/lib/productPrefetch';
import { formatTimeRemaining } from '@/lib/countdown';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

export interface EditorialTileItem {
  id: string;
  productId: string;
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  priceCents?: number | null;
  isUrgent?: boolean;
  /** Drop/pre-order closing time — drives the countdown badge. Only ever
   *  set from a real endsAt the API returns (a product's pre-order closing
   *  date, or its parent drop's own end time), never fabricated. */
  endsAt?: string | null;
}

export const TILE_WIDTH = 152;
// Consistent 3:4 (width:height) tile image, matching the Mobbin references
// used elsewhere in this pass (TikTok/Instagram shop-grid tiles).
export const TILE_IMAGE_HEIGHT = Math.round((TILE_WIDTH * 4) / 3);

export const EditorialTile = React.memo(function EditorialTile({ item, theme }: { item: EditorialTileItem; theme: AppThemePreset }) {
  const { push } = useThreadPull();
  const countdownLabel = formatTimeRemaining(item.endsAt);
  return (
    <View style={{ width: TILE_WIDTH }}>
    <Pressable
      onPress={() => {
        hapticLight();
        push((`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}&src=feed`) as never);
      }}
      onPressIn={() => prefetchProductOnPressIn(item.productId, item.imageUri)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} by ${item.brand}${item.priceCents != null ? `, ${formatCents(item.priceCents)}` : ''}`}
      style={{ width: TILE_WIDTH }}
    >
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[tile.imageWrap, { width: TILE_WIDTH, height: TILE_IMAGE_HEIGHT }]}
      >
        {item.imageUri ? (
          <CachedImage source={{ uri: item.imageUri }} style={tile.image} contentFit="cover" contentPosition="top center" />
        ) : (
          <View style={[StyleSheet.absoluteFill, tile.fallback]}>
            <Text style={tile.fallbackText}>{item.initials}</Text>
          </View>
        )}
        {item.isUrgent && (
          <View style={[tile.urgentDot, { backgroundColor: theme.accent }]} />
        )}
        {!!countdownLabel && (
          <View style={tile.countdownBadge}>
            <Text style={tile.countdownText} numberOfLines={1}>{countdownLabel}</Text>
          </View>
        )}
      </LinearGradient>
      {/* Image, then name / brand / price below it with a tight 4-6pt rhythm
          — never an overlay pill sitting on the image's bottom edge, which
          clipped against the image and crowded the name below it. */}
      <Text style={[tile.name, { color: theme.text }]} numberOfLines={2}>{item.name}</Text>
      <Text style={[tile.brand, { color: theme.muted }]} numberOfLines={1}>{item.brand}</Text>
      {item.priceCents != null && (
        <Text style={[tile.price, TABULAR_NUMS, { color: theme.text }]}>
          {formatCents(item.priceCents)}
        </Text>
      )}
    </Pressable>
    {/* Sibling of the tile Pressable (never nested): bottom-right of the photo. */}
    <SaveHeart
      productId={item.productId}
      title={item.name}
      brand={item.brand}
      priceCents={item.priceCents}
      style={{ position: 'absolute', right: 8, top: TILE_IMAGE_HEIGHT - 30 - 8 }}
    />
    </View>
  );
});

const tile = StyleSheet.create({
  imageWrap: { borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontSize: 34, fontFamily: FONT.bold, color: '#FFFFFF' },
  // A thin white ring so this reads clearly against a bright product photo —
  // a bare accent-colored dot could disappear against similarly-colored
  // imagery (e.g. an accent-red product on a red-toned photo).
  urgentDot: {
    position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4,
    borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  // theme-exempt: fixed monochrome badge (black pill/white text) regardless
  // of theme — same fixed-dark-chrome pattern as Discover/Search's other
  // over-image overlays; red is reserved for LIVE/end-call only.
  countdownBadge: {
    position: 'absolute', top: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: RADII.pill,
    paddingHorizontal: 12, paddingVertical: 3,
  },
  countdownText: { fontSize: 11, fontFamily: FONT.semibold, color: '#FFFFFF' },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: 6 },
  brand: { fontSize: 12, fontFamily: FONT.regular, marginTop: 4 },
  price: { fontSize: 13, fontFamily: FONT.semibold, marginTop: 4 },
});

export function TileRailSkeleton() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: GUTTER }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ width: TILE_WIDTH, gap: 8 }}>
          <SkeletonBlock width={TILE_WIDTH} height={TILE_IMAGE_HEIGHT} radius={RADII.sheet} />
          <SkeletonBlock width="80%" height={12} />
          <SkeletonBlock width="50%" height={11} />
          <SkeletonBlock width="35%" height={11} />
        </View>
      ))}
    </ScrollView>
  );
}
