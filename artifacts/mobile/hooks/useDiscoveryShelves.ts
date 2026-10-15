import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useStickyState } from '@/lib/stickyState';
import { mapTrendingBrand, type DiscoveryCategory, type TrendingBrandRow } from '@/lib/discoveryShelves';

/**
 * Real category + trending data for the Discover/Search shelves. Every list
 * stays empty on failure or when the API has nothing to rank, so callers
 * render nothing rather than placeholders.
 */
export function useDiscoveryShelves({ categories: wantCategories = true, trending: wantTrending = true }: { categories?: boolean; trending?: boolean } = {}) {
  const api = useApi();
  // Sticky across remounts (lib/stickyState.ts): the shelves are already in
  // place on a revisit instead of being inserted into the grid late.
  const [categories, setCategories, hadCategories] = useStickyState<DiscoveryCategory[]>('discovery:categories', [], { persist: true });
  const [trendingProducts, setTrendingProducts, hadProducts] = useStickyState<any[]>('discovery:trendingProducts', [], { persist: true });
  const [trendingBrands, setTrendingBrands, hadBrands] = useStickyState<TrendingBrandRow[]>('discovery:trendingBrands', [], { persist: true });
  // True once the first load has answered (or everything was already cached).
  const [settled, setSettled] = useState(
    (!wantCategories || hadCategories) && (!wantTrending || (hadProducts && hadBrands)),
  );

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
    setSettled(true);
  }, [api, wantCategories, wantTrending, setCategories, setTrendingProducts, setTrendingBrands]);

  useEffect(() => { reload(); }, [reload]);

  return { categories, trendingProducts, trendingBrands, reload, settled };
}
