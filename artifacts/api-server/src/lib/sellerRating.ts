/**
 * Public seller reputation numbers: review rating rollup and sales count.
 * Shared by GET /api/reviews/seller/:id and the public storefront so both
 * surfaces show the same figures.
 */
import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db, orders, reviews } from "@workspace/db";

export async function sellerRatingSummary(sellerClerkId: string): Promise<{ avgRating: number; totalCount: number }> {
  const [agg] = await db
    .select({
      avgRating:  sql<number>`round(avg(rating)::numeric, 1)`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.sellerId, sellerClerkId));
  return { avgRating: Number(agg?.avgRating ?? 0), totalCount: Number(agg?.totalCount ?? 0) };
}

/** Paid, non-cancelled orders — the same definition as the seller analytics dashboard. */
export async function sellerSalesCount(sellerClerkId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.ownerId, sellerClerkId), isNotNull(orders.paidAt), ne(orders.status, "cancelled")));
  return Number(row?.n ?? 0);
}
