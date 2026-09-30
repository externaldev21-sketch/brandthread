/**
 * An open chargeback pauses the automatic refund: refunding the buyer while
 * their bank is also pulling the money back would pay them twice. The pause
 * lifts when the dispute closes in the seller's favour; a lost dispute
 * keeps it (the bank already returned the money, so there is nothing left
 * to refund).
 */
import { eq, sql } from "drizzle-orm";
import { db, disputes, orders } from "@workspace/db";
import { logger } from "../logger";
import { notifyBuyerDisputePaused } from "./notifications";

/** Stripe dispute statuses that mean "still open". */
const OPEN = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review"]);

export async function applyDisputePause(orderId: string | null, stripeStatus: string): Promise<void> {
  if (!orderId) return;
  if (OPEN.has(stripeStatus)) {
    const [paused] = await db.update(orders)
      .set({ disputePausedAt: new Date(), updatedAt: new Date() })
      .where(sql`${orders.id} = ${orderId}::uuid AND ${orders.disputePausedAt} IS NULL`)
      .returning({ id: orders.id, orderNumber: orders.orderNumber, buyerId: orders.buyerId, ownerId: orders.ownerId });
    if (paused) {
      logger.info({ orderId }, "Auto-refund paused: a chargeback is open on this order");
      await notifyBuyerDisputePaused(paused).catch(() => {});
    }
    return;
  }
  if (stripeStatus === "won" || stripeStatus === "warning_closed") {
    await db.update(orders).set({ disputePausedAt: null, updatedAt: new Date() }).where(eq(orders.id, orderId));
    logger.info({ orderId }, "Auto-refund resumed: the chargeback was won");
  }
}

/** Dispute updated/closed events only carry the dispute id; find its order. */
export async function applyDisputePauseByDisputeId(stripeDisputeId: string, stripeStatus: string): Promise<void> {
  const [row] = await db.select({ orderId: disputes.orderId }).from(disputes)
    .where(eq(disputes.stripeDisputeId, stripeDisputeId)).limit(1);
  await applyDisputePause(row?.orderId ?? null, stripeStatus);
}
