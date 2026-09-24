/**
 * Refunds — the ONE path every buyer refund takes (buyer cancellation, seller
 * cancellation, approved return, failed drop, oversold order).
 *
 * Three phases, so money is never lost between Stripe and the database:
 *  A. (DB) lock the order, validate the amount against what is still
 *     refundable, and record an order_refunds row in "processing".
 *  B. (Stripe) create the refund with a deterministic idempotency key, and
 *     claw back the seller's share (transfer reversal) where needed.
 *  C. (DB) mark the refund succeeded and post the ledger exactly once.
 * A crash between B and C is repaired by simply retrying with the same
 * idempotency key: Stripe returns the same refund, phase C runs once.
 *
 * Who pays for a refund:
 *  - The buyer always gets back exactly the amount refunded.
 *  - Brandthread returns its 5% on the refunded portion (proportionally).
 *  - Stripe does not return its processing fee, so that stays a cost to the
 *    seller, like any other cost of the sale.
 *  - In-stock orders: the seller's share is pulled back from their Stripe
 *    balance (reverse_transfer). Held orders: it comes out of the held funds;
 *    if those were already spent (bulk order, label) the drop shows a
 *    shortfall the seller owes.
 */
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, orderItems, orderRefunds, orderReleases, orders, productVariants } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { platformFeeRefundCents } from "./fees";
import { adjustDropWalletForRefund, maybeCompleteDrop } from "./escrow";
import { orderHeldCents, postLedgerTransaction, type DbExecutor, type LedgerPosting } from "./ledger";
import { refundThreadCashSpend } from "../threadCash/wallet";
import {
  orderFundsMachine, orderStatusMachine, refundMachine, releaseMachine,
  type OrderFundsState, type OrderStatus,
} from "./stateMachines";
import { isDefinitiveStripeRejection, safeErrorMessage, stripeErrorCode } from "./stripeMoney";

export type RefundReason =
  | "buyer_cancelled" | "seller_cancelled" | "return_approved" | "drop_failed" | "oversold";

type StripeLike = Pick<Stripe, "refunds" | "transfers" | "applicationFees">;

export class RefundError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "RefundError";
  }
}

export type RefundOptions = {
  orderId: string;
  /** Omit for "everything still refundable". */
  amountCents?: number;
  reason: RefundReason;
  /** Clerk id of the person, or "system:<job>". */
  initiatedBy: string;
  /** Deterministic per business action, e.g. "buyer-cancel/<orderId>". */
  idempotencyKey: string;
  /**
   * Full cancellations: park the order in refund_pending while Stripe works,
   * then cancel it on success (or put it back if Stripe refuses).
   */
  cancelOrder?: { reason: string; notes: string | null; restock: boolean };
  /** Runs under the order lock before anything is recorded. Throw to refuse. */
  precondition?: (order: LockedOrder, tx: DbExecutor) => void | Promise<void>;
  /** Runs inside the success transaction (e.g. loyalty point reversal). */
  onSucceeded?: (tx: DbExecutor, result: { order: LockedOrder; amountCents: number; refundId: string }) => Promise<void>;
  stripe?: StripeLike | null;
};

export type RefundResult = {
  refundId: string;
  state: "succeeded";
  amountCents: number;
  stripeRefundId: string | null;
  platformFeeRefundCents: number;
  duplicate: boolean;
};

