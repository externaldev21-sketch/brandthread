/**
 * Stripe dispute webhook processing.
 *
 * Every step is idempotent on its own, so a replayed or retried event never
 * duplicates a timeline row, a ledger posting or a notification, and a retry
 * after a partial failure finishes the steps that did not complete:
 *   1. upsert the dispute row (created may arrive after updated),
 *   2. write the dispute_events row (unique on the Stripe event id),
 *   3. apply the status change (a final status is never downgraded),
 *   4. post the ledger effect (idempotency key per event),
 *   5. notify the seller once (claimed on dispute_events.notified_at).
 * Dependencies are injected so the flow is unit-testable without a database.
 */
import type { DisputeEventKind } from "@workspace/db";
import { buildDisputeNotification, disputeDeepLink, disputeNotificationType, type DisputeNotificationKind } from "./notifications";
import { isFinalDisputeStatus } from "./evidence";

export function mapDisputeStatus(s: string): string {
  switch (s) {
    case "needs_response": return "needs_response";
    case "under_review": return "under_review";
    case "warning_needs_response": return "needs_response";
    case "warning_under_review": return "under_review";
    case "warning_closed": return "closed";
    case "charge_refunded": return "closed";
    case "won": return "won";
    case "lost": return "lost";
    default: return s;
  }
}

const REASON_LABELS: Record<string, string> = {
  credit_not_processed: "Customer claims they did not receive a refund.",
  duplicate: "Customer claims this is a duplicate charge.",
  fraudulent: "Customer reports this as an unauthorized charge.",
  general: "Customer filed a general dispute.",
  product_not_received: "Customer claims the product was not received.",
  product_unacceptable: "Customer claims the product was defective or not as described.",
  subscription_canceled: "Customer claims they canceled their subscription.",
  unrecognized: "Customer does not recognize this charge.",
};

export type DisputeRowLike = {
  id: string;
  stripeDisputeId: string;
  orderId: string | null;
  sellerId: string;
  amountCents: number;
  currency: string;
  status: string;
  evidenceDueBy: Date | null;
  evidenceSubmittedAt: Date | null;
};

export type InsertDispute = {
  stripeDisputeId: string;
  stripeChargeId: string | null;
  stripePaymentIntentId: string | null;
  orderId: string | null;
  sellerId: string;
  amountCents: number;
  currency: string;
  reason: string | null;
  status: string;
  evidenceDueBy: Date | null;
  stripeEvidenceDetails: Record<string, unknown>;
  isChargeRefundable: boolean;
  networkReasonCode: string | null;
  customerClaim: string;
};

export type EventRow = { id: string; inserted: boolean; notifiedAt: Date | null };

export interface DisputeStore {
  resolveSellerAndOrder(paymentIntentId: string | null, chargeId: string | null): Promise<{ sellerId: string; orderId: string | null }>;
  /** Insert if the Stripe dispute is new; always return the stored row. */
  upsertDispute(values: InsertDispute): Promise<DisputeRowLike>;
  updateDispute(id: string, patch: {
    status?: string;
    evidenceDueBy?: Date | null;
    stripeEvidenceDetails?: Record<string, unknown>;
  }): Promise<void>;
  hasEvent(disputeId: string, kind: DisputeEventKind): Promise<boolean>;
  /** Time of the newest status-changing event already recorded, if any. */
  latestStatusEventAt(disputeId: string): Promise<Date | null>;
  insertEvent(row: {
    disputeId: string;
    stripeEventId: string;
    kind: DisputeEventKind;
    payload: Record<string, unknown>;
    occurredAt: Date;
  }): Promise<EventRow>;
  claimNotification(eventRowId: string): Promise<boolean>;
  releaseNotification(eventRowId: string): Promise<void>;
  orderNumber(orderId: string | null): Promise<string | null>;
}

export interface DisputeDeps {
  store: DisputeStore;
  ledger: {
    withdraw(input: {
      stripeDisputeId: string; stripeEventId: string; orderId: string | null;
      amountCents: number; chargeId: string | null; occurredAt: Date;
    }): Promise<unknown>;
    reinstate(input: { stripeDisputeId: string; occurredAt: Date }): Promise<unknown>;
  };
  notify(n: {
    userId: string; category: string; type: string; title: string; body: string;
    targetId: string; targetType: string; cta: string;
  }): Promise<void>;
  log?: { info(obj: object, msg: string): void; warn(obj: object, msg: string): void };
}

type StripeEventLike = { id: string; type: string; created?: number; data: { object: any } };

function ref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/** The fee Stripe charged for the dispute, if the payload carries it. Stored, not posted. */
export function disputeFeeCents(dispute: any): number | null {
  const txns = Array.isArray(dispute?.balance_transactions) ? dispute.balance_transactions : [];
  const total = txns.reduce((sum: number, t: any) => sum + (Number.isFinite(t?.fee) ? t.fee : 0), 0);
  return total > 0 ? total : null;
}

function safePayload(dispute: any, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    status: dispute.status ?? null,
    reason: dispute.reason ?? null,
    amountCents: dispute.amount ?? null,
    currency: dispute.currency ?? null,
    ...extra,
  };
  const fee = disputeFeeCents(dispute);
  if (fee !== null) out.feeCents = fee;
  const dueBy = dispute.evidence_details?.due_by;
  if (typeof dueBy === "number") out.evidenceDueBy = new Date(dueBy * 1000).toISOString();
  return out;
}

