/**
 * "Shop by category" and "Trending products" shelves for Discover (and the
 * category row in Search). Both render nothing when they have no real data.
 * Mobbin references: GOAT / SSENSE category shelves, Shop app trending row
 * (image tile, name, brand, price).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { CategoryTile } from '@/components/search/CategoryTile';
import { EditorialTile, type EditorialTileItem } from './EditorialTile';
import { SP, FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { lowestPriceCents, initialsOf, type DiscoveryCategory } from '@/lib/discoveryShelves';

const CATEGORY_TILE = 112;

export function ShelfHeader({ title, onSeeAll, padded = true }: { title: string; onSeeAll?: () => void; padded?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.header, padded && { paddingHorizontal: SP.md }]}>
      <Text style={[TYPE_SCALE.headline, { color: theme.text }]}>{title}</Text>
      {onSeeAll && (
        <PressableScale onPress={onSeeAll} accessibilityRole="button" accessibilityLabel={`See all ${title.toLowerCase()}`} hitSlop={12} noMinHeight>
          <Text style={[TYPE_SCALE.footnote, { color: theme.text, fontFamily: FONT.semibold }]}>See all</Text>
        </PressableScale>
      )}
    </View>
  );
}

export function openCategory(router: ReturnType<typeof useRouter>, c: { slug: string; label: string }) {
  router.push(`/buyer-category?slug=${encodeURIComponent(c.slug)}&label=${encodeURIComponent(c.label)}` as never);
}

export function ShopByCategoryRail({ categories, padded = true }: { categories: DiscoveryCategory[]; padded?: boolean }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  if (categories.length === 0) return null;
  return (
    <View style={{ marginVertical: SP.md }}>
      <ShelfHeader title="Shop by category" padded={padded} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.track, padded && { paddingHorizontal: SP.md }]}
      >
        {categories.map((c) => (
          <CategoryTile
            key={c.slug}
            width={CATEGORY_TILE}
            item={{ category: c.label, productCount: c.productCount, imageUri: c.coverImageUrl, color: theme.cardElevated }}
            onPress={() => openCategory(router, c)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function trendingRowToTile(row: any, i: number): EditorialTileItem {
  return {
    id: `tp_${row.id ?? i}`,
    productId: row.id,
    brand: row.sellerDisplayName ?? 'Seller',
    name: row.name,
    imageUri: (row.images ?? [])[0] ?? undefined,
    initials: initialsOf(row.name ?? 'P'),
    priceCents: lowestPriceCents(row),
  };
}

export function TrendingProductsRail({ products, onSeeAll }: { products: any[]; onSeeAll?: () => void }) {
  const { theme } = useAppTheme();
  if (products.length === 0) return null;
  return (
    <View style={{ marginVertical: SP.md }}>
      <ShelfHeader title="Trending products" onSeeAll={onSeeAll} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.track, { paddingHorizontal: SP.md }]}
      >
        {products.slice(0, 10).map((row, i) => (
          <EditorialTile key={row.id ?? i} item={trendingRowToTile(row, i)} theme={theme} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  track: { gap: 12 },
});
