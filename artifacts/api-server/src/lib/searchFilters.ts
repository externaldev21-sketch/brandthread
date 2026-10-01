/**
 * Pure helpers for the public product-search filters: query-param parsing
 * (multi-value size / colour / category / brand, in-stock) and facet
 * aggregation. No DB access here so it is unit-testable; the route turns the
 * parsed filters into SQL.
 */
import { normalizeSearchTerm } from "./search";

export const MAX_FILTER_VALUES = 20;

export interface ParsedSearchFilters {
  categories: string[];
  sizes: string[];
  colors: string[];
  brands: string[];
  inStock: boolean;
}

/** Accepts `?size=M&size=L` (array) or a single string. Returns null when a non-string sneaks in. */
export function multiQueryValues(value: unknown): string[] | null {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") return null;
    const v = normalizeSearchTerm(item, 60);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out.slice(0, MAX_FILTER_VALUES);
}

export function parseBooleanFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

/** Returns null when any value is malformed (route answers 400). */
export function parseSearchFilters(query: Record<string, unknown>): ParsedSearchFilters | null {
  const categories = multiQueryValues(query.category);
  const sizes = multiQueryValues(query.size);
  const colors = multiQueryValues(query.color ?? query.colour);
  const brands = multiQueryValues(query.brand);
  const inStock = parseBooleanFlag(query.inStock);
  if (!categories || !sizes || !colors || !brands || inStock === null) return null;
  return { categories, sizes, colors, brands, inStock };
}

export interface FacetRow {
  productId: string;
  category: string;
  ownerId: string;
  brandName: string | null;
  size: string | null;
  color: string | null;
  priceCents: number;
  stock: number;
}

export interface SearchFacets {
  sizes: Array<{ value: string; count: number }>;
  colors: Array<{ value: string; count: number }>;
  categories: Array<{ value: string; count: number }>;
  brands: Array<{ id: string; name: string; count: number }>;
  price: { minCents: number; maxCents: number } | null;
  inStockCount: number;
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

export function compareSizes(a: string, b: string): number {
  const ia = SIZE_ORDER.indexOf(a.toUpperCase());
  const ib = SIZE_ORDER.indexOf(b.toUpperCase());
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

/** Counts are distinct products, not variants. Values are case-folded and display the first spelling seen. */
export function buildFacets(rows: FacetRow[]): SearchFacets {
  const tally = (pick: (r: FacetRow) => string | null) => {
    const seen = new Map<string, { value: string; products: Set<string> }>();
    for (const r of rows) {
      const v = pick(r)?.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      const entry = seen.get(key) ?? { value: v, products: new Set<string>() };
      entry.products.add(r.productId);
      seen.set(key, entry);
    }
    return [...seen.values()].map((e) => ({ value: e.value, count: e.products.size }));
  };
  const byCountThenName = (a: { value: string; count: number }, b: { value: string; count: number }) =>
    b.count - a.count || a.value.localeCompare(b.value);

  const brandMap = new Map<string, { name: string; products: Set<string> }>();
  for (const r of rows) {
    const e = brandMap.get(r.ownerId) ?? { name: r.brandName ?? "Brand", products: new Set<string>() };
    e.products.add(r.productId);
    brandMap.set(r.ownerId, e);
  }

  const prices = rows.map((r) => r.priceCents);
  const inStock = new Set(rows.filter((r) => r.stock > 0).map((r) => r.productId));

  return {
    sizes: tally((r) => r.size).sort((a, b) => compareSizes(a.value, b.value)),
    colors: tally((r) => r.color).sort(byCountThenName),
    categories: tally((r) => r.category).sort(byCountThenName),
    brands: [...brandMap.entries()]
      .map(([id, e]) => ({ id, name: e.name, count: e.products.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    price: prices.length ? { minCents: Math.min(...prices), maxCents: Math.max(...prices) } : null,
    inStockCount: inStock.size,
  };
}
