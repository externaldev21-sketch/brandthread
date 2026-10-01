/**
 * "Featured" — brands that bought a time-boxed Featured slot (admin-approved
 * and paid; the server only returns brands inside their window). Sits under
 * the filter row on Discover and reuses the same DiscoverBrandCard as the
 * Trending Brands rail. Renders nothing when no brand is featured, and never
 * errors the screen. The endpoint is public, so this is safe signed out; demo
 * brands only appear with &demo=1.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { DiscoverBrandCard } from './DiscoverBrandCard';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const CARD_WIDTH = 130;

const DEMO_BRANDS: BrandCardData[] = [
  { id: 'demo-featured-1', name: 'Maison Vela', verified: true, followersLabel: 'Featured' },
  { id: 'demo-featured-2', name: 'Atelier Nord', verified: false, followersLabel: 'Featured' },
  { id: 'demo-featured-3', name: 'Studio Sable', verified: true, followersLabel: 'Featured' },
];

export function DiscoverFeaturedRail() {
  const { theme } = useAppTheme();
  const api = useApi();
  const [brands, setBrands] = useState<BrandCardData[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.featuredSlots.active();
        const rows = (res.brands ?? []).map((b): BrandCardData => ({
          id: b.sellerId, name: b.name, verified: b.verified,
          imageUri: b.imageUrl ?? undefined, followersLabel: 'Featured',
        }));
        if (alive) setBrands(rows.length > 0 ? rows : isPreviewDemoMode() ? DEMO_BRANDS : []);
      } catch {
        if (alive && isPreviewDemoMode()) setBrands(DEMO_BRANDS);
      }
    })();
    return () => { alive = false; };
  }, [api]);

  if (brands.length === 0) return null;
  return (
    <View style={{ marginTop: SP.sm, marginBottom: SP.md, paddingHorizontal: SP.md }} testID="discover-featured-rail">
      <Text style={[TYPE_SCALE.headline, { color: theme.text, marginBottom: 10 }]}>Featured</Text>
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
