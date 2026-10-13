/**
 * Seller Products list — one status per product, derived from real product
 * fields (never stored separately):
 *
 *  - Live      published (`status: 'active'`) and buyable.
 *  - Sold out  published, but 0 units across every variant and the product
 *              can't be bought at 0 (inventory is tracked, overselling is off
 *              and it isn't a pre-order).
 *  - Draft     not published yet.
 *  - Scheduled / Archived / Hidden pass through unchanged so a product never
 *              shows a status it doesn't have.
 */
import type { Product } from '@/services/productTypes';

export type ProductListStatus = 'live' | 'sold-out' | 'draft' | 'scheduled' | 'archived' | 'hidden';

export const PRODUCT_LIST_STATUS_LABEL: Record<ProductListStatus, string> = {
  live: 'Live',
  'sold-out': 'Sold out',
  draft: 'Draft',
  scheduled: 'Scheduled',
  archived: 'Archived',
  hidden: 'Hidden',
};

type StatusInput = Pick<Product, 'status'> & {
  variants?: ReadonlyArray<{ inventoryQuantity?: number | null }> | null;
  inventory?: Partial<Pick<Product['inventory'], 'totalStock' | 'trackQuantity' | 'allowOverselling' | 'policy'>> | null;
  salesModel?: Product['salesModel'] | null;
};

/** Units across every variant; falls back to the product total when a
 *  product has no variants (or a variant has no usable count). */
export function totalStockAcrossVariants(product: StatusInput): number {
  const variants = product.variants ?? [];
  if (variants.length > 0 && variants.every(v => typeof v.inventoryQuantity === 'number' && Number.isFinite(v.inventoryQuantity))) {
    return variants.reduce((sum, v) => sum + Math.max(0, v.inventoryQuantity as number), 0);
  }
  const total = product.inventory?.totalStock;
  return typeof total === 'number' && Number.isFinite(total) ? Math.max(0, total) : 0;
}

export function deriveProductListStatus(product: StatusInput): ProductListStatus {
  switch (product.status) {
    case 'draft': return 'draft';
    case 'scheduled': return 'scheduled';
    case 'archived': return 'archived';
    case 'hidden': return 'hidden';
    default: break;
  }
  const inv = product.inventory ?? {};
  const sellsAtZero = inv.trackQuantity === false
    || inv.allowOverselling === true
    || inv.policy === 'continue'
    || product.salesModel === 'pre-order';
  if (!sellsAtZero && totalStockAcrossVariants(product) === 0) return 'sold-out';
  return 'live';
}

export function productListStatusLabel(product: StatusInput): string {
  return PRODUCT_LIST_STATUS_LABEL[deriveProductListStatus(product)];
}
