/**
 * Chargebacks on B2B payments (BT-459): sample/bulk order cards (destination
 * charges paid to a manufacturer) and freelancer jobs (platform charges paid
 * out to the freelancer by transfer).
 *
 * Stripe takes a disputed amount (plus its dispute fee) from Brandthread's
 * balance, but the manufacturer / freelancer already has — or is about to
 * get — the money. So:
 *  - dispute opened  → the dispute is recorded (admin disputes list); a
 *    freelancer job's payout is frozen (payment_status 'disputed', which the
 *    payout route refuses). Sample cards are already put on payment review by
 *    the existing webhook handler.
 *  - dispute won     → the freeze is lifted / the card returns to its stage.
 *  - dispute lost    → the payee's transfer is reversed for the disputed
 *    amount (stripe.transfers.createReversal), ledger legs are posted
 *    (including Stripe's dispute fee) and the payee is told.
 * Every step is idempotent (dispute row, timeline event id, reversal key,
 * ledger key), so webhook retries are safe.
 */
import {
  type DisputeEventKind, db, disputeEvents, disputes, freelancerJobs, freelancers, manufacturerActivityEvents, manufacturerOrderEvents, manufacturers, sampleOrders,
} from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { formatMoney, manufacturerNetCents } from "@workspace/manufacturer-flow";
import { requireStripe } from "../stripe";
import { postLedgerTransaction, type LedgerPosting } from "../money/ledger";
import { disputeFeeCents, mapDisputeStatus } from "../disputes/webhook";
import { logger } from "../logger";

/** When true the payee's reversal also covers Stripe's dispute fee. Default: Brandthread absorbs the fee. */
export const B2B_CHARGEBACK_RECOVERS_DISPUTE_FEE = false;

type Notify = (n: {
  userId: string; category: string; type: string; title: string; body: string;
  targetId: string; targetType: string; cta: string;
}) => Promise<unknown>;
type StripeEventLike = { id: string; type: string; created?: number; data: { object: any } };
export type B2bDisputeTarget =
  | { kind: "sample_order"; order: typeof sampleOrders.$inferSelect; payeeClerkId: string | null }
  | { kind: "freelancer_job"; job: typeof freelancerJobs.$inferSelect; payeeClerkId: string | null };

function ref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return (value as { id: string }).id;
  return null;
}

export async function findB2bDisputeTarget(paymentIntentId: string | null, chargeId: string | null): Promise<B2bDisputeTarget | null> {
  let pi = paymentIntentId;
  if (chargeId) {
    const [byCharge] = await db.select({ order: sampleOrders, clerkId: manufacturers.clerkId }).from(sampleOrders)
      .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
      .where(eq(sampleOrders.stripeChargeId, chargeId)).limit(1);
    if (byCharge) return { kind: "sample_order", order: byCharge.order, payeeClerkId: byCharge.clerkId };
  }
  if (!pi && chargeId) {
    const charge: any = await Promise.resolve().then(() => requireStripe().charges.retrieve(chargeId)).catch(() => null);
    pi = ref(charge?.payment_intent);
  }
  if (!pi) return null;
  const [order] = await db.select({ order: sampleOrders, clerkId: manufacturers.clerkId }).from(sampleOrders)
    .leftJoin(manufacturers, eq(sampleOrders.manufacturerId, manufacturers.id))
    .where(eq(sampleOrders.stripePaymentIntentId, pi)).limit(1);
  if (order) return { kind: "sample_order", order: order.order, payeeClerkId: order.clerkId };
  const [job] = await db.select({ job: freelancerJobs, clerkId: freelancers.userId }).from(freelancerJobs)
    .leftJoin(freelancers, eq(freelancerJobs.freelancerId, freelancers.id))
    .where(eq(freelancerJobs.stripePaymentIntentId, pi)).limit(1);
  if (job) return { kind: "freelancer_job", job: job.job, payeeClerkId: job.clerkId };
  return null;
}

/**
 * The money legs of a lost B2B chargeback. A = disputed amount returned to
 * the payer, F = Stripe's dispute fee, R = recovered from the payee by
 * transfer reversal, E = covered by job escrow Brandthread never paid out.
 * Whatever is not recovered is Brandthread's loss (platform_revenue).
 */
