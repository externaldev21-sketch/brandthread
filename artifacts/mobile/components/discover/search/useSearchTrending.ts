/**
 * Data for the focused, nothing-typed state of the Discover search overlay:
 * ranked trending searches, trending brands and trending products — all real
 * API data. Trending brands/products fall back to the existing "suggested"
 * empty-state endpoint (most-followed brands, newest listings) when the
 * trending windows have no signals yet, so the state is never blank.
 * Sample searches only appear under the explicit `&demo=1` preview.
 */
import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { followersLabel, lowestPriceCents } from '@/lib/discoveryShelves';
import { getPreviewCatalog } from '@/lib/previewCatalog';

export interface TrendingQuery { term: string; rank: number; tag: 'hot' | 'new' | null }
export interface TrendingBrandItem { id: string; name: string; imageUri?: string | null; verified?: boolean; subline?: string; initials: string; color?: string }
export interface TrendingProductItem { id: string; name: string; brand: string; imageUri?: string | null; priceCents?: number | null }

const DEMO_QUERIES: TrendingQuery[] = [
  { term: 'baggy jorts', rank: 1, tag: 'hot' },
  { term: 'linen set', rank: 2, tag: 'new' },
  { term: 'vintage denim', rank: 3, tag: null },
  { term: 'boxy tee', rank: 4, tag: null },
  { term: 'cargo pants', rank: 5, tag: 'hot' },
  { term: 'knit polo', rank: 6, tag: null },
];

const initials = (name: string) =>
  name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';

/** `&demo=1` only: brands/products from the bundled preview catalog. */
function demoShelves(): { brands: TrendingBrandItem[]; products: TrendingProductItem[] } {
  const catalog = getPreviewCatalog();
  const seen = new Set<string>();
  return {
    brands: catalog.filter((p) => !seen.has(p.sellerDisplayName) && seen.add(p.sellerDisplayName)).slice(0, 5).map((p) => ({
      id: p.sellerId, name: p.sellerDisplayName, initials: initials(p.sellerDisplayName),
    })),
    products: catalog.slice(0, 5).map((p) => ({
      id: p.productId, name: p.name, brand: p.sellerDisplayName, imageUri: p.images[0] ?? null, priceCents: p.currentPriceCents,
    })),
  };
}

export function useSearchTrending(enabled: boolean) {
  const api = useApi();
  const [queries, setQueries] = useState<TrendingQuery[]>([]);
  const [brands, setBrands] = useState<TrendingBrandItem[]>([]);
  const [products, setProducts] = useState<TrendingProductItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const demo = isPreviewDemoMode();
    if (demo) {
      // Show the demo shelves at once; real data below replaces them if the API answers.
      const shelves = demoShelves();
      setQueries(DEMO_QUERIES);
      setBrands(shelves.brands);
      setProducts(shelves.products);
    }
    const [hot, tBrands, tProducts] = await Promise.allSettled([
      api.public.hot(10),
      api.publicDiscovery.trendingBrands(6),
      api.publicDiscovery.trendingProducts(6),
    ]);
    const realQueries = hot.status === 'fulfilled' ? hot.value.queries ?? [] : [];
    setQueries(realQueries.length > 0 ? realQueries : (demo ? DEMO_QUERIES : []));

    let brandItems: TrendingBrandItem[] = tBrands.status === 'fulfilled'
      ? (tBrands.value.brands ?? []).map((b) => ({
          id: b.id ?? b.sellerId, name: b.name, imageUri: b.logoUrl ?? b.coverImageUrl ?? null,
          verified: !!b.verified, subline: followersLabel(b.followerCount ?? 0), initials: initials(b.name),
        }))
      : [];
    let productItems: TrendingProductItem[] = tProducts.status === 'fulfilled'
      ? (tProducts.value.products ?? []).map((p: any) => ({
          id: p.id, name: p.name, brand: p.sellerDisplayName ?? p.seller?.displayName ?? '',
          imageUri: (p.images ?? []).find((i: unknown) => typeof i === 'string' && i) ?? null,
          priceCents: lowestPriceCents(p),
        }))
      : [];

    if (brandItems.length === 0 || productItems.length === 0) {
      try {
        const suggested = await api.public.suggested(6);
        if (brandItems.length === 0) {
          brandItems = (suggested.brands ?? []).map((b) => ({
            id: b.sellerId, name: b.name, initials: b.initials, color: b.color,
            subline: followersLabel(b.followerCount ?? 0),
          }));
        }
        if (productItems.length === 0) {
          productItems = (suggested.products ?? []).map((p) => ({
            id: p.productId, name: p.name, brand: p.brand, imageUri: p.imageUri,
          }));
        }
      } catch {
        // Nothing more to show.
      }
    }
    if (demo) {
      const shelves = demoShelves();
      if (brandItems.length === 0) brandItems = shelves.brands;
      if (productItems.length === 0) productItems = shelves.products;
    }
    setBrands(brandItems.slice(0, 5));
    setProducts(productItems.slice(0, 5));
    setLoaded(true);
  }, [api]);

  useEffect(() => {
    if (enabled && !loaded) load();
  }, [enabled, loaded, load]);

  return { queries, brands, products, loaded };
}
