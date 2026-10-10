/**
 * Settling a paid sample/bulk card (BT-452, BT-454).
 *
 * Checkout fixes application_fee_amount = 5% + card processing estimate
 * before the seller picks a method. When the seller paid by US bank account
 * (ACH, only offered on bulk cards >= ACH_MIN_BULK_CENTS) the real processing
 * is lower (0.8%, capped at $5), so the excess application fee is returned to
 * the manufacturer once the debit succeeds. The ledger then records exactly
 * where the seller's money went: manufacturer net, Brandthread's 5%, and the
 * processing Brandthread pays Stripe on the manufacturer's behalf.
 *
 * ACH is asynchronous: checkout.session.completed arrives with
 * payment_status 'unpaid' (markB2bPaymentProcessing), then either
 * async_payment_succeeded (handled like a card payment) or
 * async_payment_failed (markB2bAsyncPaymentFailed: the card is payable again).
 */
import { db, manufacturerActivityEvents, manufacturers, sampleOrders } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { b2bFees, type B2bPaymentMethod } from "@workspace/manufacturer-flow";
import { requireStripe } from "../stripe";
import { postLedgerTransaction } from "../money/ledger";
import { logger } from "../logger";

type SampleOrder = typeof sampleOrders.$inferSelect;
type Notify = (n: {
  userId: string; category: string; type: string; title: string; body: string;
  targetId: string; targetType: string; cta: string;
}) => Promise<unknown>;

function ref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

async function findCardOrder(session: any) {
  const orderId = session?.metadata?.sampleOrderId;
  const [row] = await db.select({ order: sampleOrders, mfrClerkId: manufacturers.clerkId })
    .from(sampleOrders).leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(orderId ? eq(sampleOrders.id, orderId) : eq(sampleOrders.stripeCheckoutSessionId, session.id))
    .limit(1);
  return row ?? null;
}

/** The method the seller actually paid with. Only sessions that offered ACH need a lookup. */
async function paidMethod(session: any, paymentIntentId: string | null): Promise<{ method: B2bPaymentMethod; applicationFeeId: string | null }> {
  const offered: string[] = Array.isArray(session?.payment_method_types) ? session.payment_method_types : [];
  if (!offered.includes("us_bank_account") || !paymentIntentId) return { method: "card", applicationFeeId: null };
  const intent: any = await requireStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const type = charge?.payment_method_details?.type ?? (Array.isArray(intent?.payment_method_types) && intent.payment_method_types.length === 1 ? intent.payment_method_types[0] : null);
  return { method: type === "us_bank_account" ? "us_bank_account" : "card", applicationFeeId: ref(charge?.application_fee) };
}

/**
 * Idempotent: fixes the fees for the method used, returns any ACH fee excess
 * to the manufacturer, and posts the payment's ledger transaction once.
 */
export async function settleB2bCardPayment(order: SampleOrder, session: any, paymentIntentId: string | null): Promise<void> {
  // Cards whose Checkout opened before fees were fixed on the row (legacy):
  // Stripe kept only the 5%, so record exactly that.
  if (order.manufacturerNetCents == null) {
    const feeCents = Math.min(order.platformFeeCents, order.priceCents);
    await db.transaction((tx) => postLedgerTransaction(tx, {
      idempotencyKey: `manufacturer-card/${order.id}`,
      kind: "manufacturer_card_paid",
      sellerId: order.sellerId,
      sampleOrderId: order.id,
      stripeObjectId: paymentIntentId,
      memo: `${order.orderType === "bulk" ? "Bulk" : "Sample"} card paid by the seller's card`,
      postings: [
        { account: "seller_card_payments", partyId: order.sellerId, amountCents: -order.priceCents },
        { account: "manufacturer_paid", partyId: order.manufacturerId, amountCents: order.priceCents - feeCents },
        { account: "platform_revenue", amountCents: feeCents },
      ],
    }));
    return;
  }

  const { method, applicationFeeId } = await paidMethod(session, paymentIntentId);
  const fees = b2bFees({ priceCents: order.priceCents, method });
  const chargedApplicationFee = order.platformFeeCents + order.processingFeeEstimateCents;
  const excess = chargedApplicationFee - fees.applicationFeeCents;
  if (method === "us_bank_account" && excess > 0) {
    if (!applicationFeeId) throw new Error(`ACH payment for sample order ${order.id} has no application fee to adjust`);
    await requireStripe().applicationFees.createRefund(applicationFeeId, {
      amount: excess,
      metadata: { sampleOrderId: order.id, reason: "ach_processing_lower_than_card" },
    }, { idempotencyKey: `b2b-ach-fee-adjust/${order.id}` });
  }
  const settled = method === "us_bank_account" ? fees : {
    // Card: exactly what Checkout charged.
    ...fees,
    platformFeeCents: order.platformFeeCents,
    processingFeeEstimateCents: order.processingFeeEstimateCents,
    manufacturerNetCents: order.manufacturerNetCents,
  };
  await db.transaction(async (tx) => {
    await tx.update(sampleOrders).set({
      paymentMethodType: method,
      platformFeeCents: settled.platformFeeCents,
      processingFeeEstimateCents: settled.processingFeeEstimateCents,
      manufacturerNetCents: settled.manufacturerNetCents,
      paymentFailedAt: null,
      updatedAt: new Date(),
    }).where(eq(sampleOrders.id, order.id));
    const grossCents = settled.platformFeeCents + settled.processingFeeEstimateCents + settled.manufacturerNetCents;
    await postLedgerTransaction(tx, {
      idempotencyKey: `manufacturer-card/${order.id}`,
      kind: "manufacturer_card_paid",
      sellerId: order.sellerId,
      sampleOrderId: order.id,
      stripeObjectId: paymentIntentId,
      memo: `${order.orderType === "bulk" ? "Bulk" : "Sample"} card paid by the seller's ${method === "us_bank_account" ? "bank account (ACH)" : "card"}`,
      postings: [
        { account: "seller_card_payments", partyId: order.sellerId, amountCents: -grossCents },
        { account: "manufacturer_paid", partyId: order.manufacturerId, amountCents: settled.manufacturerNetCents },
        { account: "platform_revenue", amountCents: settled.platformFeeCents },
        // Processing recovered from the manufacturer and paid to Stripe. The
        // estimate-vs-actual difference is not tracked for B2B cards.
        { account: "stripe_processing_fees", amountCents: settled.processingFeeEstimateCents },
      ],
    });
  });
}

