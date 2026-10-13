/**
 * Best-seller / slow-mover flags on the seller Products list.
 *
 * The server owns the rules (api-server lib/productSalesFlags.ts, last 30 days
 * of paid orders) and answers GET /api/products/sales-flags with only the
 * flagged products. The `&demo=1` seller preview has no orders, so it ranks the
 * preview catalog's own `totalSales` with the same best-seller cut (top 10%,
 * at least 3 units, at most 5) and never invents slow movers.
 */
import type { Product } from '@/services/productTypes';

export type SalesFlag = 'best_seller' | 'slow_mover';
export type SalesFlagMap = Record<string, SalesFlag>;

export const SALES_FLAG_LABEL: Record<SalesFlag, string> = {
  best_seller: 'Best seller',
  slow_mover: 'Slow mover',
};

export function isSalesFlag(value: unknown): value is SalesFlag {
  return value === 'best_seller' || value === 'slow_mover';
}

/** Keeps only well-formed entries from the server response. */
export function parseSalesFlags(raw: unknown): SalesFlagMap {
  const out: SalesFlagMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, flag] of Object.entries(raw as Record<string, unknown>)) {
    if (isSalesFlag(flag)) out[id] = flag;
  }
  return out;
}

export function previewSalesFlags(products: Pick<Product, 'id' | 'status' | 'totalSales'>[]): SalesFlagMap {
  const active = products.filter((p) => p.status === 'active');
  const slots = Math.min(5, Math.ceil(active.length * 0.1));
  const out: SalesFlagMap = {};
  [...active]
    .sort((a, b) => (b.totalSales ?? 0) - (a.totalSales ?? 0))
    .slice(0, slots)
    .forEach((p) => { if ((p.totalSales ?? 0) >= 3) out[p.id] = 'best_seller'; });
  return out;
}
