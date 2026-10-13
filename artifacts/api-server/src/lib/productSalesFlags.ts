/**
 * Best-seller / slow-mover flags for the seller's Products list.
 *
 * Rules, all over a trailing 30-day window:
 *  - best_seller: an active product in the top 10% of the seller's active
 *    products by units sold (rounded up, so a small catalog still gets one),
 *    with at least 3 units sold, and never more than 5 products in total.
 *    Ties at the cut-off are broken by product id so the result is stable.
 *  - slow_mover: an active product listed for at least 30 days (by creation
 *    date — products have no separate publish date), with stock on hand, that
 *    sold 0 units in the window.
 * Everything else (drafts, archived, new or sold-out products) gets no flag.
 *
 * "Units sold" counts order items on paid, non-cancelled orders whose payment
 * landed inside the window (see salesFlagsForSeller's query).
 */

export type SalesFlag = "best_seller" | "slow_mover";

export const SALES_FLAG_WINDOW_DAYS = 30;
export const BEST_SELLER_SHARE = 0.1;
export const BEST_SELLER_MIN_UNITS = 3;
export const BEST_SELLER_MAX_PRODUCTS = 5;
export const SLOW_MOVER_MIN_LISTED_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SalesFlagInput {
  productId: string;
  status: string;
  createdAt: Date;
  totalStock: number;
  unitsSold30d: number;
}

/** Returns only flagged products: `{ [productId]: flag }`. */
export function classifySalesFlags(rows: SalesFlagInput[], now: Date = new Date()): Record<string, SalesFlag> {
  const out: Record<string, SalesFlag> = {};
  const active = rows.filter((r) => r.status === "active");
  if (active.length === 0) return out;

  const slots = Math.min(BEST_SELLER_MAX_PRODUCTS, Math.ceil(active.length * BEST_SELLER_SHARE));
  const ranked = [...active].sort((a, b) =>
    b.unitsSold30d - a.unitsSold30d || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  for (const r of ranked.slice(0, slots)) {
    if (r.unitsSold30d >= BEST_SELLER_MIN_UNITS) out[r.productId] = "best_seller";
  }

  const listedBefore = now.getTime() - SLOW_MOVER_MIN_LISTED_DAYS * DAY_MS;
  for (const r of active) {
    if (out[r.productId]) continue;
    if (r.unitsSold30d === 0 && r.totalStock > 0 && r.createdAt.getTime() <= listedBefore) {
      out[r.productId] = "slow_mover";
    }
  }
  return out;
}
