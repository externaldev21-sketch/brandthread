/**
 * Thread Cash is platform-funded: when a buyer pays partly with it, the
 * seller must still receive their normal payout for the FULL item price,
 * exactly as if the buyer had paid entirely by card. `routes/buyer.ts`
 * already keeps the platform fee / processing-fee basis computed on the
 * full (pre-Thread-Cash) price — see `stripeChargeDiscountCents` there — so
 * `recordOrderPaid` (lib/money/escrow.ts) settles the seller's share of the
 * buyer's ACTUAL (discounted) Stripe charge correctly. What is missing is
 * the gap between that reduced charge and the full price: this module tops
 * the seller up for exactly that gap with a supplemental Stripe Transfer,
 * for destination-charge (in-stock) orders only, funded from Brandthread's
 * own balance and recorded as a platform expense in the ledger.
 *
 * Idempotent and safe to call on every webhook delivery for an order,
 * including retries of an already-processed one: it does nothing once
 * `orders.stripe_thread_cash_transfer_id` is set.
 */
import type Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db, orders, users } from "@workspace/db";
import { logger } from "../logger";
import { postLedgerTransaction } from "../money/ledger";

type StripeLike = Pick<Stripe, "transfers">;

export async function applyThreadCashSellerTopup(
  stripeClient: StripeLike | null,
  orderId: string,
): Promise<void> {
  const [order] = await db.select({
    id: orders.id,
    ownerId: orders.ownerId,
    chargeModel: orders.chargeModel,
    threadCashAppliedCents: orders.threadCashAppliedCents,
    stripeThreadCashTransferId: orders.stripeThreadCashTransferId,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) return;
  if (order.chargeModel !== "destination") return;
  if (!order.threadCashAppliedCents || order.threadCashAppliedCents < 1) return;
  if (order.stripeThreadCashTransferId) return; // already topped up
  if (!stripeClient) {
    logger.error({ orderId }, "Thread Cash seller top-up could not run: Stripe not configured");
    return;
  }

  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId })
    .from(users).where(eq(users.clerkId, order.ownerId)).limit(1);
  if (!seller?.stripeAccountId) {
    logger.error({ orderId }, "Thread Cash seller top-up could not run: seller has no Stripe account");
    return;
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount: order.threadCashAppliedCents,
      currency: "usd",
      destination: seller.stripeAccountId,
      metadata: { orderId, kind: "thread_cash_seller_topup" },
    }, { idempotencyKey: `thread-cash-topup/${orderId}` });
  } catch (err) {
    logger.error({ err, orderId }, "Thread Cash seller top-up transfer failed; will retry on next webhook delivery");
    return;
  }

  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(orders)
      .set({ stripeThreadCashTransferId: transfer.id, updatedAt: new Date() })
      .where(sql`${orders.id} = ${orderId} AND ${orders.stripeThreadCashTransferId} IS NULL`)
      .returning({ id: orders.id });
    if (!claimed) return; // another delivery already recorded it

    await postLedgerTransaction(tx, {
      idempotencyKey: `thread-cash-redeemed/${orderId}`,
      kind: "thread_cash_seller_topup",
      sellerId: order.ownerId,
      orderId,
      stripeObjectId: transfer.id,
      memo: "Platform-funded top-up so the seller receives the full item price",
      postings: [
        { account: "thread_cash_seller_topup", amountCents: -order.threadCashAppliedCents },
        { account: "seller_paid_out", partyId: order.ownerId, amountCents: order.threadCashAppliedCents },
      ],
    });
  });
}
