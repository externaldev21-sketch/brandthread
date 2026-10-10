/**
 * Admin → money actions and money dashboards (Revenue P1 4/7).
 * Every state change is written to the admin audit log in the same
 * transaction, and every money action is idempotent.
 *
 * GET  /api/admin/mrr?days=30                          subscriptions: MRR by tier, active, trialing, conversions, churn
 * GET  /api/admin/thread-cash/summary?days=30          issued / redeemed / expired / outstanding, per day, top earners
 * POST /api/admin/thread-cash/pause                    { kind: 'rewards'|'checkout', paused: boolean }
 * POST /api/admin/orders/:id/refund                    { amountCents?, reason, note?, idempotencyKey }
 * GET  /api/admin/disputes/:id                         dispute with evidence and files
 * POST /api/admin/disputes/:id/evidence                { type, description } (draft, not submitted)
 * POST /api/admin/disputes/:id/evidence/upload         raw JPEG/PNG/PDF body, ?type=&filename=
 * POST /api/admin/disputes/:id/submit                  sends the evidence to the bank (once)
 * GET  /api/admin/payouts/review?state=review|held|all new and held connected accounts with balances
 * POST /api/admin/payouts/:partyType/:partyId/hold     { reason }
 * POST /api/admin/payouts/:partyType/:partyId/release  { reason? }
 * GET  /api/admin/risk                                 high-risk orders, fast new sellers, Thread Cash anomalies
 */
import express, { Router } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, disputeEvents, disputeEvidenceFiles, disputes, orders } from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { computeMrr } from "../../lib/admin/revenue";
import { threadCashSummary } from "../../lib/admin/threadCashSummary";
import { isThreadCashPauseKind, setThreadCashPaused } from "../../lib/threadCash/killSwitch";
import { refundOrder, RefundError, type RefundReason } from "../../lib/money/refunds";
import {
  EVIDENCE_FILE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, buildEvidencePayload, evidenceAlreadySubmitted, isFinalDisputeStatus,
} from "../../lib/disputes/evidence";
import { processEvidenceUpload } from "../../lib/disputes/upload";
import { mapDisputeStatus } from "../../lib/disputes/webhook";
import { uploadDeps } from "../disputes";
import { stripe } from "../../lib/stripe";
import {
  PayoutControlError, holdPayouts, isPayoutPartyType, payoutReviewList, releasePayouts,
} from "../../lib/admin/payoutControls";
import { riskQueue } from "../../lib/admin/risk";
import { UUID_RE, bodyString, clampDays, queryString } from "./util";

const router = Router();

// ─── Subscriptions ───────────────────────────────────────────────────────────

router.get("/mrr", async (req, res) => {
  try {
    return res.json(await computeMrr(clampDays(req)));
  } catch (err) {
    req.log.error({ err }, "Admin MRR failed");
    return res.status(500).json({ error: "Could not load subscriptions." });
  }
});

// ─── Thread Cash ─────────────────────────────────────────────────────────────

router.get("/thread-cash/summary", async (req, res) => {
  try {
    return res.json(await threadCashSummary(clampDays(req)));
  } catch (err) {
    req.log.error({ err }, "Admin Thread Cash summary failed");
    return res.status(500).json({ error: "Could not load Thread Cash." });
  }
});

router.post("/thread-cash/pause", async (req, res) => {
  const { kind, paused } = (req.body ?? {}) as { kind?: unknown; paused?: unknown };
  if (!isThreadCashPauseKind(kind)) return res.status(400).json({ error: "kind must be rewards or checkout" });
  if (typeof paused !== "boolean") return res.status(400).json({ error: "paused must be true or false" });
  const actor = actorOf(req);
  try {
    const previous = await db.transaction(async (tx) => {
      const was = await setThreadCashPaused(kind, paused, actor.clerkId, tx);
      if (was !== paused) {
        await recordAdminAction(actor, {
          action: paused ? "thread_cash.pause" : "thread_cash.resume",
          targetType: "thread_cash", targetId: kind,
          summary: `${paused ? "Paused" : "Resumed"} ${kind === "rewards" ? "daily Thread Cash rewards" : "Thread Cash at checkout"}`,
          metadata: { kind, paused, previous: was },
        }, tx);
      }
      return was;
    });
    return res.json({ ok: true, kind, paused, changed: previous !== paused });
  } catch (err) {
    req.log.error({ err }, "Admin Thread Cash pause failed");
    return res.status(500).json({ error: "Could not change the switch." });
  }
});