export function chargebackPostings(input: {
  kind: "sample_order" | "freelancer_job";
  payerId: string;
  payeeId: string;
  disputedCents: number;
  disputeFeeCents: number;
  recoveredCents: number;
  escrowCoveredCents: number;
}): LedgerPosting[] {
  const { disputedCents: a, disputeFeeCents: f, recoveredCents: r, escrowCoveredCents: e } = input;
  return [
    { account: "seller_card_payments", partyId: input.payerId, amountCents: a },
    { account: "b2b_dispute_fees", amountCents: f },
    { account: input.kind === "sample_order" ? "manufacturer_paid" : "freelancer_paid", partyId: input.payeeId, amountCents: -r },
    { account: "freelancer_escrow", amountCents: -e },
    { account: "platform_revenue", amountCents: -(a + f - r - e) },
  ];
}

/** Maximum to claw back from the payee for a lost dispute. */
export function clawbackCents(target: B2bDisputeTarget, disputedCents: number, feeCents: number): number {
  const wanted = disputedCents + (B2B_CHARGEBACK_RECOVERS_DISPUTE_FEE ? feeCents : 0);
  if (target.kind === "sample_order") {
    // Wallet-paid bulk is funded by many buyers, not a disputable card charge.
    if (target.order.walletId) return 0;
    return Math.max(0, Math.min(wanted, manufacturerNetCents(target.order)));
  }
  if (!target.job.stripeTransferId) return 0;
  return Math.max(0, Math.min(wanted, target.job.freelancerPayoutCents));
}

async function destinationTransferId(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const intent: any = await requireStripe().paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = intent?.latest_charge && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  return ref(charge?.transfer);
}

function eventKind(event: StripeEventLike): DisputeEventKind {
  const d = event.data.object;
  switch (event.type) {
    case "charge.dispute.created": return "created";
    case "charge.dispute.funds_withdrawn": return "funds_withdrawn";
    case "charge.dispute.funds_reinstated": return "funds_reinstated";
    case "charge.dispute.closed":
      return d.status === "won" ? "won" : d.status === "lost" ? "lost" : d.status === "warning_closed" ? "warning_closed" : "updated";
    default: return "updated";
  }
}

/**
 * Handles a charge.dispute.* event when the charge is a sample/bulk card or a
 * freelancer job. Returns which kind it was, or null for any other charge
 * (the caller then runs the retail dispute processor).
 */
