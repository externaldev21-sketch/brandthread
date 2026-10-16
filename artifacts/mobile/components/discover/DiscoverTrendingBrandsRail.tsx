/**
 * "Trending Brands" — a horizontal rail of brand cards inserted into the
 * For You grid, reusing the same DiscoverBrandCard the Brands filter's full
 * grid already uses (verified check, real Follow button) rather than
 * forking a second brand-card look. Mobbin reference: Zalando's "Suggested
 * creators" rail — square avatar, name, Follow pill, horizontal scroll
 * (https://mobbin.com/screens/8f7bd3a9-1ab5-4288-9827-55d517cebb84).
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_SPACE } from '@/constants/reframe';
import { DiscoverBrandCard } from './DiscoverBrandCard';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const CARD_WIDTH = 130;

export function DiscoverTrendingBrandsRail({ brands, onSeeAll }: { brands: BrandCardData[]; onSeeAll?: () => void }) {
  if (brands.length === 0) return null;
  return (
    <View style={{ marginVertical: X_SPACE[8], paddingHorizontal: X_GUTTER }}>
      <SectionHeader title="Trending Brands" actionLabel={onSeeAll ? 'See all' : undefined} onAction={onSeeAll} actionAccessibilityLabel="See all trending brands" inset={false} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.track}>
        {brands.map((brand) => (
          <View key={brand.id} style={{ width: CARD_WIDTH }}>
            <DiscoverBrandCard brand={brand} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: 12 },
});
