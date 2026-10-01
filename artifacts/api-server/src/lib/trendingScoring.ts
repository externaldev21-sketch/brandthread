/**
 * Pure scoring for "Trending products" and "Trending brands".
 *
 * Inputs are real event counts inside a recent window (product views from
 * store_visits, saves from saved_items, paid units from orders, stock
 * reservations, follows). Nothing here is fabricated: an item with no
 * signals scores 0 and is excluded, so a quiet marketplace returns an
 * honest empty list.
 */

export const TRENDING_WINDOW_DAYS = 14;

export interface ProductSignals {
  views: number;
  saves: number;
  orderUnits: number;
  reservations: number;
}

export const PRODUCT_WEIGHTS = { views: 2, saves: 4, orderUnits: 10, reservations: 6 } as const;

const clamp = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * Weighted sum. Views are dampened (sqrt) so a pile of anonymous views
 * cannot outrank genuine purchase/save intent.
 */
export function scoreProductSignals(s: ProductSignals): number {
  return (
    PRODUCT_WEIGHTS.views * Math.sqrt(clamp(s.views)) +
    PRODUCT_WEIGHTS.saves * clamp(s.saves) +
    PRODUCT_WEIGHTS.orderUnits * clamp(s.orderUnits) +
    PRODUCT_WEIGHTS.reservations * clamp(s.reservations)
  );
}

export interface BrandSignals {
  orders: number;
  newFollowers: number;
  saves: number;
  visits: number;
}

export const BRAND_WEIGHTS = { orders: 8, newFollowers: 5, saves: 2, visits: 1 } as const;

export function scoreBrandSignals(s: BrandSignals): number {
  return (
    BRAND_WEIGHTS.orders * clamp(s.orders) +
    BRAND_WEIGHTS.newFollowers * clamp(s.newFollowers) +
    BRAND_WEIGHTS.saves * clamp(s.saves) +
    BRAND_WEIGHTS.visits * Math.sqrt(clamp(s.visits))
  );
}

/** Keeps items with a positive score, highest first, ties by id for stability. */
export function rankByScore<T extends { id: string; score: number }>(items: T[], limit: number): T[] {
  return items
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

export function windowStart(now: Date, days = TRENDING_WINDOW_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
