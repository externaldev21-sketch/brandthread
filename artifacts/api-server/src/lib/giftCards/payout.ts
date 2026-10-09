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
 * Rules (owner's defaults):
 *  - Only cards a buyer PAID for (source 'purchase') are paid out. A card the
 *    store issued itself was never paid for: redeeming it is a discount the
 *    seller funds, so the seller simply receives less for that order and no
 *    platform money moves.
 *  - Stripe's processing fee on the gift card purchase is the seller's cost,
 *    like on any sale: the redeemed part's share of it is kept back from this
 *    payout. Brandthread never bears it.
 *  - The payout waits for the same delivery hold as the order's own money
 *    (lib/delivery/payoutGate.ts payoutMayRelease); the sweep pays it later.
 *  - The 5% commission on a gift-card-funded order is on the full order value
 *    and is taken from the card part of the charge at checkout (checkout.ts
 *    feeFloorCents), not here.
 *
 * Idempotent: one transfer per order (Stripe idempotency key + a ledger
 * transaction keyed `gift-card-payout/<orderId>`), so a webhook redelivery or
 * the sweep can run it any number of times.
 */
import type Stripe from "stripe";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, giftCards, ledgerPostings, ledgerTransactions, orders, users } from "@workspace/db";
import { logger } from "../logger";
import { estimateProcessingFeeCents } from "../money/fees";
import { postLedgerTransaction, type DbExecutor } from "../money/ledger";
import { payoutMayRelease, payoutReleasableSql } from "../delivery/payoutGate";
import { refundForOrder, settledRedemptions } from "./service";

type StripeTransfers = Pick<Stripe, "transfers">;

const payoutKey = (orderId: string) => `gift-card-payout/${orderId}`;

/**
 * The redeemed part's share of Stripe's processing fee on the card's
 * purchase: the standard estimate on the card's face value, in proportion to
 * what this order redeemed, rounded half-up and never more than the redemption.
 */
export function purchaseFeeShareCents(input: { redeemedCents: number; cardInitialCents: number }): number {
  const { redeemedCents, cardInitialCents } = input;
  if (redeemedCents <= 0 || cardInitialCents <= 0) return 0;
  const fee = estimateProcessingFeeCents(cardInitialCents);
  // fee × redeemed / initial, half-up, in exact integer arithmetic.
  const share = Number((BigInt(fee) * BigInt(redeemedCents) * 2n + BigInt(cardInitialCents)) / (2n * BigInt(cardInitialCents)));
  return Math.min(share, redeemedCents);
}

export type GiftCardPayoutPart = { cardId: string; amountCents: number; feeCents: number };

/** Settled redemptions on the order of cards a buyer paid for (seller-issued cards excluded). */
export async function purchasedRedemptions(exec: DbExecutor, orderId: string): Promise<GiftCardPayoutPart[]> {
  const settled = await settledRedemptions(exec, orderId);
  if (settled.length === 0) return [];
  const cards = await exec.select({ id: giftCards.id, source: giftCards.source, initialCents: giftCards.initialCents })
    .from(giftCards).where(inArray(giftCards.id, settled.map((r) => r.cardId)));
  const byId = new Map(cards.map((c) => [c.id, c]));
  return settled.flatMap((r) => {
    const card = byId.get(r.cardId);
    if (!card || card.source !== "purchase") return [];
    return [{
      cardId: r.cardId,
      amountCents: r.amountCents,
      feeCents: purchaseFeeShareCents({ redeemedCents: r.amountCents, cardInitialCents: card.initialCents }),
    }];
  });
}

export type GiftCardPayoutResult = "paid" | "already" | "none" | "not_ready" | "failed";

