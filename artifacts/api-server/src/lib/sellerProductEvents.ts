/**
 * Server-side add-to-cart tracking for seller analytics. Called from the buyer
 * cart sync path; it is strictly additive and swallows every failure so it can
 * never affect the cart request.
 */
import { db, sellerProductEvents } from "@workspace/db";
import { sql } from "drizzle-orm";
import { viewerKeyFor } from "./sellerInsights";
import { logger } from "./logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Variant ids that appear in `next` (active cart lines) but not in `previous`. */
export function newlyAddedVariantIds(previous: Iterable<string>, next: Iterable<string>): string[] {
  const before = new Set(previous);
  return [...new Set(next)].filter((id) => !before.has(id) && UUID_RE.test(id));
}

export async function recordAddToCartEvents(userId: string, variantIds: string[]): Promise<number> {
  try {
    if (variantIds.length === 0) return 0;
    const ids = variantIds.slice(0, 100);
    const res = await db.execute(sql`
      SELECT pv.id AS variant_id, p.id AS product_id, p.owner_id AS seller_id
      FROM product_variants pv JOIN products p ON p.id = pv.product_id
      WHERE pv.id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`);
    const rows = ((res as unknown as { rows?: Array<{ product_id: string; seller_id: string }> }).rows ?? [])
      // A seller adding their own product to a cart is not audience activity.
      .filter((r) => r.seller_id && r.seller_id !== userId);
    if (rows.length === 0) return 0;
    await db.insert(sellerProductEvents).values(rows.map((r) => ({
      sellerId: r.seller_id,
      productId: r.product_id,
      eventType: "add_to_cart",
      viewerKey: viewerKeyFor(r.seller_id, userId),
    })));
    return rows.length;
  } catch (err) {
    logger.warn({ err }, "Add-to-cart analytics event failed (ignored)");
    return 0;
  }
}
