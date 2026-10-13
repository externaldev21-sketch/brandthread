import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { classifySalesFlags, SALES_FLAG_WINDOW_DAYS, type SalesFlag } from "./productSalesFlags";

/**
 * Loads the seller's live products with 30-day units sold and classifies them.
 * Units count order items on the seller's paid, non-cancelled orders whose
 * payment landed in the window (refunds do not un-sell a unit here, matching
 * the analytics top-products query).
 */
export async function salesFlagsForSeller(ownerId: string, now: Date = new Date()): Promise<Record<string, SalesFlag>> {
  const since = new Date(now.getTime() - SALES_FLAG_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql`
    SELECT
      p.id AS product_id,
      p.status,
      p.created_at,
      COALESCE((SELECT SUM(pv.stock) FROM product_variants pv WHERE pv.product_id = p.id), 0)::int AS total_stock,
      COALESCE((
        SELECT SUM(oi.quantity)
        FROM order_items oi
        JOIN product_variants pv ON pv.id = oi.variant_id
        JOIN orders o ON o.id = oi.order_id
        WHERE pv.product_id = p.id
          AND o.owner_id = ${ownerId}
          AND o.paid_at IS NOT NULL
          AND o.paid_at >= ${since.toISOString()}
          AND o.status <> 'cancelled'
      ), 0)::int AS units_sold
    FROM products p
    WHERE p.owner_id = ${ownerId}
      AND p.deleted_at IS NULL
      AND p.status = 'active'
  `);
  const rows = ((result as any).rows ?? result) as Array<{
    product_id: string; status: string; created_at: string | Date; total_stock: number; units_sold: number;
  }>;
  return classifySalesFlags(rows.map((r) => ({
    productId: r.product_id,
    status: r.status,
    createdAt: new Date(r.created_at),
    totalStock: Number(r.total_stock),
    unitsSold30d: Number(r.units_sold),
  })), now);
}