export async function payoutSellerForOrder(
  stripeClient: StripeTransfers | null,
  orderId: string,
  now: Date = new Date(),
): Promise<GiftCardPayoutResult> {
  const [order] = await db.select({
    id: orders.id,
    ownerId: orders.ownerId,
    status: orders.status,
    fundsState: orders.fundsState,
    deliverBy: orders.deliverBy,
    deliveredAt: orders.deliveredAt,
    payoutReleaseAt: orders.payoutReleaseAt,
    disputePausedAt: orders.disputePausedAt,
  }).from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return "none";
  const parts = await purchasedRedemptions(db, orderId);
  const amount = parts.reduce((sum, p) => sum + p.amountCents, 0);
  if (amount <= 0) return "none";
  const fee = Math.min(amount, parts.reduce((sum, p) => sum + p.feeCents, 0));
  const net = amount - fee;
  const [done] = await db.select({ id: ledgerTransactions.id }).from(ledgerTransactions)
    .where(eq(ledgerTransactions.idempotencyKey, payoutKey(orderId))).limit(1);
  if (done) return "already";
  // Cancelled / refunded orders give the card back instead (refunds.ts).
  if (order.status === "cancelled" || order.status === "refund_pending" || order.fundsState === "refunded") return "not_ready";
  // Hold-until-delivered: the gift card part leaves with the rest of the order's money.
  if (!(await payoutMayRelease(db, order, now))) return "not_ready";
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
  let transfer: Stripe.Transfer | null = null;
  if (net > 0) {
    try {
      transfer = await stripeClient.transfers.create({
        amount: net,
        currency: "usd",
        destination: seller.stripeAccountId,
        transfer_group: orderId,
        description: "Brandthread gift card redeemed at your store",
        metadata: { kind: "gift_card_seller_payout", orderId, sellerId: order.ownerId, processingFeeCents: String(fee) },
      }, { idempotencyKey: payoutKey(orderId) });
    } catch (err) {
      logger.error({ err, orderId }, "Gift card seller payout transfer failed; the sweep retries it");
      return "failed";
    }
  }
  await postLedgerTransaction(db, {
    idempotencyKey: payoutKey(orderId),
    kind: "gift_card_seller_payout",
    sellerId: order.ownerId,
    orderId,
    stripeObjectId: transfer?.id ?? null,
    memo: "Gift card redeemed: seller paid the gift card part of the order from held gift card funds, less the card purchase's processing fee",
    postings: [
      { account: "gift_card_liability", partyId: order.ownerId, amountCents: -amount },
      { account: "seller_paid_out", partyId: order.ownerId, amountCents: net },
      { account: "stripe_processing_fees", amountCents: fee },
    ],
  });
  return "paid";
}

/** Pays settled purchased-card redemptions whose order is released, or whose transfer didn't go through. */
export async function sweepGiftCardPayouts(stripeClient: StripeTransfers | null, limit = 50, now: Date = new Date()): Promise<number> {
  const due = ((await db.execute(sql`
    SELECT DISTINCT t.order_id FROM gift_card_transactions t
    JOIN gift_cards c ON c.id = t.gift_card_id AND c.source = 'purchase'
    JOIN orders o ON o.id = t.order_id
    WHERE t.type = 'settle' AND t.order_id IS NOT NULL
      AND o.status NOT IN ('cancelled', 'refund_pending')
      AND ${payoutReleasableSql(now)}
      AND NOT EXISTS (SELECT 1 FROM ledger_transactions l WHERE l.idempotency_key = 'gift-card-payout/' || t.order_id::text)
      AND NOT EXISTS (SELECT 1 FROM gift_card_transactions r WHERE r.type = 'refund' AND r.order_id = t.order_id)
    LIMIT ${limit}
  `)) as unknown as { rows?: Array<{ order_id: string }> }).rows ?? [];
  let paid = 0;
  for (const row of due) {
    if (await payoutSellerForOrder(stripeClient, row.order_id, now) === "paid") paid++;
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
  const [payout] = await tx.select({ id: ledgerTransactions.id, stripeObjectId: ledgerTransactions.stripeObjectId })
    .from(ledgerTransactions)
    .where(and(eq(ledgerTransactions.idempotencyKey, payoutKey(input.orderId)))).limit(1);
  if (!payout) return; // never paid to the seller: nothing to claw back
  // Undo exactly what the payout posted: what reached the seller, and the
  // purchase fee kept back (it is kept back again when the card is reused).
  const postings = await tx.select({ account: ledgerPostings.account, amountCents: ledgerPostings.amountCents })
    .from(ledgerPostings).where(eq(ledgerPostings.transactionId, payout.id));
  const paidOut = postings.filter((p) => p.account === "seller_paid_out").reduce((s, p) => s + p.amountCents, 0);
  const fee = postings.filter((p) => p.account === "stripe_processing_fees").reduce((s, p) => s + p.amountCents, 0);
  try {
    if (paidOut > 0 && payout.stripeObjectId) {
      await stripeClient.transfers.createReversal(payout.stripeObjectId, {
        amount: paidOut,
        metadata: { brandthreadRefundId: input.refundId, orderId: input.orderId },
      }, { idempotencyKey: `order-refund-giftcard-payout/${input.refundId}` });
    }
    await postLedgerTransaction(tx, {
      idempotencyKey: `gift-card-payout-reversal/${input.orderId}`,
      kind: "gift_card_seller_payout_reversed",
      sellerId: input.sellerId,
      orderId: input.orderId,
      stripeObjectId: payout.stripeObjectId,
      memo: "Reversed the gift card payout on a fully refunded order",
      postings: [
        { account: "seller_paid_out", partyId: input.sellerId, amountCents: -paidOut },
        { account: "stripe_processing_fees", amountCents: -fee },
        { account: "gift_card_liability", partyId: input.sellerId, amountCents: paidOut + fee },
      ],
    });
  } catch (err) {
    logger.error({ err, orderId: input.orderId, refundId: input.refundId }, "Gift card payout reversal failed; needs review");
  }
}
