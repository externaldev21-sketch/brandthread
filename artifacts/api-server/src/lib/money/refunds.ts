/**
 * Refunds — the ONE path every buyer refund takes (buyer cancellation, seller
 * cancellation, seller partial/goodwill refund, approved return, failed drop,
 * oversold order).
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
 *    shortfall the seller owes, absorbed by the drop's later releases.
 *  - Orders without a drop (one-page checkout): what the order's held money
 *    can't cover (Stripe's fee, a label) is a debt the seller owes
 *    (seller_recoverable), netted from their next payouts —
 *    lib/money/sellerRecovery.ts.
 *  - One-page checkout orders (charge_model "transfer", lib/money/
 *    cartTransfers.ts): the cart's PaymentIntent is partially refunded for
 *    this order only. The seller's share is reversed from this order's own
 *    transfer, or taken from its held funds if the transfer hasn't gone out.
 *
 * Refund method (items 113/114, migration 616). `method` defaults to
 * 'original' — the card refund described above — so every caller that does
 * not pass it behaves exactly as before.
 *  - 'thread_cash': NO card refund. The buyer gets Thread Cash equal to the
 *    refund amount (thread_cash_entries source 'refund_credit', one entry per
 *    refund, never expires). The seller ends up exactly where a card refund
 *    leaves them (their share, amount − Brandthread's proportional fee, is
 *    clawed back); Brandthread keeps that clawed-back cash plus gives up its
 *    own fee on the refunded part, which together equal the Thread Cash it
 *    now owes the buyer. Ledger: thread_cash_refund_credit(+amount, party =
 *    buyer), platform_revenue(−fee), seller share (−) from seller_paid_out /
 *    seller_held exactly like a card refund. The claw-back must succeed
 *    BEFORE any Thread Cash is credited: a refused transfer reversal fails
 *    the refund and nothing is credited.
 *  - 'store_credit': NO card refund and NO money movement. The seller keeps
 *    the funds and issues a store gift card for the refund amount
 *    (gift_cards source 'seller_issued', linked to this refund, no expiry,
 *    in the buyer's wallet, code emailed). Redeeming it later is a discount
 *    the seller gives (giftCards/payout.ts never pays seller-issued cards).
 *    No money-ledger postings; the gift card ledger records the issue.
 *  Both still count toward orders.refunded_cents (so nothing is refunded
 *  twice), and a full refund still returns applied Thread Cash and gift
 *  cards, as for a card refund.
 */
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, orderItems, orderRefunds, orderReleases, orders } from "@workspace/db";
import { stripe as defaultStripe } from "../stripe";
import { logger } from "../logger";
import { platformFeeRefundCents } from "./fees";
import { adjustDropWalletForRefund, maybeCompleteDrop } from "./escrow";
import { accountBalanceCents, orderHeldCents, postLedgerTransaction, type DbExecutor, type LedgerPosting } from "./ledger";
import {
  assertThreadCashNotFrozen, creditRefundToThreadCash, isFeatureEnabled, refundThreadCashSpend,
} from "../threadCash/wallet";
import { issueSellerCard, type GiftCardRow } from "../giftCards/service";
import {
  orderFundsMachine, orderStatusMachine, refundMachine, releaseMachine,
  type OrderFundsState, type OrderStatus,
} from "./stateMachines";
import { isDefinitiveStripeRejection, safeErrorMessage, stripeErrorCode } from "./stripeMoney";
import { restoreStockForOrder } from "../stockReservation";
import { reverseCommissionForOrder } from "../affiliate/service";
import { restoreGiftCardsOnFullRefund } from "../giftCards/payout";
import { notifyStockRestored } from "../stockNotifications";
import { refundShortfallPosting } from "./sellerRecovery";
import { reverseFirstOrderDiscountOnFullRefund } from "../firstOrderDiscount";

export type RefundReason =
  | "buyer_cancelled" | "seller_cancelled" | "return_approved" | "drop_failed" | "oversold"
  | "not_delivered" | "seller_refund";

type StripeLike = Pick<Stripe, "refunds" | "transfers" | "applicationFees">;

export const REFUND_METHODS = ["original", "thread_cash", "store_credit"] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