/**
 * checkout.session.completed with payment_status 'unpaid' for a sample/bulk
 * card: the seller started an ACH debit. The card stays awaiting payment.
 * Returns false when the session is not a B2B card.
 */
export async function markB2bPaymentProcessing(session: any, providerEventId: string, notify: Notify): Promise<boolean> {
  const row = await findCardOrder(session);
  if (!row) return false;
  if (row.order.status !== "pending_payment" || row.order.stripeCheckoutSessionId !== session.id) return true;
  await db.update(sampleOrders).set({ paymentMethodType: "us_bank_account", paymentFailedAt: null, updatedAt: new Date() })
    .where(and(eq(sampleOrders.id, row.order.id), eq(sampleOrders.status, "pending_payment")));
  const [recorded] = await db.insert(manufacturerActivityEvents).values({
    manufacturerId: row.order.manufacturerId,
    sampleOrderId: row.order.id,
    actorClerkId: row.order.sellerId,
    category: "payment",
    type: "payment_processing",
    amountCents: row.order.priceCents,
    providerEventId,
    metadata: { source: "stripe_checkout", sessionId: session.id, method: "us_bank_account" },
  }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId }).returning({ id: manufacturerActivityEvents.id });
  if (recorded && row.mfrClerkId) {
    await notify({
      userId: row.mfrClerkId, category: "production", type: "manufacturer_payment_processing",
      title: "Bank payment started",
      body: `The seller paid "${row.order.title}" by bank transfer. It usually clears in 4 business days; start production once it does.`,
      targetId: row.order.id, targetType: row.order.orderType === "bulk" ? "bulk_order" : "sample_order",
      cta: `/manufacturers/orders/${row.order.id}`,
    }).catch((err) => logger.error({ err, orderId: row.order.id }, "ACH processing notification failed"));
  }
  return true;
}

/**
 * checkout.session.async_payment_failed for a sample/bulk card: the ACH debit
 * bounced. The card is NOT paid; the failed session is detached so the seller
 * can pay again. Returns false when the session is not a B2B card.
 */
export async function markB2bAsyncPaymentFailed(session: any, providerEventId: string, notify: Notify): Promise<boolean> {
  const row = await findCardOrder(session);
  if (!row) return false;
  const [failed] = await db.update(sampleOrders).set({
    stripeCheckoutSessionId: null,
    checkoutSessionVersion: sql`${sampleOrders.checkoutSessionVersion} + 1`,
    paymentMethodType: null,
    paymentFailedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(sampleOrders.id, row.order.id),
    eq(sampleOrders.status, "pending_payment"),
    eq(sampleOrders.stripeCheckoutSessionId, session.id),
  )).returning({ id: sampleOrders.id });
  if (!failed) return true;
  await db.insert(manufacturerActivityEvents).values({
    manufacturerId: row.order.manufacturerId,
    sampleOrderId: row.order.id,
    actorClerkId: row.order.sellerId,
    category: "payment",
    type: "payment_failed",
    amountCents: row.order.priceCents,
    providerEventId,
    metadata: { source: "stripe_checkout", sessionId: session.id, method: "us_bank_account" },
  }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId });
  const targetType = row.order.orderType === "bulk" ? "bulk_order" : "sample_order";
  await notify({
    userId: row.order.sellerId, category: "production", type: "manufacturer_payment_failed",
    title: "Bank payment failed",
    body: `Your bank payment for "${row.order.title}" didn't go through. Pay the card again to start production.`,
    targetId: row.order.threadId ?? row.order.id,
    targetType: row.order.threadId ? "manufacturer_thread" : targetType,
    cta: row.order.threadId ? `/manufacturer-messages?threadId=${row.order.threadId}` : `/production-detail?id=${row.order.id}`,
  }).catch((err) => logger.error({ err, orderId: row.order.id }, "ACH failure notification failed"));
  if (row.mfrClerkId) {
    await notify({
      userId: row.mfrClerkId, category: "production", type: "manufacturer_payment_failed",
      title: "Bank payment failed",
      body: `The seller's bank payment for "${row.order.title}" failed. Don't start production; the card is waiting for payment again.`,
      targetId: row.order.id, targetType, cta: `/manufacturers/orders/${row.order.id}`,
    }).catch((err) => logger.error({ err, orderId: row.order.id }, "ACH failure notification failed"));
  }
  return true;
}