// ─── Refunds ─────────────────────────────────────────────────────────────────

const ADMIN_REFUND_REASONS: Record<string, RefundReason> = {
  requested_by_buyer: "buyer_cancelled",
  not_delivered: "not_delivered",
  seller_cancelled: "seller_cancelled",
  return_approved: "return_approved",
};
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{8,80}$/;

router.post("/orders/:id/refund", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Order not found" });
  const body = (req.body ?? {}) as { amountCents?: unknown; reason?: unknown; idempotencyKey?: unknown };
  const reason = typeof body.reason === "string" ? ADMIN_REFUND_REASONS[body.reason] : undefined;
  if (!reason) return res.status(400).json({ error: `reason must be one of ${Object.keys(ADMIN_REFUND_REASONS).join(", ")}` });
  if (typeof body.idempotencyKey !== "string" || !IDEMPOTENCY_RE.test(body.idempotencyKey)) {
    return res.status(400).json({ error: "A valid idempotencyKey is required." });
  }
  let amountCents: number | undefined;
  if (body.amountCents !== undefined && body.amountCents !== null) {
    if (!Number.isSafeInteger(body.amountCents) || (body.amountCents as number) <= 0) {
      return res.status(400).json({ error: "amountCents must be a positive whole number of cents" });
    }
    amountCents = body.amountCents as number;
  }
  const note = bodyString(req.body, "note", 500);
  const actor = actorOf(req);
  try {
    const result = await refundOrder({
      orderId: id,
      amountCents,
      reason,
      initiatedBy: `admin:${actor.clerkId}`,
      idempotencyKey: `admin-refund/${id}/${body.idempotencyKey}`,
      onSucceeded: async (tx, r) => {
        await recordAdminAction(actor, {
          action: "order.refund", targetType: "order", targetId: id,
          summary: `Refunded ${(r.amountCents / 100).toFixed(2)} on order #${r.order.order_number}${note ? `: ${note}` : ""}`,
          metadata: { amountCents: r.amountCents, reason: body.reason, refundId: r.refundId, note: note || null },
        }, tx);
      },
    });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RefundError) return res.status(err.status).json({ error: err.message, code: err.code });
    req.log.error({ err, id }, "Admin refund failed");
    return res.status(502).json({ error: "Stripe couldn't process the refund. Nothing was charged back; try again." });
  }
});

// ─── Disputes ────────────────────────────────────────────────────────────────

async function loadDispute(id: string) {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(disputes).where(eq(disputes.id, id)).limit(1);
  return row ?? null;
}

router.get("/disputes/:id", async (req, res) => {
  try {
    const row = await loadDispute(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Dispute not found" });
    const [files, events, [order]] = await Promise.all([
      db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id)),
      db.select().from(disputeEvents).where(eq(disputeEvents.disputeId, row.id)).orderBy(desc(disputeEvents.createdAt)),
      row.orderId ? db.select({ orderNumber: orders.orderNumber, totalCents: orders.totalCents }).from(orders).where(eq(orders.id, row.orderId)).limit(1) : [],
    ]);
    return res.json({
      id: row.id,
      stripeDisputeId: row.stripeDisputeId,
      orderId: row.orderId,
      orderNumber: order?.orderNumber ?? null,
      sellerId: row.sellerId,
      amountCents: row.amountCents,
      reason: row.reason,
      status: row.status,
      customerClaim: row.customerClaim,
      evidenceDueBy: row.evidenceDueBy?.toISOString() ?? null,
      evidenceSubmittedAt: row.evidenceSubmittedAt?.toISOString() ?? null,
      evidence: (row.evidenceJson as any[]) ?? [],
      files: files.map((f) => ({ id: f.id, evidenceType: f.evidenceType, fileName: f.fileName, sizeBytes: f.sizeBytes, uploadedAt: f.createdAt.toISOString() })),
      events: events.map((e) => ({ kind: e.kind, at: e.createdAt.toISOString() })),
      canAddEvidence: !isFinalDisputeStatus(row.status) && !evidenceAlreadySubmitted(row),
    });
  } catch (err) {
    req.log.error({ err }, "Admin dispute detail failed");
    return res.status(500).json({ error: "Could not load this dispute." });
  }
});