export const DISPUTE_EVENT_TYPES = [
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
] as const;

export async function processDisputeEvent(event: StripeEventLike, deps: DisputeDeps): Promise<{ handled: boolean; duplicate: boolean }> {
  if (!(DISPUTE_EVENT_TYPES as readonly string[]).includes(event.type)) return { handled: false, duplicate: false };
  const { store } = deps;
  const d = event.data.object;
  if (!d || typeof d.id !== "string") return { handled: false, duplicate: false };
  const occurredAt = new Date((event.created ?? Math.floor(Date.now() / 1000)) * 1000);
  const dueBy = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
  const paymentIntentId = ref(d.payment_intent);
  const chargeId = ref(d.charge);
  const mappedStatus = mapDisputeStatus(d.status ?? "needs_response");

  // 1. Dispute row.
  const { sellerId, orderId } = await store.resolveSellerAndOrder(paymentIntentId, chargeId);
  const dispute = await store.upsertDispute({
    stripeDisputeId: d.id,
    stripeChargeId: chargeId,
    stripePaymentIntentId: paymentIntentId,
    orderId,
    sellerId,
    amountCents: d.amount ?? 0,
    currency: d.currency ?? "usd",
    reason: d.reason ?? null,
    status: mappedStatus,
    evidenceDueBy: dueBy,
    stripeEvidenceDetails: d.evidence_details ?? {},
    isChargeRefundable: d.is_charge_refundable ?? true,
    networkReasonCode: d.network_reason_code ?? null,
    customerClaim: REASON_LABELS[d.reason] ?? `Dispute filed: ${d.reason}`,
  });

  // 2. Timeline row. The kind depends on the event and what we already know.
  let kind: DisputeEventKind;
  switch (event.type) {
    case "charge.dispute.created": kind = "created"; break;
    case "charge.dispute.funds_withdrawn": kind = "funds_withdrawn"; break;
    case "charge.dispute.funds_reinstated": kind = "funds_reinstated"; break;
    case "charge.dispute.closed":
      kind = d.status === "won" ? "won" : d.status === "lost" ? "lost"
        : d.status === "warning_closed" ? "warning_closed" : "updated";
      break;
    default:
      kind = mappedStatus === "under_review" && !dispute.evidenceSubmittedAt
        && !(await store.hasEvent(dispute.id, "evidence_submitted"))
        ? "evidence_submitted" : "updated";
  }
  const latestStatusAt = await store.latestStatusEventAt(dispute.id);
  const stale = !!latestStatusAt && occurredAt.getTime() < latestStatusAt.getTime();
  const eventRow = await store.insertEvent({
    disputeId: dispute.id,
    stripeEventId: event.id,
    kind,
    payload: safePayload(d),
    occurredAt,
  });

  // 3. Status. Never move a finished dispute back to an open state, and ignore
  // a stale status when we already know a newer one.
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated" || event.type === "charge.dispute.closed") {
    const downgrade = isFinalDisputeStatus(dispute.status) && !isFinalDisputeStatus(mappedStatus);
    if (!downgrade && !stale) {
      await store.updateDispute(dispute.id, {
        status: mappedStatus,
        evidenceDueBy: dueBy,
        stripeEvidenceDetails: d.evidence_details ?? {},
      });
    }
  }

  // 4. Ledger. Keyed per event / per withdrawal, so a replay posts nothing.
  if (event.type === "charge.dispute.funds_withdrawn") {
    if (dispute.orderId) {
      await deps.ledger.withdraw({
        stripeDisputeId: d.id, stripeEventId: event.id, orderId: dispute.orderId,
        amountCents: d.amount ?? dispute.amountCents, chargeId, occurredAt,
      });
    } else {
      deps.log?.warn({ stripeDisputeId: d.id }, "Dispute funds withdrawn for a charge with no matching order; no ledger entry");
    }
  } else if (event.type === "charge.dispute.funds_reinstated") {
    await deps.ledger.reinstate({ stripeDisputeId: d.id, occurredAt });
  }

  // 5. Notification, once. Unknown sellers have nobody to tell.
  const notifyKind: DisputeNotificationKind | null =
    kind === "created" ? "created" : kind === "won" ? "won" : kind === "lost" ? "lost" : null;
  if (notifyKind && dispute.sellerId !== "unknown" && !eventRow.notifiedAt) {
    if (await store.claimNotification(eventRow.id)) {
      try {
        const copy = buildDisputeNotification(notifyKind, {
          amountCents: dispute.amountCents,
          currency: dispute.currency,
          orderNumber: await store.orderNumber(dispute.orderId),
          evidenceDueBy: dispute.evidenceDueBy ?? dueBy,
          isInquiry: typeof d.status === "string" && d.status.startsWith("warning_"),
        });
        await deps.notify({
          userId: dispute.sellerId,
          category: "dispute",
          type: disputeNotificationType(notifyKind),
          title: copy.title,
          body: copy.body,
          targetId: dispute.id,
          targetType: "dispute",
          cta: disputeDeepLink(dispute.id),
        });
      } catch (err) {
        await store.releaseNotification(eventRow.id);
        throw err;
      }
    }
  }

  deps.log?.info({ stripeDisputeId: d.id, eventType: event.type, kind, duplicate: !eventRow.inserted }, "Dispute event processed");
  return { handled: true, duplicate: !eventRow.inserted };
}
