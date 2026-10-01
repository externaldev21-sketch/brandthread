import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { mapTrendingBrand, type DiscoveryCategory, type TrendingBrandRow } from '@/lib/discoveryShelves';

/**
 * Real category + trending data for the Discover/Search shelves. Every list
 * stays empty on failure or when the API has nothing to rank, so callers
 * render nothing rather than placeholders.
 */
export function useDiscoveryShelves({ categories: wantCategories = true, trending: wantTrending = true }: { categories?: boolean; trending?: boolean } = {}) {
  const api = useApi();
  const [categories, setCategories] = useState<DiscoveryCategory[]>([]);
  const [trendingProducts, setTrendingProducts] = useState<any[]>([]);
  const [trendingBrands, setTrendingBrands] = useState<TrendingBrandRow[]>([]);

  const reload = useCallback(async () => {
    await Promise.all([
      wantCategories
        ? api.publicDiscovery.categories()
            .then((r) => setCategories(Array.isArray(r?.categories) ? r.categories : []))
            .catch(() => {})
        : Promise.resolve(),
      wantTrending
        ? api.publicDiscovery.trendingProducts(12)
            .then((r) => setTrendingProducts(Array.isArray(r?.products) ? r.products : []))
            .catch(() => {})
        : Promise.resolve(),
      wantTrending
        ? api.publicDiscovery.trendingBrands(12)
            .then((r) => setTrendingBrands(Array.isArray(r?.brands) ? r.brands.map(mapTrendingBrand) : []))
            .catch(() => {})
        : Promise.resolve(),
    ]);
  }, [api, wantCategories, wantTrending]);

  useEffect(() => { reload(); }, [reload]);

  return { categories, trendingProducts, trendingBrands, reload };
}
