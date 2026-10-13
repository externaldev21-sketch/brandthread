/**
 * First-order platform discount: $5 off a signed-in buyer's FIRST paid order,
 * paid for by Brandthread. The seller still receives the full price.
 *
 * Where it plugs in (the in-app one-page checkout, chargeModel "transfer"):
 *  price    routes/checkout-intent.ts priceCart: the first seller group whose
 *           merchandise (after any seller promo) is at least $10 gets $5 off
 *           its total. Tax is still computed on the pre-discount price (a
 *           third-party-funded coupon). Shown in the server breakdown as part
 *           of the group's `discountCents` plus its own `firstOrderDiscountCents`.
 *  reserve  in the same transaction that writes the checkout rows. One row
 *           per buyer, ever (first_order_discounts.buyer_id is the primary
 *           key), taken with a conditional upsert, so a retry or a second
 *           checkout racing this one can never hold it twice.
 *  release  lib/money/stockReservation.ts releaseStockReservation: a cancel,
 *           a failed payment and the expiry sweep all free it again.
 *  apply    routes/webhooks.ts handleCartPaymentSucceeded, after the order is
 *           made: marks it applied and tops the seller up with a supplemental
 *           Stripe Transfer from Brandthread's balance (same shape as
 *           lib/threadCash/checkoutTopup.ts), posted to the ledger as
 *           first_order_discount → seller_paid_out.
 *  reverse  lib/money/refunds.ts, on a FULL refund / cancellation of that
 *           order: the top-up transfer is reversed and the buyer may use the
 *           discount again on a later first kept order.
 *
 * The discount is NOT part of the fee basis: the platform fee is fixed at
 * pricing on the full merchandise, and the webhook leaves it out of the
 * order's discount (like a gift card), so the seller's payout math is the
 * same as without it.
 *
 * Gated by the `firstOrderPlatformDiscount` feature flag (seeded OFF).
 * Hosted Stripe Checkout (guests, preorders, Thread Cash, loyalty, builds
 * without the Stripe module) does not apply it; the buyer stays eligible.
 */
import type Stripe from "stripe";
import { and, eq, sql } from "drizzle-orm";
import { db, firstOrderDiscounts, orders, users } from "@workspace/db";
import { logger } from "./logger";
import { postLedgerTransaction, type DbExecutor } from "./money/ledger";
import { isFeatureEnabled } from "./threadCash/wallet";

export const FIRST_ORDER_DISCOUNT_CENTS = 500;
/** Merchandise (after any seller promo) must be at least this for the discount to apply. */
export const FIRST_ORDER_MIN_MERCHANDISE_CENTS = 1000;
export const FIRST_ORDER_DISCOUNT_FLAG = "firstOrderPlatformDiscount";

type StripeTransfers = Pick<Stripe, "transfers">;

function rows<T>(result: unknown): T[] {
  return (result as { rows?: T[] }).rows ?? [];
}

const payoutKey = (orderId: string) => `first-order-discount/${orderId}`;
const reversalKey = (orderId: string) => `first-order-discount-reversed/${orderId}`;

// ─── Pure rule ───────────────────────────────────────────────────────────────

/** Cents of the first-order discount for a group with this merchandise, given it is still unused in the cart. */
export function firstOrderDiscountForGroup(merchandiseCents: number): number {
  return Number.isInteger(merchandiseCents) && merchandiseCents >= FIRST_ORDER_MIN_MERCHANDISE_CENTS
    ? FIRST_ORDER_DISCOUNT_CENTS
    : 0;
}

// ─── Eligibility + reservation ───────────────────────────────────────────────

/** SQL: the buyer already has a paid order they kept (not cancelled or fully refunded). */
const hasKeptPaidOrder = (buyerId: string) => sql`EXISTS (
  SELECT 1 FROM orders o
  WHERE o.buyer_id = ${buyerId}
    AND (o.paid_at IS NOT NULL OR o.stripe_checkout_session_id IS NOT NULL)
    AND o.status NOT IN ('cancelled', 'refund_pending')
    AND COALESCE(o.funds_state, '') <> 'refunded'
)`;

/**
 * True when this signed-in buyer may get the discount on the checkout being
 * priced: the flag is on, they have no kept paid order, and the discount is
 * not already applied or held by another unfinished checkout.
 */
export async function isFirstOrderDiscountEligible(buyerId: string | null | undefined, forReservation = false): Promise<boolean> {
  if (!buyerId) return false;
  if (!(await isFeatureEnabled(FIRST_ORDER_DISCOUNT_FLAG))) return false;
  const [row] = rows<{ blocked: boolean }>(await db.execute(sql`
    SELECT (
      EXISTS (SELECT 1 FROM first_order_discounts f WHERE f.buyer_id = ${buyerId}
        AND (f.status = 'applied' OR (${!forReservation} AND f.status = 'reserved')))
      OR ${hasKeptPaidOrder(buyerId)}
    ) AS blocked
  `));
  return row ? !row.blocked : false;
}

