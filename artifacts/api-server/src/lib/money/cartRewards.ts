/**
 * Rewards on the in-app cart payment (routes/checkout-intent.ts): loyalty
 * points and Thread Cash, applied server-side to the cart's PaymentIntent the
 * same way routes/buyer.ts applies them to a hosted Checkout Session.
 *
 *  - Amounts. Loyalty is one store only (its token discounts one checkout,
 *    and the cart screen asks for one store, as on hosted Checkout). Thread
 *    Cash is split across every store in proportion to what each can take
 *    (allocateThreadCash), each store's card share staying at or above
 *    Stripe's 50¢ minimum. Both lower the taxable amount, like hosted
 *    Checkout's coupon. Loyalty lowers the fee basis (seller-funded); Thread
 *    Cash never does (Brandthread-funded, topped up per order by
 *    lib/threadCash/checkoutTopup.ts).
 *  - Settlement. Each store's checkout row carries its own token and amount
 *    (loyalty_token / thread_cash_token + *_discount_cents), so the order
 *    webhook (handleCheckoutPaid) consumes them exactly as it does for a
 *    hosted session, in the order's own transaction (a redelivery can never
 *    spend a token twice). A multi-store Thread Cash token is split into one
 *    child token per store first (lib/threadCash/wallet.ts).
 *  - Release. A payment that fails, is cancelled or never starts releases
 *    every token it holds, so the buyer can pay again (releaseCartRewards).
 */
import { and, eq } from "drizzle-orm";
import { db, loyaltyPoints, type checkoutSessions } from "@workspace/db";
import { releaseThreadCashRedemption } from "../threadCash/wallet";
import { LoyaltyRedemptionError, releaseLoyaltyRedemption } from "../../routes/loyalty";
import { logger } from "../logger";

export { planCartRewards, type CartRewardPlan } from "./cartMath";

/** A loyalty token's discount, read-only (for quotes). */
export async function peekLoyaltyRedemption(buyerId: string, token: string): Promise<number> {
  const normalized = String(token ?? "").trim().toUpperCase();
  const [row] = await db.select({ points: loyaltyPoints.points, usedAt: loyaltyPoints.usedAt })
    .from(loyaltyPoints)
    .where(and(eq(loyaltyPoints.buyerId, buyerId), eq(loyaltyPoints.source, "redemption"), eq(loyaltyPoints.referenceId, normalized)))
    .limit(1);
  if (!row || row.points >= 0) throw new LoyaltyRedemptionError("This rewards token is not valid for your account.");
  if (row.usedAt) throw new LoyaltyRedemptionError("This rewards token has already been used.", 409, "LOYALTY_TOKEN_USED");
  return -row.points;
}

type RewardRow = Pick<typeof checkoutSessions.$inferSelect, "id" | "buyerId" | "loyaltyToken" | "threadCashToken">;

/** Lets go of the loyalty / Thread Cash tokens these checkout rows hold (unspent ones only). */
export async function releaseCartRewards(rows: RewardRow[]): Promise<void> {
  for (const row of rows) {
    if (!row.buyerId) continue;
    try {
      if (row.loyaltyToken) {
        await db.transaction((tx) => releaseLoyaltyRedemption(tx, row.buyerId!, row.loyaltyToken!, row.id));
      }
      if (row.threadCashToken) {
        await releaseThreadCashRedemption(db, row.buyerId, row.threadCashToken, row.id);
      }
    } catch (error) {
      logger.error({ err: error, checkoutSessionId: row.id }, "Could not release a cart's reward tokens");
    }
  }
}
