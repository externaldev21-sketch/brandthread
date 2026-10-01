/**
 * Category landing page (hoodies, tees, denim, ...). Backed by
 * GET /api/public/categories/:slug/products. Reached from the Discover and
 * Search "Shop by category" rows.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
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
import { SPACING } from '@/constants/spacing';

const PAGE = 30;

export default function BuyerCategoryScreen() {
  const params = useLocalSearchParams<{ slug?: string; label?: string }>();
  const slug = typeof params.slug === 'string' ? params.slug : '';
  const api = useApi();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();

  const [label, setLabel] = useState(typeof params.label === 'string' ? params.label : 'Category');
  const [products, setProducts] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const loadingMore = useRef(false);

  const load = useCallback(async (append: boolean) => {
    if (!slug) { setLoading(false); return; }
    if (append) loadingMore.current = true;
    else setError(false);
    try {
      const offset = append ? products.length : 0;
      const res = await api.publicDiscovery.categoryProducts(slug, { limit: PAGE, offset });
      setProducts((prev) => (append ? [...prev, ...(res.products ?? [])] : res.products ?? []));
      setTotal(res.total ?? 0);
      if (res.label) setLabel(res.label);
    } catch {
      if (!append) setError(true);
    } finally {
      loadingMore.current = false;
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, slug, products.length]);

  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [slug]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(false);
    setRefreshing(false);
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title={label} />
      {loading ? (
        <View style={{ paddingHorizontal: SPACING.md }}><ListSkeleton rows={4} /></View>
      ) : error ? (
        <View style={{ paddingHorizontal: SPACING.md }}>
          <SectionError message="Could not load this category. Tap to retry." onRetry={() => { setLoading(true); load(false); }} />
        </View>
      ) : (
        <DiscoveryProductGrid
          products={products}
          contentBottom={insets.bottom + SPACING.xl}
          onEndReached={() => { if (!loadingMore.current && products.length < total) load(true); }}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          empty={<EmptyState icon="shopping-bag" title={`No ${label.toLowerCase()} yet`} description="New pieces show up here as sellers list them." />}
        />
      )}
    </View>
  );
}
