/**
 * Product page price history (GET /api/public/products/:id/price-history).
 *
 * Rows come from product_price_history, written by the product_variants
 * trigger in migration 271 (one row per change of the product's lowest
 * variant price). The chart covers the last 90 days and only shows when the
 * price actually changed inside that window.
 */
import { asc, eq } from "drizzle-orm";
import { db, productPriceHistory } from "@workspace/db";

export const PRICE_HISTORY_DAYS = 90;

export interface PricePoint { priceCents: number; at: string }
export interface PriceHistory {
  /** False when the price hasn't changed in the window — the app shows nothing. */
  changed: boolean;
  /** Oldest first. The first point sits at the window start when the price was set before it. */
  points: PricePoint[];
}

/**
 * Pure: full history (oldest first) → the 90-day window. The price in effect
 * when the window opens is carried to the window start so the line begins
 * at the left edge; a window with fewer than two distinct prices is "unchanged".
 */
export function windowPriceHistory(rows: { priceCents: number; recordedAt: Date }[], now = new Date()): PriceHistory {
  const start = new Date(now.getTime() - PRICE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  let carried: { priceCents: number; recordedAt: Date } | null = null;
  const inside: { priceCents: number; recordedAt: Date }[] = [];
  for (const row of rows) {
    if (row.recordedAt < start) carried = row;
    else if (row.recordedAt <= now) inside.push(row);
  }
  const points: PricePoint[] = [
    ...(carried ? [{ priceCents: carried.priceCents, at: start.toISOString() }] : []),
    ...inside.map((r) => ({ priceCents: r.priceCents, at: r.recordedAt.toISOString() })),
  ];
  const changed = inside.length > 0 && new Set(points.map((p) => p.priceCents)).size > 1;
  return { changed, points: changed ? points : [] };
}

export async function getPriceHistory(productId: string, now = new Date()): Promise<PriceHistory> {
  const rows = await db
    .select({ priceCents: productPriceHistory.priceCents, recordedAt: productPriceHistory.recordedAt })
    .from(productPriceHistory)
    .where(eq(productPriceHistory.productId, productId))
    .orderBy(asc(productPriceHistory.recordedAt), asc(productPriceHistory.id));
  return windowPriceHistory(rows, now);
}