const TEXT_EVIDENCE_TYPES = ["written_response", "policy", "other"] as const;

router.post("/disputes/:id/evidence", async (req, res) => {
  const type = bodyString(req.body, "type", 40);
  const description = bodyString(req.body, "description", 5000);
  if (!(TEXT_EVIDENCE_TYPES as readonly string[]).includes(type)) return res.status(400).json({ error: "Choose an evidence type." });
  if (!description) return res.status(400).json({ error: "Describe the evidence." });
  try {
    const row = await loadDispute(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Dispute not found" });
    if (isFinalDisputeStatus(row.status)) return res.status(400).json({ error: "This dispute is closed." });
    if (evidenceAlreadySubmitted(row)) return res.status(409).json({ error: "Evidence was already submitted. Stripe allows one submission." });
    const item = { id: `ev_${Date.now()}`, disputeId: row.id, type, description, submittedAt: new Date().toISOString(), addedBy: "admin" };
    const evidence = [...(((row.evidenceJson as any[]) ?? [])), item];
    const files = await db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));
    if (stripe && row.stripeDisputeId) {
      // Draft only: the bank sees nothing until /submit.
      await stripe.disputes.update(row.stripeDisputeId, { evidence: buildEvidencePayload(evidence, files), submit: false });
    }
    await db.transaction(async (tx) => {
      await tx.update(disputes).set({ evidenceJson: evidence, updatedAt: new Date() }).where(eq(disputes.id, row.id));
      await recordAdminAction(actorOf(req), {
        action: "dispute.evidence_add", targetType: "dispute", targetId: row.id,
        summary: `Added ${type.replaceAll("_", " ")} evidence`, metadata: { type, length: description.length },
      }, tx);
    });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    req.log.error({ err }, "Admin dispute evidence failed");
    return res.status(502).json({ error: "Stripe couldn't save this evidence. Try again." });
  }
});

router.post(
  "/disputes/:id/evidence/upload",
  express.raw({ type: [...EVIDENCE_FILE_MIME_TYPES], limit: MAX_EVIDENCE_FILE_BYTES }),
  async (req, res) => {
    try {
      const row = await loadDispute(String(req.params.id));
      if (!row) return res.status(404).json({ error: "Dispute not found" });
      const existingFiles = await db.select({ evidenceType: disputeEvidenceFiles.evidenceType })
        .from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));
      const result = await processEvidenceUpload({
        dispute: row, existingFiles, contentType: req.get("content-type") ?? undefined, bytes: req.body,
        evidenceType: req.query.type, fileName: req.query.filename,
      }, uploadDeps(req.log));
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      await recordAdminAction(actorOf(req), {
        action: "dispute.evidence_upload", targetType: "dispute", targetId: row.id,
        summary: `Uploaded ${result.file.evidenceType.replaceAll("_", " ")} file`, metadata: { fileId: result.file.id, sizeBytes: result.file.sizeBytes },
      });
      return res.status(201).json({ file: { id: result.file.id, evidenceType: result.file.evidenceType, fileName: result.file.fileName } });
    } catch (err) {
      req.log.error({ err }, "Admin dispute upload failed");
      return res.status(500).json({ error: "Could not upload this file." });
    }
  },
);

