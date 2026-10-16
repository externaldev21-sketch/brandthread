/**
 * "Featured" — brands that bought a time-boxed Featured slot (admin-approved
 * and paid; the server only returns brands inside their window). Sits under
 * the filter row on Discover and reuses the same DiscoverBrandCard as the
 * Trending Brands rail. Renders nothing when no brand is featured, and never
 * errors the screen. The endpoint is public, so this is safe signed out; demo
 * brands only appear with &demo=1.
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useApi } from '@/hooks/useApi';
import { SP } from '@/lib/theme';
import { SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_SPACE } from '@/constants/reframe';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { DiscoverBrandCard } from './DiscoverBrandCard';
import { useStickyState } from '@/lib/stickyState';
import { DISCOVER_KEYS } from '@/lib/discoverTabData';
import type { DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';

const CARD_WIDTH = 130;

const DEMO_BRANDS: BrandCardData[] = [
  { id: 'demo-featured-1', name: 'Maison Vela', verified: true, followersLabel: 'Featured' },
  { id: 'demo-featured-2', name: 'Atelier Nord', verified: false, followersLabel: 'Featured' },
  { id: 'demo-featured-3', name: 'Studio Sable', verified: true, followersLabel: 'Featured' },
];

/** Featured brands, sticky across remounts (lib/stickyState.ts) so the rail
 *  is already in place on a revisit instead of popping in above the grid.
 *  `settled` flips once the first fetch has answered either way. */
export function useFeaturedBrands(): { brands: BrandCardData[]; settled: boolean } {
  const api = useApi();
  const [brands, setBrands, hadCache] = useStickyState<BrandCardData[]>(DISCOVER_KEYS.featured, [], { persist: !isPreviewDemoMode() });
  const [settled, setSettled] = useState(hadCache);

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
      } finally {
        if (alive) setSettled(true);
      }
    })();
    return () => { alive = false; };
  }, [api, setBrands]);

  return { brands, settled };
}

export function DiscoverFeaturedRail({ brands }: { brands: BrandCardData[] }) {
  if (brands.length === 0) return null;
  return (
    <View style={{ marginTop: X_SPACE[4], marginBottom: X_SPACE[8], paddingHorizontal: X_GUTTER }} testID="discover-featured-rail">
      <SectionHeader title="Featured" inset={false} />
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
