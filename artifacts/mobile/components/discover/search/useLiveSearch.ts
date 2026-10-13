/**
 * Live search data for the Discover search overlay. One debounced (150ms)
 * fetch per query feeds both the as-you-type suggestions and the submitted
 * results view — the same three sources the old standalone search screen
 * used: api.public.search (brands, products, videos + facets),
 * api.social.search (people; signed-in only, it is a protected endpoint) and
 * api.hashtags.search.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import type { SearchResult, SearchProduct, SearchBrand, SearchVideo } from '@/lib/searchData';
import type { SearchPerson } from '@/components/search/PersonRow';
import type { SearchTag } from '@/components/search/TagRow';
import { filtersToApiOptions, type SearchFacets, type SearchFilters } from '@/lib/searchFilters';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewCatalog } from '@/lib/previewCatalog';
import { pickAvatarColor } from '@/lib/avatarColors';

export const LIVE_SEARCH_DEBOUNCE_MS = 150;

export type ProductResult = SearchProduct & { productId?: string; sellerId?: string; imageUri?: string | null };
export type BrandResult = SearchBrand & { sellerId?: string; imageUri?: string | null };
export type VideoResult = SearchVideo;

/** `&demo=1` only: the bundled preview catalog, matched like the live search. */
function demoResults(q: string): SearchResult[] {
  const term = q.toLowerCase();
  const rows = getPreviewCatalog().filter((p) =>
    [p.name, p.sellerDisplayName, p.category, ...(p.tags ?? [])].some((f) => (f ?? '').toLowerCase().includes(term)));
  const brands = new Map<string, SearchResult>();
  const out: SearchResult[] = [];
  for (const p of rows) {
    if (!brands.has(p.sellerDisplayName)) {
      brands.set(p.sellerDisplayName, {
        id: `demo-brand-${p.sellerId}`, kind: 'brand', name: p.sellerDisplayName,
        handle: `@${p.sellerDisplayName.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        color: pickAvatarColor(p.sellerId), initials: p.sellerDisplayName.slice(0, 2).toUpperCase(),
      });
    }
    out.push({
      id: p.id, kind: 'product', productId: p.productId, brand: p.sellerDisplayName, name: p.name,
      priceCents: p.currentPriceCents ?? p.priceCents ?? 0, color: pickAvatarColor(p.sellerId),
      initials: p.sellerDisplayName.slice(0, 2).toUpperCase(), imageUri: p.images[0],
    } as SearchResult);
  }
  return [...brands.values(), ...out];
}

export function useLiveSearch(query: string, filters: SearchFilters) {
  const api = useApi();
  const { isSignedIn } = useAuth();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [tags, setTags] = useState<SearchTag[]>([]);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [searching, setSearching] = useState(false);
  const [settledQuery, setSettledQuery] = useState('');

  const run = useCallback(async (term: string) => {
    const [productRes, peopleRes, tagRes] = await Promise.allSettled([
      api.public.search({ q: term, limit: 30, facets: true, ...filtersToApiOptions(filters) }),
      isSignedIn ? api.social.search(term, 20) : Promise.resolve([]),
      api.hashtags.search(term, 6),
    ]);
    let rows = productRes.status === 'fulfilled' ? productRes.value.results ?? [] : [];
    if (rows.length === 0 && isPreviewDemoMode()) rows = demoResults(term);
    return {
      rows: rows as SearchResult[],
      facets: productRes.status === 'fulfilled' ? productRes.value.facets ?? null : null,
      people: peopleRes.status === 'fulfilled' ? (peopleRes.value as unknown as SearchPerson[]) : [],
      tags: tagRes.status === 'fulfilled' ? tagRes.value.tags ?? [] : [],
    };
  }, [api, isSignedIn, filters]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]); setPeople([]); setTags([]); setSearching(false); setSettledQuery('');
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const out = await run(q);
      if (cancelled) return;
      setResults(out.rows);
      setPeople(out.people);
      setTags(out.tags);
      if (out.facets) setFacets(out.facets);
      setSettledQuery(q);
      setSearching(false);
    }, LIVE_SEARCH_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, run]);

  const products = useMemo(() => results.filter((r): r is ProductResult => r.kind === 'product'), [results]);
  const brands = useMemo(() => results.filter((r): r is BrandResult => r.kind === 'brand'), [results]);
  const videos = useMemo(() => results.filter((r): r is VideoResult => r.kind === 'video'), [results]);

  return { products, brands, videos, people, setPeople, tags, facets, searching, settledQuery };
}
