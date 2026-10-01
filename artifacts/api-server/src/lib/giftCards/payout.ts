/**
 * Seller liability for gift cards.
 *
 * At PURCHASE nothing moves to the seller: Brandthread keeps the buyer's
 * payment and records it as `gift_card_liability` (service.ts activateCard).
 * When a card is REDEEMED on a store's order, the buyer's card is charged only
 * for the rest of the order, so the seller's payout for that order is short by
 * the gift card amount. This module pays that amount to the seller with a
 * supplemental Stripe Transfer funded from Brandthread's own balance (the
 * gift card purchase money) and moves it from liability to seller_paid_out in
 * the ledger — same shape as lib/threadCash/checkoutTopup.ts.
 *
 * Idempotent: one transfer per order (Stripe idempotency key + a ledger
 * transaction keyed `gift-card-payout/<orderId>`), so a webhook redelivery or
 * the sweep can run it any number of times.
 */
import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db, ledgerTransactions, orders, users } from "@workspace/db";
import { logger } from "../logger";
import { postLedgerTransaction, type DbExecutor } from "../money/ledger";
import { refundForOrder, settledRedemptions } from "./service";

type StripeTransfers = Pick<Stripe, "transfers">;

const payoutKey = (orderId: string) => `gift-card-payout/${orderId}`;

export async function payoutSellerForOrder(stripeClient: StripeTransfers | null, orderId: string): Promise<"paid" | "already" | "none" | "failed"> {
  const [order] = await db.select({ id: orders.id, ownerId: orders.ownerId, status: orders.status })
    .from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return "none";
  const amount = (await settledRedemptions(db, orderId)).reduce((sum, r) => sum + r.amountCents, 0);
  if (amount <= 0) return "none";
  const [done] = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions)
    .where(eq(ledgerTransactions.idempotencyKey, payoutKey(orderId))).limit(1);
  if (done) return "already";
  if (!stripeClient) {
    logger.error({ orderId }, "Gift card seller payout could not run: Stripe not configured");
    return "failed";
  }
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId }).from(users)
    .where(eq(users.clerkId, order.ownerId)).limit(1);
  if (!seller?.stripeAccountId) {
    logger.error({ orderId }, "Gift card seller payout could not run: seller has no Stripe account");
    return "failed";
  }
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount,
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: orderId,
      description: "Brandthread gift card redeemed at your store",
      metadata: { kind: "gift_card_seller_payout", orderId, sellerId: order.ownerId },
    }, { idempotencyKey: payoutKey(orderId) });
  } catch (err) {
    logger.error({ err, orderId }, "Gift card seller payout transfer failed; the sweep retries it");
    return "failed";
  }
  await postLedgerTransaction(db, {
    idempotencyKey: payoutKey(orderId),
    kind: "gift_card_seller_payout",
    sellerId: order.ownerId,
    orderId,
    stripeObjectId: transfer.id,
    memo: "Gift card redeemed: seller paid the gift card part of the order from held gift card funds",
    postings: [
      { account: "gift_card_liability", partyId: order.ownerId, amountCents: -amount },
      { account: "seller_paid_out", partyId: order.ownerId, amountCents: amount },
    ],
  });
  return "paid";
}

/** Retries payouts for settled redemptions whose transfer didn't go through. */
export async function sweepGiftCardPayouts(stripeClient: StripeTransfers | null, limit = 50): Promise<number> {
  const due = ((await db.execute(sql`
    SELECT DISTINCT t.order_id FROM gift_card_transactions t
    WHERE t.type = 'settle' AND t.order_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.idempotency_key = 'gift-card-payout/' || t.order_id::text)
      AND NOT EXISTS (SELECT 1 FROM gift_card_transactions r WHERE r.type = 'refund' AND r.order_id = t.order_id)
    LIMIT ${limit}
  `)) as unknown as { rows?: Array<{ order_id: string }> }).rows ?? [];
  let paid = 0;
  for (const row of due) {
    if (await payoutSellerForOrder(stripeClient, row.order_id) === "paid") paid++;
  }
  return paid;
}

/**
 * Full refund of an order that used gift cards: the gift card balance comes
 * back, and if the seller was already paid the gift card part it is reversed
 * (their card-paid share is clawed back by the normal refund path). Called
 * inside refundOrder's success transaction, like the Thread Cash hook.
 */
export async function restoreGiftCardsOnFullRefund(
  tx: DbExecutor,
  stripeClient: StripeTransfers,
  input: { orderId: string; sellerId: string; refundId: string },
): Promise<void> {
  const restored = await refundForOrder(tx, input.orderId);
  if (restored.length === 0) return;
  const total = restored.reduce((sum, r) => sum + r.amountCents, 0);
  const [payout] = await tx.select({ stripeObjectId: ledgerTransactions.stripeObjectId }).from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.idempotencyKey, payoutKey(input.orderId)))).limit(1);
  if (!payout?.stripeObjectId) return; // never paid to the seller: nothing to claw back
  try {
    await stripeClient.transfers.createReversal(payout.stripeObjectId, {
      amount: total,
      metadata: { brandthreadRefundId: input.refundId, orderId: input.orderId },
    }, { idempotencyKey: `order-refund-giftcard-payout/${input.refundId}` });
    await postLedgerTransaction(tx, {
      idempotencyKey: `gift-card-payout-reversal/${input.orderId}`,
      kind: "gift_card_seller_payout_reversed",
      sellerId: input.sellerId,
      orderId: input.orderId,
      stripeObjectId: payout.stripeObjectId,
      memo: "Reversed the gift card payout on a fully refunded order",
      postings: [
        { account: "seller_paid_out", partyId: input.sellerId, amountCents: -total },
        { account: "gift_card_liability", partyId: input.sellerId, amountCents: total },
      ],
    });
  } catch (err) {
    logger.error({ err, orderId: input.orderId, refundId: input.refundId }, "Gift card payout reversal failed; needs review");
  }
}
