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
import { payoutMayRelease, payoutReleasableSql } from "../delivery/payoutGate";
import { applyThreadCashSellerTopup } from "../threadCash/checkoutTopup";
import { notifySellerPayoutTransferred } from "../sellerMoneyNotifications";
import { isDefinitiveStripeRejection, stripeErrorCode } from "./stripeMoney";
import {
  expiredReservationCheckouts, releaseStockReservation,
} from "./stockReservation";

type StripeTransfers = Pick<Stripe, "transfers">;

export type TransferSettlement = "transferred" | "already" | "not_transfer_order" | "not_ready" | "failed";

export async function settleTransferOrder(
  orderId: string,
  options: { stripe?: StripeTransfers | null; now?: Date } = {},
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
    deliverBy: orders.deliverBy,
    deliveredAt: orders.deliveredAt,
    payoutReleaseAt: orders.payoutReleaseAt,
    disputePausedAt: orders.disputePausedAt,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order || order.chargeModel !== "transfer") return "not_transfer_order";
  if (order.stripeTransferId || order.fundsState === "released") return "already";
  // Refunded / cancelled before the transfer: nothing is owed to the seller.
  if (order.fundsState !== "held" || order.status === "refund_pending" || order.status === "cancelled") return "not_ready";
  if (!stripeClient) return "not_ready";
  // Hold-until-delivered (lib/delivery/payoutGate.ts): the seller is paid
  // only after delivery + the buffer, with no dispute or return open.
  if (!(await payoutMayRelease(db, { ...order, id: orderId }, options.now ?? new Date()))) return "not_ready";

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
  if (settled && amount > 0) {
    const [paid] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, orderId)).limit(1);
    await notifySellerPayoutTransferred({
      sellerId: order.ownerId, orderId, orderNumber: paid?.orderNumber ?? "", amountCents: amount,
    });
  }
  if (settled) {
    // Thread Cash the buyer spent is platform-funded: pay the seller that
    // part now, with the rest of the order (idempotent; no-op without it).
    await applyThreadCashSellerTopup(stripeClient, orderId).catch((err) =>
      logger.error({ err, orderId }, "Thread Cash top-up after order transfer failed"));
  }
  return settled ? "transferred" : "already";
}

/** Retries transfers that didn't go through (Stripe down, seller account not ready). */
export async function sweepTransferOrders(options: { stripe?: StripeTransfers | null; limit?: number; now?: Date } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const due = ((await db.execute(sql`
    SELECT o.id FROM orders o
    WHERE o.charge_model = 'transfer' AND o.funds_state = 'held' AND o.stripe_transfer_id IS NULL
      AND o.status NOT IN ('refund_pending', 'cancelled')
      AND ${payoutReleasableSql(now)}
    ORDER BY o.created_at LIMIT ${options.limit ?? 100}
  `)) as unknown as { rows?: Array<{ id: string }> }).rows ?? [];
  let count = 0;
  for (const row of due) {
    if (await settleTransferOrder(row.id, { stripe: options.stripe, now }) === "transferred") count++;
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
