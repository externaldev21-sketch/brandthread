/**
 * Products tab sort sheet → the real product query (services/productService
 * getProducts' `sortBy` / `sortDir`). The list is never re-sorted on the
 * client; whatever the query returns is what the grid shows.
 */
import type { ProductSearchQuery } from '@/services/productTypes';

export type ProductSortKey = 'newest' | 'oldest' | 'price_desc' | 'price_asc' | 'sales';

export const DEFAULT_PRODUCT_SORT: ProductSortKey = 'newest';

/** Order and labels as Dev specified them for the sort sheet. */
export const PRODUCT_SORT_OPTIONS: readonly { key: ProductSortKey; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'sales', label: 'Best selling' },
];

export function productSortQuery(key: ProductSortKey): Required<Pick<ProductSearchQuery, 'sortBy' | 'sortDir'>> {
  switch (key) {
    case 'oldest': return { sortBy: 'createdAt', sortDir: 'asc' };
    case 'price_desc': return { sortBy: 'price', sortDir: 'desc' };
    case 'price_asc': return { sortBy: 'price', sortDir: 'asc' };
    case 'sales': return { sortBy: 'sales', sortDir: 'desc' };
    case 'newest':
    default: return { sortBy: 'createdAt', sortDir: 'desc' };
  }
}

export function productSortLabel(key: ProductSortKey): string {
  return PRODUCT_SORT_OPTIONS.find((o) => o.key === key)?.label ?? 'Newest';
}