router.post("/disputes/:id/submit", async (req, res) => {
  try {
    const row = await loadDispute(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Dispute not found" });
    if (evidenceAlreadySubmitted(row)) return res.json({ ok: true, duplicate: true, status: row.status });
    if (isFinalDisputeStatus(row.status)) return res.status(400).json({ error: "This dispute is closed." });
    if (!stripe || !row.stripeDisputeId) return res.status(503).json({ error: "Stripe is unavailable" });
    const files = await db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));
    const payload = buildEvidencePayload(((row.evidenceJson as any[]) ?? []), files);
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: "Add evidence before submitting." });
    // Stripe allows exactly one submission: claim it first so two clicks (or
    // the seller and an admin at once) can't both send.
    const [claimed] = await db.update(disputes).set({ evidenceSubmittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(disputes.id, row.id), isNull(disputes.evidenceSubmittedAt))).returning({ id: disputes.id });
    if (!claimed) return res.json({ ok: true, duplicate: true, status: row.status });
    let updated;
    try {
      updated = await stripe.disputes.update(row.stripeDisputeId, { evidence: payload, submit: true });
    } catch (err) {
      await db.update(disputes).set({ evidenceSubmittedAt: null }).where(eq(disputes.id, row.id));
      throw err;
    }
    const status = mapDisputeStatus(updated.status);
    await db.transaction(async (tx) => {
      await tx.update(disputes).set({ status, updatedAt: new Date() }).where(eq(disputes.id, row.id));
      await tx.insert(disputeEvents).values({
        disputeId: row.id, stripeEventId: `local-submit/${row.id}`, kind: "evidence_submitted", payload: { status: updated.status, by: "admin" },
      }).onConflictDoNothing({ target: disputeEvents.stripeEventId });
      await recordAdminAction(actorOf(req), {
        action: "dispute.submit", targetType: "dispute", targetId: row.id,
        summary: "Submitted dispute evidence to the bank", metadata: { fields: Object.keys(payload) },
      }, tx);
    });
    return res.json({ ok: true, duplicate: false, status });
  } catch (err) {
    req.log.error({ err }, "Admin dispute submit failed");
    return res.status(502).json({ error: "Stripe didn't accept the submission. Nothing was sent; try again." });
  }
});

// ─── Payout holds and review ─────────────────────────────────────────────────

router.get("/payouts/review", async (req, res) => {
  const state = queryString(req, "state") || "review";
  if (!["review", "held", "all"].includes(state)) return res.status(400).json({ error: "state must be review, held or all" });
  try {
    return res.json(await payoutReviewList({ state: state as "review" | "held" | "all" }));
  } catch (err) {
    req.log.error({ err }, "Admin payout review failed");
    return res.status(500).json({ error: "Could not load payout review." });
  }
});

router.post("/payouts/:partyType/:partyId/:action", async (req, res) => {
  const partyType = String(req.params.partyType);
  const partyId = String(req.params.partyId);
  const action = String(req.params.action);
  if (action !== "hold" && action !== "release") return res.status(404).json({ error: "Not found" });
  if (!isPayoutPartyType(partyType)) return res.status(404).json({ error: "Unknown account type" });
  const reason = bodyString(req.body, "reason", 500);
  if (action === "hold" && !reason) return res.status(400).json({ error: "A reason is required to hold payouts." });
  try {
    const fn = action === "hold" ? holdPayouts : releasePayouts;
    return res.json(await fn({ partyType, partyId, reason, actor: actorOf(req) }));
  } catch (err) {
    if (err instanceof PayoutControlError) return res.status(err.status).json({ error: err.message, code: err.code });
    req.log.error({ err, partyType, partyId, action }, "Admin payout control failed");
    return res.status(502).json({ error: "Stripe didn't accept the change. Nothing was changed; try again." });
  }
});

// ─── Risk ────────────────────────────────────────────────────────────────────

router.get("/risk", async (req, res) => {
  try {
    return res.json(await riskQueue());
  } catch (err) {
    req.log.error({ err }, "Admin risk queue failed");
    return res.status(500).json({ error: "Could not load the risk queue." });
  }
});

export default router;
