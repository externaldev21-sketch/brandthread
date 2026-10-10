/**
 * BT-066: the platform-funded top-up that pays the seller for the loyalty
 * points a buyer redeemed on their order (see loyaltyFunding.ts).
 *
 * Mirrors lib/threadCash/checkoutTopup.ts: a separate Stripe transfer from
 * Brandthread's balance to the seller (no source_transaction — the buyer's
 * charge never contained this money), idempotency-keyed per order, recorded
 * as `loyalty_seller_topup` (platform expense) → `seller_paid_out`.
 *
 * Timing (loyaltyTopupDue): destination charges right after the order; held
 * and transfer orders once the order's own payout has gone out, so the top-up
 * honours the same delivery hold and is never paid on a refunded order.
 * It is not added to seller_held: the per-order release transfer uses the
 * buyer's charge as source_transaction and can never exceed it.
 */
import type Stripe from "stripe";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";
import { logger } from "../logger";
import { stripe as defaultStripe } from "../stripe";
import { postLedgerTransaction } from "./ledger";
import { loyaltyTopupDue } from "./loyaltyFunding";

type StripeTransfers = Pick<Stripe, "transfers">;

export async function applyLoyaltySellerTopup(stripeClient: StripeTransfers | null, orderId: string): Promise<"topped_up" | "not_due" | "failed"> {
  const [order] = await db.select({
    id: orders.id,
    ownerId: orders.ownerId,
    status: orders.status,
    chargeModel: orders.chargeModel,
    fundsState: orders.fundsState,
    loyaltyAppliedCents: orders.loyaltyAppliedCents,
    stripeLoyaltyTransferId: orders.stripeLoyaltyTransferId,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || !loyaltyTopupDue(order)) return "not_due";
  if (!stripeClient) {
    logger.error({ orderId }, "Loyalty seller top-up could not run: Stripe not configured");
    return "failed";
  }
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId })
    .from(users).where(eq(users.clerkId, order.ownerId)).limit(1);
  if (!seller?.stripeAccountId) {
    logger.error({ orderId }, "Loyalty seller top-up could not run: seller has no Stripe account");
    return "failed";
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount: order.loyaltyAppliedCents,
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: orderId,
      description: "Brandthread rewards redeemed on this order",
      metadata: { orderId, kind: "loyalty_seller_topup" },
    }, { idempotencyKey: `loyalty-topup/${orderId}` });
  } catch (err) {
    logger.error({ err, orderId }, "Loyalty seller top-up transfer failed; the money sweep retries it");
    return "failed";
  }

  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(orders)
      .set({ stripeLoyaltyTransferId: transfer.id, updatedAt: new Date() })
      .where(sql`${orders.id} = ${orderId} AND ${orders.stripeLoyaltyTransferId} IS NULL`)
      .returning({ id: orders.id });
    if (!claimed) return;
    await postLedgerTransaction(tx, {
      idempotencyKey: `loyalty-topup/${orderId}`,
      kind: "loyalty_seller_topup",
      sellerId: order.ownerId,
      orderId,
      stripeObjectId: transfer.id,
      memo: "Brandthread-funded rewards: the seller is paid the full price for redeemed points",
      postings: [
        { account: "loyalty_seller_topup", amountCents: -order.loyaltyAppliedCents },
        // orderId null: refunds/recoveries compute what the ORDER's own transfer
        // can return from the order's seller_paid_out; this is a separate transfer.
        { account: "seller_paid_out", partyId: order.ownerId, orderId: null, amountCents: order.loyaltyAppliedCents },
      ],
    });
  });
  return "topped_up";
}

/** Money sweep: tops up every order whose payout went out since the last run. */
export async function sweepLoyaltySellerTopups(options: { stripe?: StripeTransfers | null; limit?: number } = {}): Promise<number> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const due = await db.select({ id: orders.id }).from(orders).where(and(
    gt(orders.loyaltyAppliedCents, 0),
    isNull(orders.stripeLoyaltyTransferId),
    inArray(orders.fundsState, ["settled_direct", "released"]),
  )).limit(options.limit ?? 100);
  let done = 0;
  for (const { id } of due) {
    if ((await applyLoyaltySellerTopup(stripeClient, id)) === "topped_up") done++;
  }
  return done;
}
