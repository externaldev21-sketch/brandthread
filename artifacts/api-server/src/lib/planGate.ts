/**
 * Selling within the seller's plan (BT-002). A seller without paid access
 * keeps a store, but only their first FREE_TIER_LIMITS.products live listings
 * (oldest first) can be bought; the rest wait until they start a plan. Paid
 * plans with a product cap behave the same way, so a lapsed or downgraded
 * seller can never sell more listings than the plan includes.
 *
 * Publishing is limited separately by the product capacity checks in
 * routes/products.ts (and bulk/import), which read the same limits.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, products } from "@workspace/db";
import { getVerifiedPlanAccess } from "./planAccess";
import { logger } from "./logger";

export const SELLER_PLAN_LIMIT_CODE = "SELLER_PLAN_LIMIT";
export const SELLER_PLAN_LIMIT_MESSAGE = "This item isn't available to buy right now.";

/** Product ids in `productIds` the seller's plan doesn't let them sell. Fails open on a lookup error. */
export async function productsBeyondSellerPlan(sellerId: string, productIds: readonly string[]): Promise<string[]> {
  if (productIds.length === 0) return [];
  try {
    const access = await getVerifiedPlanAccess(sellerId);
    const limit = access.limits.products;
    if (limit === null) return [];
    const sellable = await db.select({ id: products.id }).from(products)
      .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
      .orderBy(asc(products.createdAt), asc(products.id))
      .limit(limit);
    const allowed = new Set(sellable.map((row) => row.id));
    return [...new Set(productIds)].filter((id) => !allowed.has(id));
  } catch (err) {
    // A plan lookup outage must not take checkout down with it.
    logger.error({ err, sellerId }, "Plan gate lookup failed; allowing checkout");
    return [];
  }
}
