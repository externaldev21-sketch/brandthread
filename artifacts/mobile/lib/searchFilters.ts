/**
 * Pure filter state for buyer search. Kept free of React so it can be unit
 * tested; `components/search/FilterSheet.tsx` and `app/buyer-search.tsx` use it.
 */
export type SearchSort = 'relevance' | 'price_asc' | 'price_desc' | 'newest';

export type SearchFilters = {
  categories?: string[];
  sizes?: string[];
  colors?: string[];
  brands?: string[];
  inStock?: boolean;
  minPriceCents?: number;
  maxPriceCents?: number;
  sort?: SearchSort;
};

export type SearchFacets = {
  sizes: Array<{ value: string; count: number }>;
  colors: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
  brands: Array<{ id: string; name: string; count: number }>;
  price: { minCents: number; maxCents: number } | null;
  inStockCount: number;
};

export const EMPTY_FILTERS: SearchFilters = {};

/** One count per facet group: the price range, sort and in-stock each count once; each selected value counts. */
export function countActiveFilters(f: SearchFilters): number {
  let n = 0;
  n += f.categories?.length ?? 0;
  n += f.sizes?.length ?? 0;
  n += f.colors?.length ?? 0;
  n += f.brands?.length ?? 0;
  if (f.inStock) n++;
  if (f.minPriceCents !== undefined || f.maxPriceCents !== undefined) n++;
  if (f.sort && f.sort !== 'relevance') n++;
  return n;
}

/** Adds the value when absent, removes it when present (case-insensitive). Drops empty lists. */
export function toggleValue(list: string[] | undefined, value: string): string[] | undefined {
  const current = list ?? [];
  const has = current.some((v) => v.toLowerCase() === value.toLowerCase());
  const next = has ? current.filter((v) => v.toLowerCase() !== value.toLowerCase()) : [...current, value];
  return next.length ? next : undefined;
}

export function hasValue(list: string[] | undefined, value: string): boolean {
  return !!list?.some((v) => v.toLowerCase() === value.toLowerCase());
}

/** Options for the `api.public.search` call. Omits anything unset so the URL stays minimal. */
export function filtersToApiOptions(f: SearchFilters) {
  return {
    ...(f.categories?.length ? { category: f.categories } : {}),
    ...(f.sizes?.length ? { size: f.sizes } : {}),
    ...(f.colors?.length ? { color: f.colors } : {}),
    ...(f.brands?.length ? { brand: f.brands } : {}),
    ...(f.inStock ? { inStock: true } : {}),
    ...(f.minPriceCents !== undefined ? { minPriceCents: f.minPriceCents } : {}),
    ...(f.maxPriceCents !== undefined ? { maxPriceCents: f.maxPriceCents } : {}),
    ...(f.sort && f.sort !== 'relevance' ? { sort: f.sort } : {}),
  };
}

export type PriceBucket = { key: string; label: string; min?: number; max?: number };

/** Buckets adapt to the price range of the current results (from facets); a fixed set is the fallback. */
export function priceBucketsFor(range: { minCents: number; maxCents: number } | null): PriceBucket[] {
  const fixed: PriceBucket[] = [
    { key: 'u50', label: 'Under $50', max: 5000 },
    { key: '50-100', label: '$50 to $100', min: 5000, max: 10000 },
    { key: '100-200', label: '$100 to $200', min: 10000, max: 20000 },
    { key: 'o200', label: '$200 and up', min: 20000 },
  ];
  if (!range) return fixed;
  // Hide buckets that cannot match anything in the current results.
  return fixed.filter((b) => (b.min === undefined || range.maxCents >= b.min) && (b.max === undefined || range.minCents <= b.max));
}