/**
 * Holds the discount for one checkout row. Returns false when another
 * checkout already holds it or it was already used (the caller must not
 * charge the discounted price then). Idempotent for the same checkout.
 */
export async function reserveFirstOrderDiscount(
  tx: DbExecutor,
  input: { buyerId: string; checkoutSessionId: string; amountCents: number },
): Promise<boolean> {
  const [{ blocked }] = rows<{ blocked: boolean }>(await tx.execute(sql`SELECT ${hasKeptPaidOrder(input.buyerId)} AS blocked`));
  if (blocked) return false;
  const reserved = rows<{ buyer_id: string }>(await tx.execute(sql`
    INSERT INTO first_order_discounts (buyer_id, status, amount_cents, checkout_session_id, reserved_at, updated_at)
    VALUES (${input.buyerId}, 'reserved', ${input.amountCents}, ${input.checkoutSessionId}::uuid, now(), now())
    ON CONFLICT (buyer_id) DO UPDATE SET
      status = 'reserved',
      amount_cents = EXCLUDED.amount_cents,
      checkout_session_id = EXCLUDED.checkout_session_id,
      order_id = NULL, seller_id = NULL, stripe_transfer_id = NULL,
      reserved_at = now(), applied_at = NULL, reversed_at = NULL, updated_at = now()
    WHERE first_order_discounts.status IN ('released', 'reversed')
       OR (first_order_discounts.status = 'reserved'
           AND first_order_discounts.checkout_session_id = EXCLUDED.checkout_session_id)
    RETURNING buyer_id
  `));
  return reserved.length > 0;
}

