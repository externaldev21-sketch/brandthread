/**
 * "Trending Brands" — a horizontal rail of brand cards inserted into the
 * For You grid, reusing the same DiscoverBrandCard the Brands filter's full
 * grid already uses (verified check, real Follow button) rather than
 * forking a second brand-card look. Mobbin reference: Zalando's "Suggested
 * creators" rail — square avatar, name, Follow pill, horizontal scroll
 * (https://mobbin.com/screens/8f7bd3a9-1ab5-4288-9827-55d517cebb84).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { DiscoverBrandCard } from './DiscoverBrandCard';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const CARD_GAP = 12;
const CARD_TARGET = 130;

/**
 * Card width derived from the screen width so the rail always shows whole
 * cards plus a clear ~half-card peek at the screen edge — a fixed 130pt card
 * left the third card cut off by just a few px at 430pt (QA-1038).
 */
function railCardWidth(screenWidth: number): number {
  const avail = screenWidth - SP.md;
  const whole = Math.max(2, Math.round(avail / (CARD_TARGET + CARD_GAP) - 0.5));
  return Math.floor((avail - CARD_GAP * whole) / (whole + 0.5));
}

export function DiscoverTrendingBrandsRail({ brands }: { brands: BrandCardData[] }) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const cardWidth = railCardWidth(width);
  if (brands.length === 0) return null;
  return (
    <View style={{ marginVertical: SP.md }}>
      <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: 10, paddingHorizontal: SP.md }]}>Trending Brands</Text>
      {/* Edge-to-edge scroller (gutter on the content, not the clip box) so
          the peeking card is cut by the screen edge, and snaps per card. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.track}
        snapToInterval={cardWidth + CARD_GAP}
        decelerationRate="fast"
      >
        {brands.map((brand) => (
          <View key={brand.id} style={{ width: cardWidth }}>
            <DiscoverBrandCard brand={brand} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', gap: CARD_GAP, paddingHorizontal: SP.md },
});
