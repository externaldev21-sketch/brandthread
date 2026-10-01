/**
 * "See all" for the Discover Trending rows. ?type=products (default) shows
 * the ranked product grid; ?type=brands shows the ranked brand grid. Both
 * come from real recent signals (views, saves, paid orders, follows).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/hooks/useApi';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListSkeleton } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';
import { SectionError } from '@/components/InlineFeedback';
import { ThemedRefreshControl } from '@/components/ui';
import { DiscoveryProductGrid } from '@/components/discover/DiscoveryProductGrid';
import { DiscoverBrandCard } from '@/components/discover/DiscoverBrandCard';
import { mapTrendingBrand, type TrendingBrandRow } from '@/lib/discoveryShelves';
import { SPACING } from '@/constants/spacing';

export default function BuyerTrendingScreen() {
  const { type } = useLocalSearchParams<{ type?: string }>();
  const isBrands = type === 'brands';
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();

  const [products, setProducts] = useState<any[]>([]);
  const [brands, setBrands] = useState<TrendingBrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      if (isBrands) {
        const res = await api.publicDiscovery.trendingBrands(50);
        setBrands((res.brands ?? []).map(mapTrendingBrand));
      } else {
        const res = await api.publicDiscovery.trendingProducts(50);
        setProducts(res.products ?? []);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [api, isBrands]);

  useEffect(() => { load(); }, [load]);

  const refreshControl = (
    <ThemedRefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />
  );
  const bottom = insets.bottom + SPACING.xl;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={isBrands ? 'Trending brands' : 'Trending products'} />
      {loading ? (
        <View style={{ paddingHorizontal: SPACING.md }}><ListSkeleton rows={4} /></View>
      ) : error ? (
        <View style={{ paddingHorizontal: SPACING.md }}>
          <SectionError message="Could not load trending. Tap to retry." onRetry={() => { setLoading(true); load(); }} />
        </View>
      ) : isBrands ? (
        <FlatList
          data={brands}
          keyExtractor={(b) => b.id}
          numColumns={2}
          columnWrapperStyle={{ gap: SPACING.sm, paddingHorizontal: SPACING.md }}
          contentContainerStyle={{ gap: SPACING.sm, paddingTop: SPACING.md, paddingBottom: bottom }}
          refreshControl={refreshControl}
          renderItem={({ item }) => <DiscoverBrandCard brand={item} />}
          ListEmptyComponent={<EmptyState icon="trending-up" title="No trending brands yet" description="Brands appear here as shoppers follow, save and buy." />}
        />
      ) : (
        <DiscoveryProductGrid
          products={products}
          contentBottom={bottom}
          refreshControl={refreshControl}
          empty={<EmptyState icon="trending-up" title="No trending products yet" description="Products appear here as shoppers view, save and buy." />}
        />
      )}
    </View>
  );
}
