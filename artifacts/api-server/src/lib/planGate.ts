/**
 * Checkout-side backstop for the plan's product cap. Only the seller's first
 * N live listings (oldest first) can be bought, where N is the plan's cap
 * (0 with no live trial or plan). lib/planProductSync.ts normally moves any
 * extra listings to drafts after a downgrade; this check covers the window
 * before that runs, so a lapsed or downgraded seller can never sell more
 * listings than the plan includes.
 *
 * Publishing is limited separately by lib/productCapacity.ts.
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