export type LockedOrder = {
  id: string;
  owner_id: string;
  buyer_id: string | null;
  order_number: string;
  status: string;
  drop_id: string | null;
  charge_model: string | null;
  funds_state: string | null;
  total_cents: number;
  gross_charged_cents: number;
  refunded_cents: number;
  platform_fee_cents: number;
  platform_fee_refunded_cents: number;
  thread_cash_applied_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_application_fee_id: string | null;
  created_at: Date;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

async function lockOrder(executor: DbExecutor, orderId: string): Promise<LockedOrder | undefined> {
  const [order] = rows<LockedOrder>(await executor.execute(sql`
    SELECT id, owner_id, buyer_id, order_number, status, drop_id, charge_model, funds_state,
           total_cents, gross_charged_cents, refunded_cents, platform_fee_cents,
           platform_fee_refunded_cents, thread_cash_applied_cents,
           stripe_payment_intent_id, stripe_application_fee_id, created_at
    FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `));
  return order;
}

/** What Stripe captured for the order (legacy rows only have total_cents). */
export function orderGrossCents(order: Pick<LockedOrder, "gross_charged_cents" | "total_cents">): number {
  return order.gross_charged_cents > 0 ? order.gross_charged_cents : order.total_cents;
}

async function inFlightRefundCents(executor: DbExecutor, orderId: string, excludingId?: string): Promise<number> {
  const [row] = rows<{ total: string }>(await executor.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total FROM order_refunds
    WHERE order_id = ${orderId}::uuid AND state = 'processing'
      ${excludingId ? sql`AND id <> ${excludingId}::uuid` : sql``}
  `));
  return Number(row?.total ?? 0);
}

export async function refundOrder(options: RefundOptions): Promise<RefundResult> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;

  // ── Phase A ──────────────────────────────────────────────────────────────
  const phaseA = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, options.orderId);
    if (!order) throw new RefundError("Order not found", 404, "ORDER_NOT_FOUND");

    const [existing] = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.idempotencyKey, options.idempotencyKey)).limit(1);
    if (existing && existing.orderId !== order.id) {
      throw new RefundError("This refund key belongs to a different order", 409, "IDEMPOTENCY_CONFLICT");
    }
    if (existing?.state === "succeeded") return { kind: "done" as const, refund: existing };

    if (!existing || existing.state === "failed") await options.precondition?.(order, tx);
    if (order.funds_state === "release_pending") {
      throw new RefundError(
        "This order's payout to the seller is in progress. Try again in a few minutes.",
        409, "RELEASE_IN_PROGRESS",
      );
    }
    if (!order.stripe_payment_intent_id) {
      throw new RefundError("This order has no card payment to refund", 409, "NOT_REFUNDABLE");
    }

    let refund = existing;
    if (existing?.state === "failed") {
      refundMachine.assert("failed", "processing");
      [refund] = await tx.update(orderRefunds).set({
        state: "processing", attempt: existing.attempt + 1, failureCode: null, failureMessage: null,
        updatedAt: new Date(),
      }).where(and(eq(orderRefunds.id, existing.id), eq(orderRefunds.state, "failed"))).returning();
    }

    const gross = orderGrossCents(order);
    const refundable = gross - order.refunded_cents - await inFlightRefundCents(tx, order.id, refund?.id);
    if (!refund) {
      const amount = options.amountCents ?? refundable;
      if (!Number.isSafeInteger(amount) || amount <= 0) {
        throw new RefundError(
          refundable <= 0 ? "This order has already been fully refunded" : "Refund amount must be a positive number of cents",
          refundable <= 0 ? 409 : 400,
          refundable <= 0 ? "ALREADY_REFUNDED" : "INVALID_REFUND_AMOUNT",
        );
      }
      if (amount > refundable) {
        throw new RefundError(
          `Refund exceeds what is left to refund (${refundable} cents)`, 400, "REFUND_EXCEEDS_REMAINING",
        );
      }
      [refund] = await tx.insert(orderRefunds).values({
        orderId: order.id,
        sellerId: order.owner_id,
        idempotencyKey: options.idempotencyKey,
        amountCents: amount,
        reason: options.reason,
        initiatedBy: options.initiatedBy,
        state: "processing",
        previousOrderStatus: options.cancelOrder ? order.status : null,
      }).returning();
    } else if (refund.amountCents > refundable) {
      throw new RefundError("Refund exceeds what is left to refund", 409, "REFUND_EXCEEDS_REMAINING");
    }

    if (options.cancelOrder && order.status !== "refund_pending") {
      const from = order.status as OrderStatus;
      if (!orderStatusMachine.isState(from) || !orderStatusMachine.can(from, "refund_pending")) {
        throw new RefundError(`An order that is ${order.status} cannot be cancelled`, 409, "NOT_CANCELLABLE");
      }
      await tx.update(orders).set({ status: "refund_pending", updatedAt: new Date() })
        .where(and(eq(orders.id, order.id), eq(orders.status, order.status)));
    }

    let release: { id: string; amount: number; reversed: number; transferId: string | null; state: string } | null = null;
    if (order.charge_model === "held" && order.funds_state === "released") {
      const [r] = await tx.select().from(orderReleases).where(eq(orderReleases.orderId, order.id)).limit(1);
      if (r) {
        release = {
          id: r.id, amount: r.amountCents, reversed: r.reversedCents, transferId: r.stripeTransferId, state: r.state,
        };
      }
    }
    return { kind: "go" as const, refund: refund!, order, release };
  });

  if (phaseA.kind === "done") {
    return {
      refundId: phaseA.refund.id,
      state: "succeeded",
      amountCents: phaseA.refund.amountCents,
      stripeRefundId: phaseA.refund.stripeRefundId,
      platformFeeRefundCents: phaseA.refund.platformFeeRefundCents,
      duplicate: true,
    };
  }

  const { refund, order, release } = phaseA;
  if (!stripeClient) {
    await failRefund(refund.id, "STRIPE_NOT_CONFIGURED", "Stripe is not configured", options);
    throw new RefundError("Payments are unavailable right now", 503, "STRIPE_NOT_CONFIGURED");
  }

  // ── Phase B ──────────────────────────────────────────────────────────────
  const destination = order.charge_model !== "held";
  let stripeRefund: Stripe.Refund;
  try {
    stripeRefund = await stripeClient.refunds.create({
      payment_intent: order.stripe_payment_intent_id!,
      amount: refund.amountCents,
      ...(destination ? { reverse_transfer: true, refund_application_fee: false } : {}),
      metadata: {
        brandthreadRefundId: refund.id,
        orderId: order.id,
        reason: options.reason,
      },
    }, { idempotencyKey: `order-refund/${refund.id}/${refund.attempt}` });
  } catch (error) {
    if (isDefinitiveStripeRejection(error)) {
      await failRefund(refund.id, stripeErrorCode(error), safeErrorMessage(error), options);
      throw new RefundError("Stripe could not process this refund", 502, "REFUND_REJECTED");
    }
    logger.error({ err: error, refundId: refund.id, orderId: order.id }, "Refund result unknown; will retry with the same key");
    throw new RefundError("The refund could not be confirmed. Please retry.", 502, "REFUND_UNCONFIRMED");
  }
  if (stripeRefund.status === "failed" || stripeRefund.status === "canceled") {
    await failRefund(refund.id, `refund_${stripeRefund.status}`, "Stripe reported the refund as failed", options);
    throw new RefundError("Stripe could not process this refund", 502, "REFUND_REJECTED");
  }

  const gross = orderGrossCents(order);
  const pfr = platformFeeRefundCents({
    refundCents: refund.amountCents,
    grossCents: gross,
    platformFeeCents: order.platform_fee_cents,
    platformFeeAlreadyRefundedCents: order.platform_fee_refunded_cents,
  });

  // Destination charges: Stripe pulled the full refund back from the seller;
  // return Brandthread's proportional 5% to them.
  let feeReturned = false;
  if (destination && pfr > 0 && order.stripe_application_fee_id) {
    try {
      await stripeClient.applicationFees.createRefund(order.stripe_application_fee_id, {
        amount: pfr,
        metadata: { brandthreadRefundId: refund.id, orderId: order.id },
      }, { idempotencyKey: `order-fee-refund/${refund.id}` });
      feeReturned = true;
    } catch (error) {
      logger.error({ err: error, refundId: refund.id }, "Platform fee refund failed; recorded as owed to the seller");
    }
  }

  // Held orders already released: claw the seller's share back from the
  // release transfer (never more than that transfer still holds).
  let reversalCents = 0;
  let reversalId: string | null = null;
  if (!destination && release?.transferId && release.state === "paid") {
    const wanted = Math.min(refund.amountCents - pfr, release.amount - release.reversed);
    if (wanted > 0) {
      try {
        const reversal = await stripeClient.transfers.createReversal(release.transferId, {
          amount: wanted,
          metadata: { brandthreadRefundId: refund.id, orderId: order.id },
        }, { idempotencyKey: `order-refund-reversal/${refund.id}` });
        reversalCents = wanted;
        reversalId = reversal.id;
      } catch (error) {
        logger.error({ err: error, refundId: refund.id }, "Release reversal failed; the drop shows the amount as owed");
      }
    }
  }

  // ── Phase C ──────────────────────────────────────────────────────────────
  return db.transaction(async (tx) => {
    const locked = await lockOrder(tx, order.id);
    const [settled] = await tx.update(orderRefunds).set({
      state: "succeeded",
      stripeRefundId: stripeRefund.id,
      platformFeeRefundCents: pfr,
      transferReversalCents: reversalCents,
      stripeTransferReversalId: reversalId,
      succeededAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(orderRefunds.id, refund.id), eq(orderRefunds.state, "processing")))
      .returning();
    if (!settled || !locked) {
      const [current] = await tx.select().from(orderRefunds).where(eq(orderRefunds.id, refund.id)).limit(1);
      return {
        refundId: refund.id,
        state: "succeeded" as const,
        amountCents: refund.amountCents,
        stripeRefundId: current?.stripeRefundId ?? stripeRefund.id,
        platformFeeRefundCents: current?.platformFeeRefundCents ?? pfr,
        duplicate: true,
      };
    }

    const sellerId = locked.owner_id;
    const amount = refund.amountCents;
    const sellerShare = amount - pfr;
    const postings: LedgerPosting[] = [
      { account: "buyer_payments", amountCents: amount },
      { account: "platform_revenue", amountCents: -pfr },
    ];
    if (destination) {
      postings.push({ account: "seller_paid_out", partyId: sellerId, amountCents: -amount });
      // The 5% return reaches the seller directly, or is owed to them.
      postings.push(feeReturned
        ? { account: "seller_paid_out", partyId: sellerId, amountCents: pfr }
        : { account: "platform_funds_advanced", partyId: sellerId, amountCents: pfr });
    } else if (locked.funds_state === "released") {
      postings.push({ account: "seller_paid_out", partyId: sellerId, amountCents: -reversalCents });
      postings.push({ account: "seller_held", partyId: sellerId, orderId: null, amountCents: -(sellerShare - reversalCents) });
    } else {
      const held = Math.max(0, await orderHeldCents(tx, locked.id, sellerId));
      const fromOrder = Math.min(sellerShare, held);
      postings.push({ account: "seller_held", partyId: sellerId, amountCents: -fromOrder });
      postings.push({ account: "seller_held", partyId: sellerId, orderId: null, amountCents: -(sellerShare - fromOrder) });
    }
    await postLedgerTransaction(tx, {
      idempotencyKey: `order-refund/${refund.id}`,
      kind: `refund_${options.reason}`,
      sellerId,
      orderId: locked.id,
      dropId: locked.drop_id,
      stripeObjectId: stripeRefund.id,
      memo: `Refund to buyer (${options.reason.replace(/_/g, " ")})`,
      postings,
    });

    if (!destination && locked.drop_id) {
      await adjustDropWalletForRefund(tx, locked.drop_id, sellerShare - reversalCents);
    }
    if (release && reversalCents > 0) {
      const newReversed = release.reversed + reversalCents;
      const fully = newReversed >= release.amount;
      if (fully) releaseMachine.assert("paid", "reversed");
      await tx.update(orderReleases).set({
        reversedCents: newReversed,
        ...(fully ? { state: "reversed" } : {}),
        updatedAt: new Date(),
      }).where(eq(orderReleases.id, release.id));
    }

    const newRefunded = locked.refunded_cents + amount;
    const fullyRefunded = newRefunded >= orderGrossCents(locked);
    const from = locked.funds_state as OrderFundsState | null;
    const moveFunds = fullyRefunded && from && orderFundsMachine.can(from, "refunded");
    await tx.update(orders).set({
      refundedCents: newRefunded,
      platformFeeRefundedCents: locked.platform_fee_refunded_cents + pfr,
      ...(moveFunds ? { fundsState: "refunded" } : {}),
      ...(options.cancelOrder ? {
        status: "cancelled",
        cancellationReason: options.cancelOrder.reason,
        cancellationNotes: options.cancelOrder.notes,
      } : {}),
      updatedAt: new Date(),
    }).where(eq(orders.id, locked.id));

    if (options.cancelOrder?.restock) {
      const items = await tx.select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
        .from(orderItems).where(eq(orderItems.orderId, locked.id));
      for (const item of items) {
        if (!item.variantId) continue;
        await tx.update(productVariants)
          .set({ stock: sql`${productVariants.stock} + ${item.quantity}` })
          .where(eq(productVariants.id, item.variantId));
      }
    }
    await options.onSucceeded?.(tx, { order: locked, amountCents: amount, refundId: refund.id });
    // THREAD CASH HOOK POINT: a full refund/cancellation returns any Thread
    // Cash the buyer spent on this order. Inert today — nothing yet sets
    // orders.thread_cash_applied_cents above 0 — but wired here, once, for
    // every refund path (buyer/seller cancellation, return, oversold, drop
    // failure) so it needs no further changes once checkout redemption ships.
    if (fullyRefunded && locked.buyer_id && locked.thread_cash_applied_cents > 0) {
      await refundThreadCashSpend(tx, locked.buyer_id, locked.id, locked.thread_cash_applied_cents);
    }
    if (locked.drop_id) await maybeCompleteDrop(tx, locked.drop_id);

    return {
      refundId: refund.id,
      state: "succeeded" as const,
      amountCents: amount,
      stripeRefundId: stripeRefund.id,
      platformFeeRefundCents: pfr,
      duplicate: false,
    };
  });
}

async function failRefund(
  refundId: string,
  code: string,
  message: string,
  options: Pick<RefundOptions, "cancelOrder">,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [failed] = await tx.update(orderRefunds).set({
      state: "failed", failureCode: code.slice(0, 80), failureMessage: message.slice(0, 300), updatedAt: new Date(),
    }).where(and(eq(orderRefunds.id, refundId), eq(orderRefunds.state, "processing")))
      .returning();
    if (failed && options.cancelOrder && failed.previousOrderStatus) {
      await tx.update(orders).set({ status: failed.previousOrderStatus, updatedAt: new Date() })
        .where(and(eq(orders.id, failed.orderId), eq(orders.status, "refund_pending")));
    }
  });
}

// ─── Webhook-driven refund reconciliation ─────────────────────────────────────

/**
 * charge.refunded for a buyer order. Refunds created by refundOrder carry
 * metadata.brandthreadRefundId and are skipped here (phase C records them).
 * Anything else — typically a refund issued from the Stripe dashboard — is
 * recorded so the ledger still matches Stripe. Because such a refund may not
 * have reversed the seller transfer, the seller's share is recorded as owed
 * to Brandthread (platform_funds_advanced) for a person to review.
 */
export async function recordExternalRefunds(input: {
  paymentIntentId: string | null;
  chargeId: string | null;
  cumulativeRefundedCents: number;
  providerEventId: string;
}): Promise<{ recordedCents: number; orderId: string | null }> {
  if (!input.paymentIntentId && !input.chargeId) return { recordedCents: 0, orderId: null };
  return db.transaction(async (tx) => {
    const [match] = rows<{ id: string }>(await tx.execute(sql`
      SELECT id FROM orders
      WHERE ${input.paymentIntentId ? sql`stripe_payment_intent_id = ${input.paymentIntentId}` : sql`FALSE`}
         OR ${input.chargeId ? sql`stripe_charge_id = ${input.chargeId}` : sql`FALSE`}
      LIMIT 1
    `));
    if (!match) return { recordedCents: 0, orderId: null };
    const order = await lockOrder(tx, match.id);
    if (!order || !order.charge_model) return { recordedCents: 0, orderId: match.id };
    const known = order.refunded_cents + await inFlightRefundCents(tx, order.id);
    const delta = Math.min(input.cumulativeRefundedCents, orderGrossCents(order)) - known;
    if (!Number.isSafeInteger(delta) || delta <= 0) return { recordedCents: 0, orderId: order.id };

    const [refund] = await tx.insert(orderRefunds).values({
      orderId: order.id,
      sellerId: order.owner_id,
      idempotencyKey: `external-refund/${input.providerEventId}`,
      amountCents: delta,
      reason: "stripe_dashboard",
      initiatedBy: "stripe",
      state: "succeeded",
      succeededAt: new Date(),
    }).onConflictDoNothing({ target: orderRefunds.idempotencyKey }).returning();
    if (!refund) return { recordedCents: 0, orderId: order.id };

    const sellerId = order.owner_id;
    const postings: LedgerPosting[] = [{ account: "buyer_payments", amountCents: delta }];
    if (order.charge_model === "held" && order.funds_state !== "released") {
      const held = Math.max(0, await orderHeldCents(tx, order.id, sellerId));
      const fromOrder = Math.min(delta, held);
      postings.push({ account: "seller_held", partyId: sellerId, amountCents: -fromOrder });
      postings.push({ account: "seller_held", partyId: sellerId, orderId: null, amountCents: -(delta - fromOrder) });
      if (order.drop_id) await adjustDropWalletForRefund(tx, order.drop_id, delta);
    } else {
      postings.push({ account: "platform_funds_advanced", partyId: sellerId, amountCents: -delta });
    }
    await postLedgerTransaction(tx, {
      idempotencyKey: `order-refund/${refund.id}`,
      kind: "refund_stripe_dashboard",
      sellerId,
      orderId: order.id,
      dropId: order.drop_id,
      stripeObjectId: input.chargeId,
      memo: "Refund issued outside Brandthread (Stripe dashboard) — needs review",
      postings,
    });
    const newRefunded = order.refunded_cents + delta;
    const from = order.funds_state as OrderFundsState | null;
    const full = newRefunded >= orderGrossCents(order) && from && orderFundsMachine.can(from, "refunded");
    await tx.update(orders).set({
      refundedCents: newRefunded,
      ...(full ? { fundsState: "refunded" } : {}),
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));
    logger.warn({ orderId: order.id, amountCents: delta }, "Recorded a refund made outside Brandthread");
    return { recordedCents: delta, orderId: order.id };
  });
}

/**
 * Stripe reported that a refund it had accepted later failed. The buyer did
 * not get the money, so the refund's ledger posting is reversed and the
 * order's refunded total goes back down. Needs a person to contact the buyer.
 */
export async function recordRefundFailedLater(stripeRefundId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [refund] = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.stripeRefundId, stripeRefundId)).limit(1);
    if (!refund || refund.state !== "succeeded") return false;
    const order = await lockOrder(tx, refund.orderId);
    if (!order) return false;
    refundMachine.assert("succeeded", "failed");
    const [failed] = await tx.update(orderRefunds).set({
      state: "failed", failureCode: "failed_after_success",
      failureMessage: "Stripe reported this refund failed after accepting it", updatedAt: new Date(),
    }).where(and(eq(orderRefunds.id, refund.id), eq(orderRefunds.state, "succeeded"))).returning();
    if (!failed) return false;

    const original = rows<{ account: string; party_id: string | null; drop_id: string | null; order_id: string | null; amount_cents: string }>(
      await tx.execute(sql`
        SELECT p.account, p.party_id, p.drop_id, p.order_id, p.amount_cents
        FROM ledger_postings p JOIN ledger_transactions t ON t.id = p.transaction_id
        WHERE t.idempotency_key = ${`order-refund/${refund.id}`}
      `),
    );
    if (original.length) {
      await postLedgerTransaction(tx, {
        idempotencyKey: `order-refund-failed/${refund.id}`,
        kind: "refund_failed_after_success",
        sellerId: order.owner_id,
        orderId: order.id,
        dropId: order.drop_id,
        stripeObjectId: stripeRefundId,
        memo: "Stripe failed a refund after accepting it; the buyer was not repaid",
        postings: original.map((p) => ({
          account: p.account as LedgerPosting["account"],
          partyId: p.party_id,
          dropId: p.drop_id,
          orderId: p.order_id,
          amountCents: -Number(p.amount_cents),
        })),
      });
      if (order.drop_id && order.charge_model === "held") {
        await adjustDropWalletForRefund(tx, order.drop_id, -(refund.amountCents - refund.platformFeeRefundCents - refund.transferReversalCents));
      }
    }
    const priorState: OrderFundsState = order.charge_model === "held"
      ? (refund.transferReversalCents > 0 || order.funds_state === "released" ? "released" : "held")
      : "settled_direct";
    await tx.update(orders).set({
      refundedCents: Math.max(0, order.refunded_cents - refund.amountCents),
      platformFeeRefundedCents: Math.max(0, order.platform_fee_refunded_cents - refund.platformFeeRefundCents),
      ...(order.funds_state === "refunded" ? { fundsState: priorState } : {}),
      updatedAt: new Date(),
    }).where(eq(orders.id, order.id));
    logger.error({ orderId: order.id, refundId: refund.id }, "A refund failed after Stripe accepted it; buyer follow-up required");
    return true;
  });
}

