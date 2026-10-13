/**
 * Low-stock level resolution — one rule for the whole app:
 *
 *   variant's own level → product default → store default → 5
 *
 * `product_variants.low_stock_threshold` always holds the EFFECTIVE level, so
 * every list, filter, dashboard count and alert keeps reading one column.
 * `low_stock_threshold_inherit` says whether that value was set on the variant
 * (false) or follows the defaults (true). New variants inherit unless their
 * writer passes a level; a BEFORE INSERT trigger (migration 273) resolves it.
 * When a product or store default changes, `syncInheritedLowStock` recomputes
 * the inheriting variants. Changing a level never raises an alert by itself —
 * alerts fire on stock changes that cross into low / out (stockNotifications).
 */
import { and, eq, sql } from "drizzle-orm";
import { db, products, productVariants, sellerInventorySettings } from "@workspace/db";

/** Platform fallback when neither the product nor the store sets a level. */
export const PLATFORM_LOW_STOCK_THRESHOLD = 5;
export const MAX_LOW_STOCK_THRESHOLD = 1_000_000;

export function resolveLowStockThreshold(input: {
  variant?: number | null;
  product?: number | null;
  store?: number | null;
}): number {
  for (const value of [input.variant, input.product, input.store]) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  }
  return PLATFORM_LOW_STOCK_THRESHOLD;
}

/** Validates a seller-entered level. Returns null when it isn't a whole number in range. */
export function parseLowStockThreshold(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value > MAX_LOW_STOCK_THRESHOLD) return null;
  return value;
}

/** The store's own default, or null when the seller never set one. */
export async function getStoreLowStockThreshold(sellerId: string): Promise<number | null> {
  const [row] = await db
    .select({ value: sellerInventorySettings.lowStockThresholdDefault })
    .from(sellerInventorySettings)
    .where(eq(sellerInventorySettings.sellerId, sellerId))
    .limit(1);
  return row?.value ?? null;
}

/**
 * Recomputes every inheriting variant of a seller (or of one product) from the
 * current product + store defaults. Returns how many rows changed.
 */
export async function syncInheritedLowStock(input: { ownerId: string; productId?: string }): Promise<number> {
  const result = await db.execute(sql`
    UPDATE product_variants pv
       SET low_stock_threshold = COALESCE(r.low_stock_threshold_default, s.low_stock_threshold_default, ${PLATFORM_LOW_STOCK_THRESHOLD}),
           updated_at = NOW()
      FROM products p
      LEFT JOIN product_stock_rules r ON r.product_id = p.id
      LEFT JOIN seller_inventory_settings s ON s.seller_id = p.owner_id
     WHERE pv.product_id = p.id
       AND p.owner_id = ${input.ownerId}
       ${input.productId ? sql`AND p.id = ${input.productId}` : sql``}
       AND pv.low_stock_threshold_inherit = TRUE
       AND pv.low_stock_threshold IS DISTINCT FROM COALESCE(r.low_stock_threshold_default, s.low_stock_threshold_default, ${PLATFORM_LOW_STOCK_THRESHOLD})
  `);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}

/** Makes every variant of a seller (or of one product) follow the defaults again. */
export async function resetVariantsToInherit(input: { ownerId: string; productId?: string }): Promise<void> {
  const owned = db.select({ id: products.id }).from(products).where(
    input.productId
      ? and(eq(products.ownerId, input.ownerId), eq(products.id, input.productId))
      : eq(products.ownerId, input.ownerId),
  );
  await db.update(productVariants)
    .set({ lowStockThresholdInherit: true })
    .where(sql`${productVariants.productId} IN (${owned}) AND ${productVariants.lowStockThresholdInherit} = FALSE`);
  await syncInheritedLowStock(input);
}
