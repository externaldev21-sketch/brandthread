/**
 * Refunds of paid sample/bulk order cards (BT-460).
 *
 * Callers: the manufacturer (POST /api/sample-orders/:id/refund), a seller's
 * cancel request the manufacturer approves (…/cancel-request/approve), and
 * admins (POST /api/admin/sample-orders/:id/refund, or any admin tool that
 * imports refundSampleOrder).
 *
 * Money:
 *  - Card / ACH (destination charge): stripe.refunds.create with
 *    reverse_transfer: true pulls the refunded amount back from the
 *    manufacturer, then Brandthread returns its share of the 5% commission to
 *    the manufacturer with an application-fee refund. Net: the manufacturer
 *    funds (refund − returned commission); Brandthread returns only commission.
 *    Stripe never returns processing on refunds, so that is never returned.
 *  - Drop wallet (bulk paid from held preorder funds): the manufacturer's part
 *    is reversed from the order's transfer, Brandthread adds back its returned
 *    commission, and the seller's wallet gets the full refund back.
 *
 * Commission policy is one switch, B2B_REFUND_COMMISSION_POLICY:
 *   "proportional" (default) commission returned in proportion to the refund
 *                  (a full refund returns all of it) — same rule as retail;
 *   "before_production_only" returned only for a full refund before the
 *                  manufacturer starts production (status payment_received);
 *   "never"        Brandthread always keeps its commission.
 *
 * Safety: the refund amount is reserved on the order row under a row lock
 * before Stripe is called, so concurrent refunds can never exceed the price;
 * every Stripe call uses a key derived from the refund row, so a retried
 * request resumes instead of refunding twice; a definitive Stripe rejection
 * releases the reservation. A payment_reversed activity event is written with
 * the reservation so the charge.refunded / transfer.reversed webhooks for this
 * refund see nothing new and leave the order alone.
 */
import {
  db, dropWallets, dropWalletTransactions, manufacturerActivityEvents, manufacturers, sampleOrderRefunds, sampleOrders,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { formatMoney } from "@workspace/manufacturer-flow";
import { requireStripe } from "../stripe";
import { platformFeeRefundCents } from "../money/fees";
import { postLedgerTransaction } from "../money/ledger";
import { lockDrop } from "../money/escrow";
import { postThreadSystemMessage, recordOrderEvent } from "../manufacturerOrders";
import { logger } from "../logger";

export type B2bRefundCommissionPolicy = "proportional" | "before_production_only" | "never";
export const B2B_REFUND_COMMISSION_POLICY: B2bRefundCommissionPolicy = "proportional";

/** Statuses in which the card has been paid and can be refunded. */
export const REFUNDABLE_STATUSES = [
  "payment_received", "processing", "cut_and_sew", "packing", "shipped", "delivered",
  "review_needed", "approved", "rejected", "revision_requested", "complete", "completed",
] as const;

type SampleOrder = typeof sampleOrders.$inferSelect;
type RefundRow = typeof sampleOrderRefunds.$inferSelect;
export type RefundActorRole = "manufacturer" | "admin" | "cancel_request";
export type Notify = (n: {
  userId: string; category: string; type: string; title: string; body: string;
  targetId: string; targetType: string; cta: string;
}) => Promise<unknown>;

export class B2bRefundError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
    this.name = "B2bRefundError";
  }
}

function isDefinitive(error: unknown) {
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  return statusCode != null && statusCode >= 400 && statusCode < 500 && statusCode !== 409 && statusCode !== 429;
}

/** Commission Brandthread actually collected on this card. */
export function collectedCommissionCents(order: Pick<SampleOrder, "walletId" | "manufacturerNetCents" | "platformFeeCents" | "priceCents">) {
  // Wallet transfers made before BT-453 sent the full price: nothing was kept.
  if (order.walletId && order.manufacturerNetCents == null) return 0;
  return Math.min(Math.max(0, order.platformFeeCents), order.priceCents);
}

