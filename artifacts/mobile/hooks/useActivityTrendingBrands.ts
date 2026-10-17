import { useCallback, useState } from 'react';
import { useApi } from '@/lib/api';
import { mapTrendingBrand, type TrendingBrandRow } from '@/lib/discoveryShelves';
import { isPreviewActivityEnabled } from '@/lib/previewActivity';
import { ACTIVITY_TRENDING_FETCH, inlineTrendingBrands } from '@/lib/activityTrending';

/**
 * Trending brands for Activity's inline section — the same endpoint and
 * mapper the Trending brands screen (app/buyer-trending.tsx) uses, asked to
 * leave out brands the viewer already follows. Real data only: stays empty
 * on failure or when nothing is trending, and the section hides itself.
 *
 * Not refetched while the screen just re-renders, so a brand the viewer
 * follows here keeps showing "Following" until the next focus/refresh.
 */
export function useActivityTrendingBrands(selfId: string | null | undefined) {
  const api = useApi();
  const [brands, setBrands] = useState<TrendingBrandRow[]>([]);

  const reload = useCallback(async () => {
    // Dev-web preview has no backend to rank brands from (see
    // activity-center's loadFirstPage); show nothing rather than invent any.
    if (isPreviewActivityEnabled()) { setBrands([]); return; }
    try {
      const res = await api.publicDiscovery.trendingBrands(ACTIVITY_TRENDING_FETCH, { excludeFollowing: true });
      const rows = Array.isArray(res?.brands) ? res.brands.map(mapTrendingBrand) : [];
      setBrands(inlineTrendingBrands(rows, selfId));
    } catch {
      // Keep whatever was showing; a failed refresh shouldn't blank the section.
    }
  }, [api, selfId]);

  return { brands, reload };
}