export async function processB2bDisputeEvent(event: StripeEventLike, notify: Notify): Promise<B2bDisputeTarget["kind"] | null> {
  const d = event.data.object;
  if (!d || typeof d.id !== "string" || !event.type.startsWith("charge.dispute.")) return null;
  const paymentIntentId = ref(d.payment_intent);
  const chargeId = ref(d.charge);
  const target = await findB2bDisputeTarget(paymentIntentId, chargeId);
  if (!target) return null;

  const occurredAt = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const status = mapDisputeStatus(d.status ?? "needs_response");
  const amountCents = Number.isSafeInteger(d.amount) ? d.amount : 0;
  const ids = target.kind === "sample_order"
    ? { sampleOrderId: target.order.id, freelancerJobId: null }
    : { sampleOrderId: null, freelancerJobId: target.job.id };

  // 1. Dispute row: listed in the admin disputes list. The respondent is
  // Brandthread (sellerId 'unknown' keeps it out of every seller's own list).
  await db.insert(disputes).values({
    stripeDisputeId: d.id,
    stripeChargeId: chargeId,
    stripePaymentIntentId: paymentIntentId,
    orderId: null,
    sellerId: "unknown",
    ...ids,
    amountCents,
    currency: d.currency ?? "usd",
    reason: d.reason ?? null,
    status,
    evidenceDueBy: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null,
    stripeEvidenceDetails: d.evidence_details ?? {},
    isChargeRefundable: d.is_charge_refundable ?? true,
    networkReasonCode: d.network_reason_code ?? null,
    customerClaim: `B2B ${target.kind === "sample_order" ? "order card" : "freelancer job"} dispute: ${d.reason ?? "unknown reason"}`,
  }).onConflictDoNothing({ target: disputes.stripeDisputeId });
  const [dispute] = await db.select().from(disputes).where(eq(disputes.stripeDisputeId, d.id)).limit(1);
  const finalStatus = ["won", "lost", "warning_closed", "charge_refunded"].includes(dispute.status);
  await db.update(disputes).set({
    ...ids,
    ...(finalStatus && !["won", "lost", "warning_closed", "charge_refunded"].includes(status) ? {} : { status }),
    updatedAt: new Date(),
  }).where(eq(disputes.id, dispute.id));
  const fee = disputeFeeCents(d) ?? 0;
  await db.insert(disputeEvents).values({
    disputeId: dispute.id,
    stripeEventId: event.id,
    kind: eventKind(event),
    payload: { status: d.status ?? null, reason: d.reason ?? null, amountCents, feeCents: fee, b2b: target.kind },
    occurredAt,
  }).onConflictDoNothing({ target: disputeEvents.stripeEventId });

  // 2. Freeze / unfreeze / claw back.
  if (event.type === "charge.dispute.created" && target.kind === "freelancer_job") {
    const [frozen] = await db.update(freelancerJobs).set({ paymentStatus: "disputed", updatedAt: new Date() })
      .where(and(eq(freelancerJobs.id, target.job.id), eq(freelancerJobs.paymentStatus, "paid")))
      .returning({ id: freelancerJobs.id });
    if (frozen && target.payeeClerkId && !target.job.stripeTransferId) {
      await notify({
        userId: target.payeeClerkId, category: "payments", type: "freelancer_payment_disputed",
        title: "Payout on hold",
        body: `The client disputed their payment for "${target.job.title}". The payout is on hold until the bank decides.`,
        targetId: target.job.id, targetType: "freelancer_job", cta: `/freelancer-jobs/${target.job.id}`,
      }).catch((err) => logger.error({ err, jobId: target.job.id }, "Freelancer dispute notification failed"));
    }
  }

  if (event.type === "charge.dispute.closed" && d.status === "won") {
    if (target.kind === "freelancer_job") {
      await db.update(freelancerJobs).set({ paymentStatus: "paid", updatedAt: new Date() })
        .where(and(eq(freelancerJobs.id, target.job.id), eq(freelancerJobs.paymentStatus, "disputed")));
    } else if (target.order.status === "payment_review") {
      await restoreSampleOrderAfterWin(target.order, d.id, amountCents);
    }
  }

  if (event.type === "charge.dispute.closed" && d.status === "lost") {
    await clawBack(target, dispute.id, d.id, amountCents, fee, notify);
  }

  logger.info({ stripeDisputeId: d.id, eventType: event.type, kind: target.kind }, "B2B dispute event processed");
  return target.kind;
}

async function restoreSampleOrderAfterWin(order: typeof sampleOrders.$inferSelect, stripeDisputeId: string, amountCents: number) {
  // The card goes back to the last production stage it reached.
  const [last] = await db.select({ toStatus: manufacturerOrderEvents.toStatus }).from(manufacturerOrderEvents)
    .where(and(eq(manufacturerOrderEvents.sampleOrderId, order.id), ne(manufacturerOrderEvents.toStatus, "payment_review"),
      ne(manufacturerOrderEvents.toStatus, "pending_payment"), ne(manufacturerOrderEvents.toStatus, "cancelled")))
    .orderBy(desc(manufacturerOrderEvents.createdAt)).limit(1);
  await db.transaction(async (tx) => {
    // Offset the payment_reversed the dispute recorded, so later refund
    // webhooks compute their deltas from the right base.
    const [offset] = await tx.insert(manufacturerActivityEvents).values({
      manufacturerId: order.manufacturerId,
      sampleOrderId: order.id,
      category: "payment",
      type: "payment_reversed",
      amountCents: -amountCents,
      providerEventId: `b2b-dispute-won:${stripeDisputeId}`,
      metadata: { source: "dispute_won", stripeDisputeId },
    }).onConflictDoNothing({ target: manufacturerActivityEvents.providerEventId }).returning({ id: manufacturerActivityEvents.id });
    if (!offset) return;
    await tx.update(sampleOrders).set({
      status: last?.toStatus ?? "payment_received",
      paymentReviewState: "none",
      updatedAt: new Date(),
      revision: sql`${sampleOrders.revision} + 1`,
    }).where(and(eq(sampleOrders.id, order.id), eq(sampleOrders.status, "payment_review")));
  });
}