export function commissionToReturnCents(
  order: Pick<SampleOrder, "status" | "priceCents" | "refundedCents" | "platformFeeRefundedCents" | "walletId" | "manufacturerNetCents" | "platformFeeCents">,
  amountCents: number,
  policy: B2bRefundCommissionPolicy = B2B_REFUND_COMMISSION_POLICY,
): number {
  const collected = collectedCommissionCents(order);
  if (policy === "never" || collected === 0) return 0;
  if (policy === "before_production_only") {
    const full = order.refundedCents === 0 && amountCents === order.priceCents;
    return full && order.status === "payment_received" ? Math.max(0, collected - order.platformFeeRefundedCents) : 0;
  }
  return platformFeeRefundCents({
    refundCents: amountCents,
    grossCents: order.priceCents,
    platformFeeCents: collected,
    platformFeeAlreadyRefundedCents: order.platformFeeRefundedCents,
  });
}

export type RefundSampleOrderInput = {
  orderId: string;
  /** Defaults to everything not yet refunded. */
  amountCents?: number | null;
  reason?: string | null;
  actor: { role: RefundActorRole; clerkId: string | null };
  /** Same key → same refund. Defaults to one derived from the order's refund state. */
  idempotencyKey?: string | null;
  /** Let a fixed key start a new attempt after Stripe definitively rejected the last one. */
  retryAfterFailure?: boolean;
  notify?: Notify;
};

export type RefundSampleOrderResult = { refund: RefundRow; order: SampleOrder; replayed: boolean };

/**
 * Refunds a paid sample/bulk card, fully or partially. Throws B2bRefundError
 * for anything the caller should show (not paid, over-refund, disputed…).
 */