export function isRefundMethod(value: unknown): value is RefundMethod {
  return typeof value === "string" && (REFUND_METHODS as readonly string[]).includes(value);
}

/** Refunding to Thread Cash only makes sense while buyers can spend it at checkout. */
export async function threadCashRefundsEnabled(): Promise<boolean> {
  return isFeatureEnabled("threadCashCheckoutDiscount");
}

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
  /**
   * The delivery guarantee's automatic refund may cancel an order that was
   * shipped but never delivered. No other path may (a buyer or seller
   * cancelling a shipped order goes through a return instead), so this is an
   * explicit opt-in rather than an edge in the order state machine.
   */
  allowFromShipped?: boolean;
  /** Runs under the order lock before anything is recorded. Throw to refuse. */
  precondition?: (order: LockedOrder, tx: DbExecutor) => void | Promise<void>;
  /** Runs inside the success transaction (e.g. loyalty point reversal). */
  onSucceeded?: (tx: DbExecutor, result: { order: LockedOrder; amountCents: number; refundId: string }) => Promise<void>;
  stripe?: StripeLike | null;
  /** How the buyer is paid back. Default 'original' (card refund). */
  method?: RefundMethod;
};

export type RefundResult = {
  refundId: string;
  state: "succeeded";
  amountCents: number;
  stripeRefundId: string | null;
  platformFeeRefundCents: number;
  duplicate: boolean;
  method: RefundMethod;
  /** Thread Cash entry credited (method 'thread_cash'). */
  threadCashEntryId: string | null;
  /** Store gift card issued (method 'store_credit'). */
  giftCardId: string | null;
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
  stripe_thread_cash_transfer_id: string | null;
  loyalty_applied_cents: number;
  stripe_loyalty_transfer_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_application_fee_id: string | null;
  stripe_transfer_id: string | null;
  created_at: Date;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

async function lockOrder(executor: DbExecutor, orderId: string): Promise<LockedOrder | undefined> {
  const [order] = rows<LockedOrder>(await executor.execute(sql`
    SELECT id, owner_id, buyer_id, order_number, status, drop_id, charge_model, funds_state,
           total_cents, gross_charged_cents, refunded_cents, platform_fee_cents,
           platform_fee_refunded_cents, thread_cash_applied_cents, stripe_thread_cash_transfer_id,
           loyalty_applied_cents, stripe_loyalty_transfer_id,
           stripe_payment_intent_id, stripe_application_fee_id, stripe_transfer_id, created_at
    FROM orders WHERE id = ${orderId}::uuid FOR UPDATE
  `));
  return order;
}

/** What Stripe captured for the order (legacy rows only have total_cents). */
export function orderGrossCents(order: Pick<LockedOrder, "gross_charged_cents" | "total_cents">): number {
  return order.gross_charged_cents > 0 ? order.gross_charged_cents : order.total_cents;
}

async function inFlightRefundCents(
  executor: DbExecutor, orderId: string, excludingId?: string, options: { cardOnly?: boolean } = {},
): Promise<number> {
  const [row] = rows<{ total: string }>(await executor.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total FROM order_refunds
    WHERE order_id = ${orderId}::uuid AND state = 'processing'
      ${excludingId ? sql`AND id <> ${excludingId}::uuid` : sql``}
      ${options.cardOnly ? sql`AND method = 'original'` : sql``}
  `));
  return Number(row?.total ?? 0);
}

/** Succeeded refunds paid as Thread Cash / store credit: in refunded_cents, but never on the Stripe charge. */
async function nonCardRefundedCents(executor: DbExecutor, orderId: string): Promise<number> {
  const [row] = rows<{ total: string }>(await executor.execute(sql`
    SELECT COALESCE(SUM(amount_cents), 0) AS total FROM order_refunds
    WHERE order_id = ${orderId}::uuid AND state = 'succeeded' AND method <> 'original'
  `));
  return Number(row?.total ?? 0);
}

function resultOf(refund: typeof orderRefunds.$inferSelect, duplicate: boolean): RefundResult {
  return {
    refundId: refund.id,
    state: "succeeded",
    amountCents: refund.amountCents,
    stripeRefundId: refund.stripeRefundId,
    platformFeeRefundCents: refund.platformFeeRefundCents,
    duplicate,
    method: isRefundMethod(refund.method) ? refund.method : "original",
    threadCashEntryId: refund.threadCashEntryId,
    giftCardId: refund.giftCardId,
  };
}

export async function refundOrder(options: RefundOptions): Promise<RefundResult> {
  const stripeClient = options.stripe === undefined ? defaultStripe : options.stripe;
  const method: RefundMethod = options.method ?? "original";
  if (!isRefundMethod(method)) throw new RefundError("Unknown refund method", 400, "INVALID_REFUND_METHOD");
  const threadCashOn = method === "thread_cash" ? await threadCashRefundsEnabled() : false;

  // ── Phase A ──────────────────────────────────────────────────────────────
  const phaseA = await db.transaction(async (tx) => {
    const order = await lockOrder(tx, options.orderId);
    if (!order) throw new RefundError("Order not found", 404, "ORDER_NOT_FOUND");

    const [existing] = await tx.select().from(orderRefunds)
      .where(eq(orderRefunds.idempotencyKey, options.idempotencyKey)).limit(1);
    if (existing && existing.orderId !== order.id) {
      throw new RefundError("This refund key belongs to a different order", 409, "IDEMPOTENCY_CONFLICT");
    }
    if (existing && existing.method !== method) {
      throw new RefundError("This refund was already started with a different refund method", 409, "IDEMPOTENCY_CONFLICT");
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
    if (!existing && method === "thread_cash") {
      if (!threadCashOn) {
        throw new RefundError("Refunds to Thread Cash aren't available right now", 409, "THREAD_CASH_REFUNDS_OFF");
      }
      if (!order.buyer_id) {
        throw new RefundError("Only a signed-in buyer can be refunded in Thread Cash", 409, "THREAD_CASH_NO_BUYER");
      }
      const destinationCharge = order.charge_model !== "held" && order.charge_model !== "transfer";
      if (destinationCharge && !order.stripe_transfer_id) {
        // Nothing to claw the seller's share back from, so Brandthread could
        // not fund the Thread Cash. Refund to the card instead.
        throw new RefundError("This order can only be refunded to the original payment", 409, "THREAD_CASH_NOT_SUPPORTED");
      }
      await assertThreadCashNotFrozen(tx, order.buyer_id).catch((error) => {
        throw new RefundError(error?.message ?? "Thread Cash is unavailable for this account", 409, "THREAD_CASH_FROZEN");
      });
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
        method,
      }).returning();
    } else if (refund.amountCents > refundable) {
      throw new RefundError("Refund exceeds what is left to refund", 409, "REFUND_EXCEEDS_REMAINING");
    }

    if (options.cancelOrder && order.status !== "refund_pending") {
      const from = order.status as OrderStatus;
      const parkable = orderStatusMachine.isState(from)
        && (orderStatusMachine.can(from, "refund_pending") || (options.allowFromShipped === true && from === "shipped"));
      if (!parkable) {
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
    } else if (order.charge_model === "transfer" && order.funds_state === "released" && order.stripe_transfer_id) {
      // The order's own transfer; what the seller still holds from it is its
      // paid-out balance (net of label recoveries and earlier reversals).
      const stillPaidOut = await accountBalanceCents(tx, { account: "seller_paid_out", partyId: order.owner_id, orderId: order.id });
      // A Thread Cash top-up is a separate transfer (reversed on its own
      // below), so it is not part of what this order's transfer can return.
      const topup = order.stripe_thread_cash_transfer_id ? order.thread_cash_applied_cents : 0;
      release = { id: "", amount: Math.max(0, stillPaidOut - topup), reversed: 0, transferId: order.stripe_transfer_id, state: "paid" };
    }
    return { kind: "go" as const, refund: refund!, order, release };
  });

  if (phaseA.kind === "done") return resultOf(phaseA.refund, true);

  const { refund, order, release } = phaseA;
  if (!stripeClient) {
    await failRefund(refund.id, "STRIPE_NOT_CONFIGURED", "Stripe is not configured", options);
    throw new RefundError("Payments are unavailable right now", 503, "STRIPE_NOT_CONFIGURED");
  }

  // ── Phase B ──────────────────────────────────────────────────────────────
  const destination = order.charge_model !== "held" && order.charge_model !== "transfer";
  if (method !== "original") {
    return settleNonCardRefund({ options, method, stripeClient, refund, order, release, destination });
  }
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
  let restockedLines: Array<{ variantId: string; quantity: number }> = [];
  const settledResult = await db.transaction(async (tx) => {
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
        ...resultOf(current ?? refund, true),
        stripeRefundId: current?.stripeRefundId ?? stripeRefund.id,
        platformFeeRefundCents: current?.platformFeeRefundCents ?? pfr,
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
      postings.push(refundShortfallPosting(locked, -(sellerShare - reversalCents)));
    } else {
      // The order holds only the seller's net (Stripe's fee and any label
      // were paid from it), so a full refund needs more than it holds: the
      // rest is a debt the seller owes, netted from their next payouts.
      const held = Math.max(0, await orderHeldCents(tx, locked.id, sellerId));
      const fromOrder = Math.min(sellerShare, held);
      postings.push({ account: "seller_held", partyId: sellerId, amountCents: -fromOrder });
      postings.push(refundShortfallPosting(locked, -(sellerShare - fromOrder)));
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
    if (release?.id && reversalCents > 0) {
      const newReversed = release.reversed + reversalCents;
      const fully = newReversed >= release.amount;
      if (fully) releaseMachine.assert("paid", "reversed");
      await tx.update(orderReleases).set({
        reversedCents: newReversed,
        ...(fully ? { state: "reversed" } : {}),
        updatedAt: new Date(),
      }).where(eq(orderReleases.id, release.id));
    }

    await finishRefund(tx, { options, stripeClient, locked, refundId: refund.id, amount, pfr, destination, moveFundsState: true, restockedLines });

    return resultOf(settled, false);
  });
  if (restockedLines.length) await notifyStockRestored(restockedLines).catch(err => logger.warn({err,refundId:refund.id}, "Restock notifications failed"));
  return settledResult;
}

type OrderRefundRow = typeof orderRefunds.$inferSelect;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReleaseInfo = { id: string; amount: number; reversed: number; transferId: string | null; state: string };

/**
 * The part of phase C every refund method shares: the order's refunded
 * totals and state, the cancellation, restock, the caller's hook, affiliate
 * claw-back, and — on a full refund — returning applied Thread Cash and gift
 * cards. `moveFundsState` is false for store credit (the seller keeps the
 * money, so the order's funds are not "refunded").
 */
async function finishRefund(tx: DbTransaction, input: {
  options: RefundOptions;
  stripeClient: StripeLike;
  locked: LockedOrder;
  refundId: string;
  amount: number;
  pfr: number;
  destination: boolean;
  moveFundsState: boolean;
  restockedLines?: Array<{variantId:string;quantity:number}>;
}): Promise<void> {
  const { options, stripeClient, locked, refundId, amount, pfr, destination, moveFundsState } = input;
  const sellerId = locked.owner_id;
  const newRefunded = locked.refunded_cents + amount;
  const fullyRefunded = newRefunded >= orderGrossCents(locked);
  const from = locked.funds_state as OrderFundsState | null;
  const moveFunds = moveFundsState && fullyRefunded && from && orderFundsMachine.can(from, "refunded");
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
    const lines = items.filter((i): i is { variantId: string; quantity: number } => Boolean(i.variantId));
    await restoreStockForOrder(tx, lines);
    input.restockedLines?.push(...lines);
  }
  await options.onSucceeded?.(tx, { order: locked, amountCents: amount, refundId: refundId });
  // Affiliate program: claw back the creator's commission on the refunded
  // part (full on cancellation). Savepoint-isolated; a no-op for orders
  // without an affiliate, and the payout sweep re-checks anyway.
  try {
    await tx.transaction((sp) => reverseCommissionForOrder(sp as any, locked.id));
  } catch (affiliateError) {
    logger.error({ err: affiliateError, orderId: locked.id }, "Affiliate commission reversal failed; the sweep will retry");
  }
  // A full refund/cancellation returns any Thread Cash the buyer spent on
  // this order, exactly once (idempotent on `refund:<orderId>`), for every
  // refund path (buyer/seller cancellation, return, oversold, drop
  // failure).
  if (fullyRefunded && locked.buyer_id && locked.thread_cash_applied_cents > 0) {
    await refundThreadCashSpend(tx, locked.buyer_id, locked.id, locked.thread_cash_applied_cents);
    // The card portion was already clawed back above (reverse_transfer on
    // the Stripe refund / release reversal). The platform-funded top-up
    // that made the seller whole (lib/threadCash/checkoutTopup.ts) is a
    // SEPARATE transfer, so it needs its own reversal — the seller must
    // not keep money for an item that was fully refunded.
    if ((destination || locked.charge_model === "transfer") && locked.stripe_thread_cash_transfer_id) {
      try {
        await stripeClient.transfers.createReversal(locked.stripe_thread_cash_transfer_id, {
          amount: locked.thread_cash_applied_cents,
          metadata: { brandthreadRefundId: refundId, orderId: locked.id },
        }, { idempotencyKey: `order-refund-threadcash-topup/${refundId}` });
        await postLedgerTransaction(tx, {
          idempotencyKey: `thread-cash-redeemed-reversal/${locked.id}`,
          kind: "thread_cash_seller_topup_reversed",
          sellerId,
          orderId: locked.id,
          stripeObjectId: locked.stripe_thread_cash_transfer_id,
          memo: "Reversed the platform-funded Thread Cash top-up on a fully refunded order",
          postings: [
            { account: "seller_paid_out", partyId: sellerId, amountCents: -locked.thread_cash_applied_cents },
            { account: "thread_cash_seller_topup", amountCents: locked.thread_cash_applied_cents },
          ],
        });
      } catch (error) {
        logger.error({ err: error, refundId: refundId, orderId: locked.id }, "Thread Cash top-up reversal failed; needs review");
      }
    }
  }
    // BT-066: the platform-funded loyalty top-up is its own transfer; a fully
    // refunded order takes it back from the seller (same as Thread Cash).
    if (fullyRefunded && locked.stripe_loyalty_transfer_id && locked.loyalty_applied_cents > 0) {
      try {
        await stripeClient.transfers.createReversal(locked.stripe_loyalty_transfer_id, {
          amount: locked.loyalty_applied_cents,
          metadata: { brandthreadRefundId: refundId, orderId: locked.id },
        }, { idempotencyKey: `order-refund-loyalty-topup/${refundId}` });
        await postLedgerTransaction(tx, {
          idempotencyKey: `loyalty-topup-reversal/${locked.id}`,
          kind: "loyalty_seller_topup_reversed",
          sellerId,
          orderId: locked.id,
          stripeObjectId: locked.stripe_loyalty_transfer_id,
          memo: "Reversed the platform-funded rewards top-up on a fully refunded order",
          postings: [
            { account: "seller_paid_out", partyId: sellerId, orderId: null, amountCents: -locked.loyalty_applied_cents },
            { account: "loyalty_seller_topup", amountCents: locked.loyalty_applied_cents },
          ],
        });
      } catch (error) {
        logger.error({ err: error, refundId: refundId, orderId: locked.id }, "Loyalty top-up reversal failed; needs review");
      }
    }
  // A full refund also gives any gift card used on the order its balance back.
  if (fullyRefunded) {
    await restoreGiftCardsOnFullRefund(tx, stripeClient, { orderId: locked.id, sellerId, refundId: refundId });
    await reverseFirstOrderDiscountOnFullRefund(tx, stripeClient, { orderId: locked.id, sellerId, refundId });
  }
  if (locked.drop_id) await maybeCompleteDrop(tx, locked.drop_id);
}

/**
 * Phases B and C for 'thread_cash' and 'store_credit' (see the header).
 * Thread Cash: the seller's share is clawed back FIRST; only once Stripe has
 * confirmed it is anything credited. Store credit: no Stripe call at all.
 */
async function settleNonCardRefund(input: {
  options: RefundOptions;
  method: Exclude<RefundMethod, "original">;
  stripeClient: StripeLike;
  refund: OrderRefundRow;
  order: LockedOrder;
  release: ReleaseInfo | null;
  destination: boolean;
}): Promise<RefundResult> {
  const { options, method, stripeClient, refund, order, release, destination } = input;
  const pfr = method === "thread_cash"
    ? platformFeeRefundCents({
        refundCents: refund.amountCents,
        grossCents: orderGrossCents(order),
        platformFeeCents: order.platform_fee_cents,
        platformFeeAlreadyRefundedCents: order.platform_fee_refunded_cents,
      })
    : 0;
  const sellerShare = refund.amountCents - pfr;

  // ── Phase B (Thread Cash only): claw the seller's share back ─────────────
  let reversalCents = 0;
  let reversalId: string | null = null;
  if (method === "thread_cash") {
    const fromRelease = !destination && release?.transferId && release.state === "paid";
    const transferId = destination ? order.stripe_transfer_id : fromRelease ? release!.transferId : null;
    const wanted = destination ? sellerShare : fromRelease ? Math.min(sellerShare, release!.amount - release!.reversed) : 0;
    if (transferId && wanted > 0) {
      try {
        const reversal = await stripeClient.transfers.createReversal(transferId, {
          amount: wanted,
          metadata: { brandthreadRefundId: refund.id, orderId: order.id, refundMethod: "thread_cash" },
        }, { idempotencyKey: `order-refund-thread-cash-reversal/${refund.id}/${refund.attempt}` });
        reversalCents = wanted;
        reversalId = reversal.id;
      } catch (error) {
        if (isDefinitiveStripeRejection(error)) {
          await failRefund(refund.id, stripeErrorCode(error), safeErrorMessage(error), options);
          throw new RefundError(
            "The seller's share couldn't be pulled back, so no Thread Cash was issued. Refund to the original payment instead.",
            502, "REFUND_REJECTED",
          );
        }
        logger.error({ err: error, refundId: refund.id, orderId: order.id }, "Thread Cash refund claw-back unconfirmed; will retry with the same key");
        throw new RefundError("The refund could not be confirmed. Please retry.", 502, "REFUND_UNCONFIRMED");
      }
    }
  }

  // ── Phase C ──────────────────────────────────────────────────────────────
  const restockedLines: Array<{variantId:string;quantity:number}> = [];
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockOrder(tx, order.id);
    const [settled] = await tx.update(orderRefunds).set({
      state: "succeeded",
      platformFeeRefundCents: pfr,
      transferReversalCents: reversalCents,
      stripeTransferReversalId: reversalId,
      succeededAt: new Date(),
      updatedAt: new Date(),
    }).where(and(eq(orderRefunds.id, refund.id), eq(orderRefunds.state, "processing")))
      .returning();
    if (!settled || !locked) {
      const [current] = await tx.select().from(orderRefunds).where(eq(orderRefunds.id, refund.id)).limit(1);
      return { result: resultOf(current ?? refund, true), card: null };
    }

    const sellerId = locked.owner_id;
    const amount = refund.amountCents;
    let threadCashEntryId: string | null = null;
    let card: { row: GiftCardRow; code: string } | null = null;

    if (method === "thread_cash") {
      // Brandthread now holds `amount` for the buyer: the seller's share it
      // just clawed back (or stops owing them) plus its own fee on this part.
      const postings: LedgerPosting[] = [
        { account: "thread_cash_refund_credit", partyId: locked.buyer_id, amountCents: amount },
        { account: "platform_revenue", amountCents: -pfr },
      ];
      if (destination) {
        postings.push({ account: "seller_paid_out", partyId: sellerId, amountCents: -reversalCents });
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
        kind: `refund_${options.reason}_thread_cash`,
        sellerId,
        orderId: locked.id,
        dropId: locked.drop_id,
        stripeObjectId: reversalId,
        memo: `Refund to buyer as Thread Cash (${options.reason.replace(/_/g, " ")})`,
        postings,
      });
      if (!destination && locked.drop_id) {
        await adjustDropWalletForRefund(tx, locked.drop_id, sellerShare - reversalCents);
      }
      if (release?.id && reversalCents > 0) {
        const newReversed = release.reversed + reversalCents;
        const fully = newReversed >= release.amount;
        if (fully) releaseMachine.assert("paid", "reversed");
        await tx.update(orderReleases).set({
          reversedCents: newReversed,
          ...(fully ? { state: "reversed" } : {}),
          updatedAt: new Date(),
        }).where(eq(orderReleases.id, release.id));
      }
      const credit = await creditRefundToThreadCash(tx, {
        buyerId: locked.buyer_id!,
        orderId: locked.id,
        refundId: refund.id,
        orderNumber: locked.order_number,
        amountCents: amount,
      });
      threadCashEntryId = credit.entryId;
    } else {
      const [contact] = rows<{ email: string | null; name: string | null }>(await tx.execute(sql`
        SELECT COALESCE(u.email, o.guest_email) AS email,
               COALESCE(u.display_name, u.name) AS name
        FROM orders o LEFT JOIN users u ON u.clerk_id = o.buyer_id
        WHERE o.id = ${locked.id}::uuid
      `));
      const issued = await issueSellerCard(tx, {
        sellerId,
        amountCents: amount,
        purchaserId: null,
        ownerId: locked.buyer_id,
        recipientEmail: contact?.email ?? null,
        recipientName: contact?.name ?? null,
        message: `Store credit for your refund on order #${locked.order_number}.`,
        expiresAt: null,
        actorId: options.initiatedBy,
        refundId: refund.id,
      });
      card = { row: issued.card, code: issued.code };
    }

    const [linked] = await tx.update(orderRefunds).set({
      threadCashEntryId,
      giftCardId: card?.row.id ?? null,
      updatedAt: new Date(),
    }).where(eq(orderRefunds.id, refund.id)).returning();

    await finishRefund(tx, {
      options, stripeClient, locked, refundId: refund.id, amount, pfr, destination,
      moveFundsState: method === "thread_cash", restockedLines,
    });
    return { result: resultOf(linked, false), card };
  });

  if (restockedLines.length) await notifyStockRestored(restockedLines).catch(err => logger.warn({err,refundId:refund.id}, "Restock notifications failed"));
  if (outcome.card) {
    const { row, code } = outcome.card;
    // The card is already in the buyer's wallet; the email only carries the code.
    await import("../giftCards/purchase")
      .then(({ deliverGiftCard }) => deliverGiftCard(row, code, null))
      .catch((err) => logger.error({ err, cardId: row.id, refundId: refund.id }, "Store credit email failed"));
  }
  return outcome.result;
}

