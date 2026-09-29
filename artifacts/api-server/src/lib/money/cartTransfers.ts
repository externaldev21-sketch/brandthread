/**
 * One-page checkout money (chargeModel "transfer"): separate charges and
 * transfers.
 *
 * The buyer pays ONE PaymentIntent for the whole cart, on Brandthread's
 * balance. The paid webhook creates one order per seller
 * (routes/webhooks.ts handleCartPaymentSucceeded, then handleCheckoutPaid).
 * recordOrderPaid books each seller's net as seller_held for that order.
 * Then settleTransferOrder sends that net to the seller's connected account
 * as a Stripe Transfer:
 *  - source_transaction: the cart's charge, so the transfer waits for those
 *    funds and can never exceed them;
 *  - transfer_group: the order id;
 *  - idempotency key: order-transfer/<orderId>. A retry, whether a webhook
 *    redelivery or the money sweep, returns the same transfer instead of
 *    paying twice.
 * The money then moves seller_held → seller_paid_out in the ledger.
 *
 * After that the order behaves like a destination order: labels are
 * recovered from this transfer (escrow.ts recoverLabelCost). Refunds reverse
 * this transfer for the seller's share (refunds.ts).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, orders, users } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { orderHeldCents, postLedgerTransaction } from "./ledger";
import { orderFundsMachine } from "./stateMachines";
import { isDefinitiveStripeRejection, stripeErrorCode } from "./stripeMoney";
import {
  expiredReservationCheckouts, releaseStockReservation,
} from "./stockReservation";

type StripeTransfers = Pick<Stripe, "transfers">;

export type TransferSettlement = "transferred" | "already" | "not_transfer_order" | "not_ready" | "failed";

export async function settleTransferOrder(
  orderId: string,
  options: { stripe?: StripeTransfers | null } = {},
): Promise<TransferSettlement> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const [order] = await db.select({
    id: orders.id,
    ownerId: orders.ownerId,
    status: orders.status,
    chargeModel: orders.chargeModel,
    fundsState: orders.fundsState,
    sellerNetCents: orders.sellerNetCents,
    stripeChargeId: orders.stripeChargeId,
    stripeTransferId: orders.stripeTransferId,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.chargeModel !== "transfer") return "not_transfer_order";
  if (order.stripeTransferId || order.fundsState === "released") return "already";
  // Refunded / cancelled before the transfer: nothing is owed to the seller.
  if (order.fundsState !== "held" || order.status === "refund_pending" || order.status === "cancelled") return "not_ready";
  if (!stripeClient) return "not_ready";

  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId })
    .from(users).where(eq(users.clerkId, order.ownerId)).limit(1);
  if (!seller?.stripeAccountId) {
    logger.error({ orderId }, "Cart transfer waiting: seller has no connected Stripe account");
    return "not_ready";
  }

  // What this order still holds for the seller: its net, minus anything a
  // partial refund already took from it before the transfer went out.
  const amount = Math.max(0, await orderHeldCents(db, orderId, order.ownerId));
  let transfer: Stripe.Transfer | null = null;
  if (amount > 0) {
    try {
      transfer = await stripeClient.transfers.create({
        amount,
        currency: "usd",
        destination: seller.stripeAccountId,
        transfer_group: orderId,
        ...(order.stripeChargeId ? { source_transaction: order.stripeChargeId } : {}),
        description: "Brandthread order payout",
        metadata: { kind: "cart_order_transfer", orderId, sellerId: order.ownerId },
      }, { idempotencyKey: `order-transfer/${orderId}` });
    } catch (error) {
      logger.error(
        { err: error, orderId, definitive: isDefinitiveStripeRejection(error), code: stripeErrorCode(error) },
        "Cart order transfer failed; the money sweep retries it",
      );
      return "failed";
    }
  }

  let settled = false;
  await db.transaction(async (tx) => {
    orderFundsMachine.assert("held", "release_pending");
    orderFundsMachine.assert("release_pending", "released");
    const [claimed] = await tx.update(orders).set({
      fundsState: "released",
      stripeTransferId: transfer?.id ?? null,
      updatedAt: new Date(),
    }).where(and(
      eq(orders.id, orderId),
      eq(orders.fundsState, "held"),
      isNull(orders.stripeTransferId),
    )).returning({ id: orders.id });
    if (!claimed) return;
    settled = true;
    if (amount > 0) {
      await postLedgerTransaction(tx, {
        idempotencyKey: `order-transfer/${orderId}`,
        kind: "order_transferred",
        sellerId: order.ownerId,
        orderId,
        stripeObjectId: transfer?.id ?? null,
        memo: "In-app checkout: seller's share transferred to their Stripe account",
        postings: [
          { account: "seller_held", partyId: order.ownerId, amountCents: -amount },
          { account: "seller_paid_out", partyId: order.ownerId, amountCents: amount },
        ],
      });
    }
  });
  return settled ? "transferred" : "already";
}

/** Retries transfers that didn't go through (Stripe down, seller account not ready). */
export async function sweepTransferOrders(options: { stripe?: StripeTransfers | null; limit?: number } = {}): Promise<number> {
  const due = ((await db.execute(sql`
    SELECT id FROM orders
    WHERE charge_model = 'transfer' AND funds_state = 'held' AND stripe_transfer_id IS NULL
      AND status NOT IN ('refund_pending', 'cancelled')
    ORDER BY created_at LIMIT ${options.limit ?? 100}
  `)) as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  let count = 0;
  for (const row of due) {
    if (await settleTransferOrder(row.id, { stripe: options.stripe }) === "transferred") count++;
  }
  return count;
}

type StripeIntents = Pick<Stripe, "paymentIntents">;

/**
 * Releases stock held by checkouts whose payment never finished. The
 * PaymentIntent is cancelled first, so it can't succeed after its units went
 * back. If Stripe says it already succeeded, the units stay: the paid
 * webhook commits them.
 */
export async function expireStockReservations(
  options: { stripe?: StripeIntents | null; now?: Date } = {},
): Promise<number> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const expired = await expiredReservationCheckouts(db, options.now ?? new Date());
  let released = 0;
  const cancelled = new Set<string>();
  for (const { checkoutSessionId, paymentIntentId } of expired) {
    if (paymentIntentId && stripeClient && !cancelled.has(paymentIntentId)) {
      try {
        const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);
        if (intent.status === "succeeded" || intent.status === "processing") continue;
        if (intent.status !== "canceled") {
          await stripeClient.paymentIntents.cancel(paymentIntentId, { cancellation_reason: "abandoned" });
        }
        cancelled.add(paymentIntentId);
      } catch (error) {
        logger.error({ err: error, paymentIntentId }, "Could not cancel an abandoned checkout; its stock stays reserved for now");
        continue;
      }
    }
    released += await db.transaction((tx) => releaseStockReservation(tx, checkoutSessionId));
  }
  return released;
}