export async function refundSampleOrder(input: RefundSampleOrderInput): Promise<RefundSampleOrderResult> {
  const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, input.orderId)).limit(1);
  if (!order) throw new B2bRefundError("NOT_FOUND", "Order not found", 404);

  const remaining = order.priceCents - order.refundedCents;
  const amountCents = input.amountCents ?? remaining;
  const clientKey = input.idempotencyKey?.trim() ? input.idempotencyKey.trim().slice(0, 200) : null;
  let key = clientKey
    ? `b2b-refund/${order.id}/${clientKey}`
    : `b2b-refund/${order.id}/${order.refundedCents}/${amountCents}`;

  // A key that Stripe definitively rejected stays failed for a client-chosen
  // key (same key, same answer). A derived key — or one the caller marks as
  // retryable — moves on to a fresh attempt after each failure.
  let existing: RefundRow | undefined;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    [existing] = await db.select().from(sampleOrderRefunds).where(eq(sampleOrderRefunds.idempotencyKey, key)).limit(1);
    if (existing?.state !== "failed" || (clientKey && !input.retryAfterFailure)) break;
    key = `${key}/after-${existing.id}`;
  }
  if (existing?.state === "succeeded") return { refund: existing, order, replayed: true };
  if (existing?.state === "failed") {
    throw new B2bRefundError("REFUND_FAILED", existing.error ?? "This refund was rejected by Stripe. Start a new refund.");
  }

  let refund: RefundRow | null = existing ?? null;
  if (!refund) {
    if (!(REFUNDABLE_STATUSES as readonly string[]).includes(order.status)) {
      throw new B2bRefundError(
        order.status === "payment_review" ? "PAYMENT_UNDER_REVIEW" : "NOT_PAID",
        order.status === "payment_review"
          ? "This payment is disputed or under review. It can't be refunded until that's resolved."
          : order.status === "refunded" ? "This order has already been fully refunded." : "Only paid orders can be refunded.",
      );
    }
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      throw new B2bRefundError("INVALID_AMOUNT", "Refund amount must be at least US$0.01.", 400);
    }
    if (amountCents > remaining) {
      throw new B2bRefundError("OVER_REFUND", `You can refund up to ${formatMoney(Math.max(0, remaining))} on this order.`, 400);
    }
    const method = order.walletId ? "wallet_reversal" : "card_refund";
    if (method === "card_refund" && !order.stripePaymentIntentId) {
      throw new B2bRefundError("NO_PAYMENT", "This order has no card payment on file to refund.");
    }
    if (method === "wallet_reversal" && !order.stripeTransferId) {
      throw new B2bRefundError("NO_PAYMENT", "This order's wallet transfer hasn't settled yet. Try again shortly.");
    }
    const commission = commissionToReturnCents(order, amountCents);

    // Reserve the refund on the row (locked) and claim it for the webhooks.
    refund = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM sample_orders WHERE id = ${order.id}::uuid FOR UPDATE`);
      const [reserved] = await tx.update(sampleOrders).set({
        refundedCents: sql`${sampleOrders.refundedCents} + ${amountCents}`,
        platformFeeRefundedCents: sql`${sampleOrders.platformFeeRefundedCents} + ${commission}`,
        updatedAt: new Date(),
      }).where(and(
        eq(sampleOrders.id, order.id),
        eq(sampleOrders.refundedCents, order.refundedCents),
        sql`${sampleOrders.refundedCents} + ${amountCents} <= ${sampleOrders.priceCents}`,
      )).returning({ id: sampleOrders.id });
      if (!reserved) return null;
      const [row] = await tx.insert(sampleOrderRefunds).values({
        sampleOrderId: order.id,
        idempotencyKey: key,
        amountCents,
        platformFeeRefundedCents: commission,
        method,
        state: "pending",
        reason: input.reason?.trim().slice(0, 500) || null,
        initiatedByRole: input.actor.role,
        initiatedBy: input.actor.clerkId,
      }).returning();
      await tx.insert(manufacturerActivityEvents).values({
        manufacturerId: order.manufacturerId,
        sampleOrderId: order.id,
        actorClerkId: input.actor.clerkId,
        category: "payment",
        type: "payment_reversed",
        amountCents,
        providerEventId: `b2b-refund:${row.id}`,
        metadata: { source: "platform_refund", refundId: row.id, initiatedBy: input.actor.role },
      });
      return row;
    });
    if (!refund) {
      // Another refund changed the order between our read and the lock.
      const [raced] = await db.select().from(sampleOrderRefunds).where(eq(sampleOrderRefunds.idempotencyKey, key)).limit(1);
      if (raced?.state === "succeeded") return { refund: raced, order, replayed: true };
      throw new B2bRefundError("STALE_WRITE", "This order changed while refunding. Refresh and try again.");
    }
  }

  return executeRefund(refund, input);
}

async function releaseReservation(refund: RefundRow, error: string) {
  await db.transaction(async (tx) => {
    const [failed] = await tx.update(sampleOrderRefunds).set({ state: "failed", error: error.slice(0, 500), updatedAt: new Date() })
      .where(and(eq(sampleOrderRefunds.id, refund.id), eq(sampleOrderRefunds.state, "pending"))).returning({ id: sampleOrderRefunds.id });
    if (!failed) return;
    await tx.update(sampleOrders).set({
      refundedCents: sql`GREATEST(${sampleOrders.refundedCents} - ${refund.amountCents}, 0)`,
      platformFeeRefundedCents: sql`GREATEST(${sampleOrders.platformFeeRefundedCents} - ${refund.platformFeeRefundedCents}, 0)`,
      updatedAt: new Date(),
    }).where(eq(sampleOrders.id, refund.sampleOrderId));
    await tx.delete(manufacturerActivityEvents).where(eq(manufacturerActivityEvents.providerEventId, `b2b-refund:${refund.id}`));
  });
}

async function executeRefund(refund: RefundRow, input: RefundSampleOrderInput): Promise<RefundSampleOrderResult> {
  const [order] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, refund.sampleOrderId)).limit(1);
  if (!order) throw new B2bRefundError("NOT_FOUND", "Order not found", 404);
  const stripe = requireStripe();
  const manufacturerShare = refund.amountCents - refund.platformFeeRefundedCents;
  const ids: { refundId?: string; reversalId?: string; feeRefundId?: string } = {};
  try {
    if (refund.method === "card_refund") {
      const intent: any = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId!, { expand: ["latest_charge"] });
      const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
      const created: any = await stripe.refunds.create({
        ...(charge?.id ? { charge: charge.id } : { payment_intent: order.stripePaymentIntentId! }),
        amount: refund.amountCents,
        reverse_transfer: true,
        refund_application_fee: false,
        metadata: { sampleOrderId: order.id, b2bRefundId: refund.id },
      }, { idempotencyKey: `${refund.idempotencyKey}/refund` });
      ids.refundId = created.id;
      if (refund.platformFeeRefundedCents > 0) {
        const feeId = typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
        if (!feeId) throw new Error("The charge has no application fee to return");
        const feeRefund: any = await stripe.applicationFees.createRefund(feeId, {
          amount: refund.platformFeeRefundedCents,
          metadata: { sampleOrderId: order.id, b2bRefundId: refund.id },
        }, { idempotencyKey: `${refund.idempotencyKey}/fee` });
        ids.feeRefundId = feeRefund.id;
      }
    } else {
      if (manufacturerShare > 0) {
        const reversal: any = await stripe.transfers.createReversal(order.stripeTransferId!, {
          amount: manufacturerShare,
          metadata: { sampleOrderId: order.id, b2bRefundId: refund.id },
        }, { idempotencyKey: `${refund.idempotencyKey}/reversal` });
        ids.reversalId = reversal.id;
      }
    }
  } catch (error) {
    if (isDefinitive(error) && !ids.refundId && !ids.reversalId) {
      await releaseReservation(refund, (error as Error).message ?? "Stripe rejected the refund");
      throw new B2bRefundError("REFUND_FAILED", `Stripe rejected the refund: ${(error as Error).message}`, 502);
    }
    // Ambiguous (network / 5xx) or failed after the money moved: keep the
    // reservation; retrying with the same key resumes safely.
    logger.error({ err: error, refundId: refund.id, orderId: order.id }, "B2B refund incomplete; retry resumes it");
    throw new B2bRefundError("REFUND_PENDING", "The refund is still processing. Try again in a moment.", 502);
  }

  const result = await db.transaction(async (tx) => {
    const [done] = await tx.update(sampleOrderRefunds).set({
      state: "succeeded",
      stripeRefundId: ids.refundId ?? refund.stripeRefundId,
      stripeTransferReversalId: ids.reversalId ?? refund.stripeTransferReversalId,
      stripeFeeRefundId: ids.feeRefundId ?? refund.stripeFeeRefundId,
      error: null,
      updatedAt: new Date(),
    }).where(and(eq(sampleOrderRefunds.id, refund.id), eq(sampleOrderRefunds.state, "pending"))).returning();
    if (!done) {
      const [current] = await tx.select().from(sampleOrderRefunds).where(eq(sampleOrderRefunds.id, refund.id)).limit(1);
      return { refund: current, finalized: false };
    }
    await tx.execute(sql`SELECT id FROM sample_orders WHERE id = ${order.id}::uuid FOR UPDATE`);
    const [locked] = await tx.select().from(sampleOrders).where(eq(sampleOrders.id, order.id)).limit(1);
    const fullyRefunded = locked.refundedCents >= locked.priceCents;
    if (refund.method === "card_refund") {
      await postLedgerTransaction(tx, {
        idempotencyKey: `b2b-refund/${refund.id}`,
        kind: "manufacturer_card_refunded",
        sellerId: order.sellerId,
        sampleOrderId: order.id,
        stripeObjectId: ids.refundId ?? null,
        memo: `${order.orderType === "bulk" ? "Bulk" : "Sample"} card refunded to the seller`,
        postings: [
          { account: "seller_card_payments", partyId: order.sellerId, amountCents: refund.amountCents },
          { account: "manufacturer_paid", partyId: order.manufacturerId, amountCents: -manufacturerShare },
          { account: "platform_revenue", amountCents: -refund.platformFeeRefundedCents },
        ],
      });
    } else {
      const [wallet] = await tx.select({ id: dropWallets.id, dropId: dropWallets.dropId })
        .from(dropWallets).where(eq(dropWallets.id, order.walletId!)).limit(1);
      if (wallet) {
        await lockDrop(tx, wallet.dropId);
        await tx.update(dropWallets).set({
          releasedCents: sql`GREATEST(${dropWallets.releasedCents} - ${refund.amountCents}, 0)`,
          updatedAt: new Date(),
        }).where(eq(dropWallets.id, wallet.id));
        await tx.insert(dropWalletTransactions).values({
          walletId: wallet.id,
          type: "bulk_payment_reversal",
          amountCents: -refund.amountCents,
          sampleOrderId: order.id,
          description: `${fullyRefunded ? "Full" : "Partial"} bulk order refund: ${order.title}`,
          stripeTransferId: order.stripeTransferId,
        });
        await postLedgerTransaction(tx, {
          idempotencyKey: `b2b-refund/${refund.id}`,
          kind: "bulk_payment_refunded",
          sellerId: order.sellerId,
          dropId: wallet.dropId,
          sampleOrderId: order.id,
          stripeObjectId: ids.reversalId ?? null,
          memo: "Bulk order refunded back into the drop's held funds",
          postings: [
            { account: "manufacturer_paid", partyId: order.manufacturerId, orderId: null, amountCents: -manufacturerShare },
            { account: "platform_revenue", orderId: null, amountCents: -refund.platformFeeRefundedCents },
            { account: "seller_held", partyId: order.sellerId, dropId: wallet.dropId, orderId: null, amountCents: refund.amountCents },
          ],
        });
      }
    }
    const [updated] = await tx.update(sampleOrders).set({
      ...(fullyRefunded ? { status: "refunded" } : {}),
      ...(locked.cancelRequestState === "requested" && fullyRefunded ? { cancelRequestState: "approved" } : {}),
      updatedAt: new Date(),
      revision: sql`${sampleOrders.revision} + 1`,
    }).where(eq(sampleOrders.id, order.id)).returning();
    const note = `${fullyRefunded ? "Refunded" : "Partially refunded"} ${formatMoney(refund.amountCents)}${refund.reason ? `: ${refund.reason}` : ""}`;
    await recordOrderEvent(tx, {
      order: updated,
      actorRole: refund.initiatedByRole === "admin" ? "payment_system" : "manufacturer",
      actorClerkId: refund.initiatedBy,
      fromStatus: locked.status,
      toStatus: updated.status,
      note,
    });
    await postThreadSystemMessage(tx, {
      threadId: order.threadId,
      content: `${note}. The money goes back to the original payment method${refund.method === "wallet_reversal" ? " (the drop wallet)" : ""}.`,
      notify: "both",
      dedupeKey: `b2b-refund:${refund.id}`,
    });
    return { refund: done, finalized: true, order: updated };
  });

  const [fresh] = await db.select().from(sampleOrders).where(eq(sampleOrders.id, order.id)).limit(1);
  if (result.finalized && input.notify) {
    const [mfr] = await db.select({ clerkId: manufacturers.clerkId, businessName: manufacturers.businessName })
      .from(manufacturers).where(eq(manufacturers.id, order.manufacturerId)).limit(1);
    const targetType = order.orderType === "bulk" ? "bulk_order" : "sample_order";
    const amount = formatMoney(refund.amountCents);
    await input.notify({
      userId: order.sellerId, category: "production", type: "manufacturer_order_refunded",
      title: `Refund issued: ${amount}`,
      body: `${mfr?.businessName ?? "The manufacturer"} refunded ${amount} for "${order.title}". It returns to your ${refund.method === "wallet_reversal" ? "drop wallet" : "original payment method"}.`,
      targetId: order.id, targetType, cta: `/production-detail?id=${order.id}`,
    }).catch((err) => logger.error({ err, orderId: order.id }, "Refund notification (seller) failed"));
    if (mfr?.clerkId && refund.initiatedByRole !== "manufacturer") {
      await input.notify({
        userId: mfr.clerkId, category: "production", type: "manufacturer_order_refunded",
        title: `Refund issued: ${amount}`,
        body: `"${order.title}" was refunded ${amount}${refund.initiatedByRole === "admin" ? " by Brandthread support" : ""}.`,
        targetId: order.id, targetType, cta: `/manufacturers/orders/${order.id}`,
      }).catch((err) => logger.error({ err, orderId: order.id }, "Refund notification (manufacturer) failed"));
    }
  }
  return { refund: result.refund!, order: fresh, replayed: !result.finalized };
}