/** The checkout let go of its stock (cancelled, failed, expired): free the discount it held. */
export async function releaseFirstOrderDiscountForCheckout(tx: DbExecutor, checkoutSessionId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE first_order_discounts SET status = 'released', updated_at = now()
    WHERE checkout_session_id = ${checkoutSessionId}::uuid AND status = 'reserved'
  `);
}

// ─── Apply (paid webhook) ────────────────────────────────────────────────────

/**
 * The paid webhook created this group's order. Mark the discount applied and
 * top the seller up — or, if the order was already cancelled/refunded for
 * being oversold, give the buyer the discount back. Idempotent.
 */
export async function finalizeFirstOrderDiscountForGroup(
  stripeClient: StripeTransfers | null,
  group: { id: string; buyerId: string | null; sellerId: string; stripeSessionId: string | null; firstOrderDiscountCents?: number | null },
): Promise<void> {
  if (!group.stripeSessionId || !group.buyerId || !(group.firstOrderDiscountCents && group.firstOrderDiscountCents > 0)) return;
  const [order] = await db.select({ id: orders.id, status: orders.status, fundsState: orders.fundsState })
    .from(orders).where(eq(orders.stripeCheckoutSessionId, group.stripeSessionId)).limit(1);
  if (!order) {
    logger.error({ checkoutSessionId: group.id }, "First-order discount not applied: the order does not exist yet");
    return;
  }
  if (order.status === "cancelled" || order.status === "refund_pending" || order.fundsState === "refunded") {
    await releaseFirstOrderDiscountForCheckout(db, group.id);
    return;
  }
  await db.execute(sql`
    UPDATE first_order_discounts
    SET status = 'applied', order_id = ${order.id}::uuid, seller_id = ${group.sellerId}, applied_at = now(), updated_at = now()
    WHERE buyer_id = ${group.buyerId} AND checkout_session_id = ${group.id}::uuid AND status = 'reserved'
  `);
  await payoutFirstOrderDiscount(stripeClient, order.id);
}

/**
 * Pays the seller the discount amount from Brandthread's balance. One
 * transfer per order (Stripe idempotency key + ledger key), safe to repeat.
 */
export async function payoutFirstOrderDiscount(
  stripeClient: StripeTransfers | null,
  orderId: string,
): Promise<"paid" | "already" | "none" | "failed"> {
  const [claim] = await db.select().from(firstOrderDiscounts).where(eq(firstOrderDiscounts.orderId, orderId)).limit(1);
  if (!claim || claim.status !== "applied" || !claim.sellerId) return "none";
  if (claim.stripeTransferId) return "already";
  if (!stripeClient) {
    logger.error({ orderId }, "First-order discount top-up could not run: Stripe not configured");
    return "failed";
  }
  const [seller] = await db.select({ stripeAccountId: users.stripeAccountId })
    .from(users).where(eq(users.clerkId, claim.sellerId)).limit(1);
  if (!seller?.stripeAccountId) {
    logger.error({ orderId }, "First-order discount top-up could not run: seller has no Stripe account");
    return "failed";
  }
  let transfer: Stripe.Transfer;
  try {
    transfer = await stripeClient.transfers.create({
      amount: claim.amountCents,
      currency: "usd",
      destination: seller.stripeAccountId,
      transfer_group: orderId,
      description: "Brandthread first-order discount (paid by Brandthread)",
      metadata: { kind: "first_order_discount_topup", orderId, sellerId: claim.sellerId },
    }, { idempotencyKey: payoutKey(orderId) });
  } catch (err) {
    logger.error({ err, orderId }, "First-order discount top-up transfer failed; webhook redelivery retries it");
    return "failed";
  }
  let paid = false;
  await db.transaction(async (tx) => {
    const [claimed] = await tx.update(firstOrderDiscounts)
      .set({ stripeTransferId: transfer.id, updatedAt: new Date() })
      .where(and(
        eq(firstOrderDiscounts.orderId, orderId),
        eq(firstOrderDiscounts.status, "applied"),
        sql`${firstOrderDiscounts.stripeTransferId} IS NULL`,
      ))
      .returning({ buyerId: firstOrderDiscounts.buyerId });
    if (!claimed) return;
    paid = true;
    await postLedgerTransaction(tx, {
      idempotencyKey: payoutKey(orderId),
      kind: "first_order_discount_topup",
      sellerId: claim.sellerId,
      orderId,
      stripeObjectId: transfer.id,
      memo: "Brandthread-funded first-order discount: seller topped up to the full price",
      postings: [
        { account: "first_order_discount", amountCents: -claim.amountCents },
        { account: "seller_paid_out", partyId: claim.sellerId!, amountCents: claim.amountCents },
      ],
    });
  });
  if (paid) return "paid";
  // The order was refunded while the transfer was in flight: take it back.
  const [now] = await db.select({ status: firstOrderDiscounts.status }).from(firstOrderDiscounts)
    .where(eq(firstOrderDiscounts.orderId, orderId)).limit(1);
  if (now?.status === "reversed") {
    await stripeClient.transfers.createReversal(transfer.id, { amount: claim.amountCents }, { idempotencyKey: `${reversalKey(orderId)}/late` })
      .catch((err) => logger.error({ err, orderId }, "Late first-order discount top-up reversal failed; needs review"));
  }
  return "already";
}

// ─── Reverse (full refund / cancellation) ────────────────────────────────────

/**
 * A full refund or cancellation of the order the discount was applied to:
 * reverse the seller top-up and let the buyer use the discount again. Runs
 * inside the refund's success transaction; never throws for Stripe errors.
 */
export async function reverseFirstOrderDiscountOnFullRefund(
  tx: DbExecutor,
  stripeClient: Pick<Stripe, "transfers"> | null,
  input: { orderId: string; sellerId: string; refundId: string },
): Promise<void> {
  const [claim] = rows<{ buyer_id: string; amount_cents: number; stripe_transfer_id: string | null }>(await tx.execute(sql`
    SELECT buyer_id, amount_cents, stripe_transfer_id FROM first_order_discounts
    WHERE order_id = ${input.orderId}::uuid AND status = 'applied'
    FOR UPDATE
  `));
  if (!claim) return;
  if (claim.stripe_transfer_id) {
    if (!stripeClient) {
      logger.error({ orderId: input.orderId }, "First-order discount top-up reversal skipped: Stripe not configured; needs review");
      return;
    }
    try {
      await stripeClient.transfers.createReversal(claim.stripe_transfer_id, {
        amount: claim.amount_cents,
        metadata: { brandthreadRefundId: input.refundId, orderId: input.orderId },
      }, { idempotencyKey: reversalKey(input.orderId) });
    } catch (err) {
      logger.error({ err, orderId: input.orderId }, "First-order discount top-up reversal failed; needs review");
      return;
    }
    await postLedgerTransaction(tx, {
      idempotencyKey: reversalKey(input.orderId),
      kind: "first_order_discount_topup_reversed",
      sellerId: input.sellerId,
      orderId: input.orderId,
      stripeObjectId: claim.stripe_transfer_id,
      memo: "Reversed the Brandthread-funded first-order discount top-up on a fully refunded order",
      postings: [
        { account: "seller_paid_out", partyId: input.sellerId, amountCents: -claim.amount_cents },
        { account: "first_order_discount", amountCents: claim.amount_cents },
      ],
    });
  }
  await tx.execute(sql`
    UPDATE first_order_discounts SET status = 'reversed', reversed_at = now(), updated_at = now()
    WHERE order_id = ${input.orderId}::uuid AND status = 'applied'
  `);
}