async function clawBack(
  target: B2bDisputeTarget, disputeRowId: string, stripeDisputeId: string, disputedCents: number, feeCents: number, notify: Notify,
) {
  const recover = clawbackCents(target, disputedCents, feeCents);
  let reversalId: string | null = null;
  if (recover > 0) {
    const transferId = target.kind === "sample_order"
      ? await destinationTransferId(target.order.stripePaymentIntentId)
      : target.job.stripeTransferId;
    if (!transferId) throw new Error(`Lost B2B dispute ${stripeDisputeId} has no transfer to reverse`);
    const reversal: any = await requireStripe().transfers.createReversal(transferId, {
      amount: recover,
      metadata: { stripeDisputeId, reason: "chargeback_lost", ...(target.kind === "sample_order" ? { sampleOrderId: target.order.id } : { freelancerJobId: target.job.id }) },
    }, { idempotencyKey: `b2b-chargeback/${stripeDisputeId}` });
    reversalId = reversal.id;
  }
  const escrowCovered = target.kind === "freelancer_job" && !target.job.stripeTransferId ? disputedCents : 0;
  const payerId = target.kind === "sample_order" ? target.order.sellerId : target.job.sellerId;
  const payeeId = target.kind === "sample_order" ? target.order.manufacturerId : target.job.freelancerId;
  const posted = await db.transaction(async (tx) => {
    const { posted } = await postLedgerTransaction(tx, {
      idempotencyKey: `b2b-chargeback/${stripeDisputeId}`,
      kind: target.kind === "sample_order" ? "manufacturer_card_chargeback" : "freelancer_job_chargeback",
      sellerId: payerId,
      sampleOrderId: target.kind === "sample_order" ? target.order.id : null,
      stripeObjectId: reversalId ?? stripeDisputeId,
      memo: `Lost chargeback on a ${target.kind === "sample_order" ? "sample/bulk card" : "freelancer job"}; ${formatMoney(recover)} reversed from the payee`,
      postings: chargebackPostings({
        kind: target.kind, payerId, payeeId, disputedCents, disputeFeeCents: feeCents, recoveredCents: recover, escrowCoveredCents: escrowCovered,
      }),
    });
    await tx.update(disputes).set({ clawbackCents: recover, stripeTransferReversalId: reversalId, updatedAt: new Date() })
      .where(eq(disputes.id, disputeRowId));
    if (target.kind === "freelancer_job") {
      await tx.update(freelancerJobs).set({ paymentStatus: "charged_back", updatedAt: new Date() })
        .where(and(eq(freelancerJobs.id, target.job.id), ne(freelancerJobs.paymentStatus, "refunded")));
    } else {
      await tx.update(sampleOrders).set({ paymentReviewState: "reversed", updatedAt: new Date() })
        .where(eq(sampleOrders.id, target.order.id));
    }
    return posted;
  });
  if (posted && recover > 0 && target.payeeClerkId) {
    const title = target.kind === "sample_order" ? target.order.title : target.job.title;
    await notify({
      userId: target.payeeClerkId, category: target.kind === "sample_order" ? "production" : "payments",
      type: "b2b_chargeback_lost",
      title: "Chargeback lost",
      body: `The bank sided with the buyer on "${title}". ${formatMoney(recover)} was taken back from your payout.`,
      targetId: target.kind === "sample_order" ? target.order.id : target.job.id,
      targetType: target.kind === "sample_order" ? (target.order.orderType === "bulk" ? "bulk_order" : "sample_order") : "freelancer_job",
      cta: target.kind === "sample_order" ? `/manufacturers/orders/${target.order.id}` : `/freelancer-jobs/${target.job.id}`,
    }).catch((err) => logger.error({ err, stripeDisputeId }, "Chargeback notification failed"));
  }
}

/** B2B disputes for admin tools (the admin disputes list already includes them). */
export async function listB2bDisputes(limit = 50) {
  return db.select().from(disputes)
    .where(sql`${disputes.sampleOrderId} IS NOT NULL OR ${disputes.freelancerJobId} IS NOT NULL`)
    .orderBy(desc(disputes.createdAt)).limit(Math.min(Math.max(1, limit), 200));
}