/** What a return's requested resolution pays out as (returns.resolution_requested). */
export function refundMethodForResolution(resolution: string | null | undefined): RefundMethod {
  if (resolution === "thread_cash") return "thread_cash";
  if (resolution === "store_credit") return "store_credit";
  return "original";
}

/**
 * refundOrder with the buyer's chosen method, except that when Thread Cash
 * can't be used for this order (switched off since the buyer asked, guest
 * order, frozen account, nothing to claw back from) the buyer is refunded to
 * their card instead — never left without a refund. Nothing is recorded when
 * those checks refuse, so the same idempotency key is free for the card.
 */
export async function refundOrderAsChosen(options: RefundOptions): Promise<RefundResult> {
  try {
    return await refundOrder(options);
  } catch (error) {
    if (options.method === "thread_cash" && error instanceof RefundError && error.code.startsWith("THREAD_CASH_")) {
      logger.warn({ orderId: options.orderId, code: error.code }, "Thread Cash refund unavailable; refunding to the original payment");
      return refundOrder({ ...options, method: "original" });
    }
    throw error;
  }
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
    // Only card refunds show on the Stripe charge; Thread Cash and store
    // credit refunds are in refunded_cents but were never refunded by Stripe.
    const known = order.refunded_cents - await nonCardRefundedCents(tx, order.id)
      + await inFlightRefundCents(tx, order.id, undefined, { cardOnly: true });
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
    if ((order.charge_model === "held" || order.charge_model === "transfer") && order.funds_state !== "released") {
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
    const priorState: OrderFundsState = order.charge_model === "held" || order.charge_model === "transfer"
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

