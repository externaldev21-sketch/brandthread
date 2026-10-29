/**
 * "Trending now" — large 4:5 cards leading For You, after Pinterest's
 * "Trending now" carousel (https://mobbin.com/screens/f4099c3c-5a6f-4c32-9fd6-35d1cc2f4988).
 * Fed only by the real trending-products endpoint
 * (api.publicDiscovery.trendingProducts via useDiscoveryShelves); renders
 * nothing when it is empty. Image first, then name / brand / price below it
 * — no text over the photo.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useContentDimensions } from '@/components/web/DesktopShellContext';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { FONT, SP } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';
import { formatCents } from '@/lib/money';
import { hapticLight } from '@/lib/haptics';
import { DiscoverSectionHeader } from './DiscoverSectionHeader';
import { trendingRowToTile } from './DiscoverShopRails';

export function DiscoverTrendingNowRail({ products, onSeeAll }: { products: any[]; onSeeAll?: () => void }) {
  const { theme } = useAppTheme();
  const { push } = useThreadPull();
  const { width } = useContentDimensions();
  if (products.length === 0) return null;
  // ~3/4 of the screen so the next card peeks in, capped for tablets/web.
  const cardWidth = Math.min(300, Math.round((width - SP.md) * 0.72));
  const imageHeight = Math.round((cardWidth * 5) / 4);
  return (
    <View style={styles.section} testID="discover-trending-now">
      <DiscoverSectionHeader title="Trending now" onSeeAll={onSeeAll} style={{ paddingHorizontal: SP.md }} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + 12}
        contentContainerStyle={styles.track}
      >
        {products.slice(0, 10).map((row, i) => {
          const item = trendingRowToTile(row, i);
          return (
            <Pressable
              key={item.id}
              onPress={() => {
                hapticLight();
                push(`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}&src=feed` as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} by ${item.brand}${item.priceCents != null ? `, ${formatCents(item.priceCents)}` : ''}`}
              style={{ width: cardWidth }}
            >
              <View style={[styles.image, { height: imageHeight, backgroundColor: theme.borderSubtle }]}>
                {item.imageUri ? (
                  <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top center" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.fallback]}>
                    <Text style={[styles.fallbackText, { color: theme.muted }]}>{item.initials}</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
              <View style={styles.metaRow}>
                <Text style={[styles.brand, { color: theme.muted }]} numberOfLines={1}>{item.brand}</Text>
                {item.priceCents != null && (
                  <Text style={[styles.price, TABULAR_NUMS, { color: theme.text }]}>{formatCents(item.priceCents)}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: SP.sm, marginBottom: SP.md },
  track: { gap: 12, paddingHorizontal: SP.md },
  image: { width: '100%', borderRadius: radius.lg, overflow: 'hidden' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontFamily: FONT.bold, fontSize: 28 },
  name: { fontFamily: FONT.semibold, fontSize: 15, lineHeight: 20, marginTop: 8 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  brand: { flex: 1, minWidth: 0, fontFamily: FONT.regular, fontSize: 13, lineHeight: 18 },
  price: { fontFamily: FONT.semibold, fontSize: 13, lineHeight: 18 },
});
