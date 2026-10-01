/**
 * Disputes / Chargebacks API
 * Mounted at /api/disputes
 *
 * GET  /                    list disputes for this seller (newest first)
 * GET  /:id                 get one dispute with full evidence
 * POST /:id/evidence        submit evidence to Stripe
 * POST /:id/accept          accept dispute (concede, stop contesting)
 * POST /:id/evidence/upload upload a JPEG/PNG/PDF evidence file (raw body)
 * GET  /:id/timeline        status timeline: stored events merged with Stripe state
 */
import express, { Router } from "express";
import { db } from "@workspace/db";
import { disputes, orders, disputeEvents, disputeEvidenceFiles } from "@workspace/db";
import { eq, desc, and, asc, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { stripe, requireStripe } from "../lib/stripe";
import { rateLimit } from "../middlewares/rateLimit";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  EVIDENCE_FILE_MIME_TYPES, MAX_EVIDENCE_FILE_BYTES, buildEvidencePayload,
  evidenceAlreadySubmitted, isFinalDisputeStatus,
} from "../lib/disputes/evidence";
import { processEvidenceUpload, type UploadDeps } from "../lib/disputes/upload";
import { buildTimelineSteps, sortTimelineEvents } from "../lib/disputes/timeline";

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSellerId(req: any): string {
  return (req as any).clerkUserId as string;
}

function fileToJson(f: typeof disputeEvidenceFiles.$inferSelect) {
  return {
    id:           f.id,
    evidenceType: f.evidenceType,
    fileName:     f.fileName,
    contentType:  f.contentType,
    sizeBytes:    f.sizeBytes,
    uploadedAt:   f.createdAt.toISOString(),
  };
}

function rowToDispute(row: typeof disputes.$inferSelect) {
  return {
    id:                   row.id,
    stripeDisputeId:      row.stripeDisputeId,
    orderId:              row.orderId,
    sellerId:             row.sellerId,
    amount:               row.amountCents / 100,
    // dispute-detail.tsx reads amountCents; the list reads amount (dollars).
    amountCents:          row.amountCents,
    currency:             row.currency,
    reason:               row.reason,
    status:               row.status,
    customerClaim:        row.customerClaim,
    evidenceDeadline:     row.evidenceDueBy?.toISOString() ?? null,
    evidence:             (row.evidenceJson as any[]) ?? [],
    stripeEvidenceDetails: row.stripeEvidenceDetails,
    evidenceSubmittedAt:  row.evidenceSubmittedAt?.toISOString() ?? null,
    isChargeRefundable:   row.isChargeRefundable,
    networkReasonCode:    row.networkReasonCode,
    createdAt:            row.createdAt.toISOString(),
    updatedAt:            row.updatedAt.toISOString(),
  };
}

// ─── GET /api/disputes ────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const rows = await db
      .select({ dispute: disputes, orderNumber: orders.orderNumber })
      .from(disputes)
      .leftJoin(orders, eq(orders.id, disputes.orderId))
      .where(eq(disputes.sellerId, sellerId))
      .orderBy(desc(disputes.createdAt))
      .limit(50);

    res.json(rows.map((r) => ({ ...rowToDispute(r.dispute), orderNumber: r.orderNumber ?? null })));
  } catch (err) {
    req.log.error({ err }, "Failed to load disputes");
    res.status(500).json({ error: "Failed to load disputes" });
  }
});

// ─── GET /api/disputes/:id ─────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const [row] = await db
      .select()
      .from(disputes)
      .where(and(eq(disputes.id, req.params.id), eq(disputes.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }

    // Enrich with order context if available
    let orderCtx: any = null;
    if (row.orderId) {
      const [ord] = await db
        .select({
          id:           orders.id,
          orderNumber:  orders.orderNumber,
          totalCents:   orders.totalCents,
          trackingNumber: orders.trackingNumber,
          carrier:      orders.carrier,
          createdAt:    orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.id, row.orderId))
        .limit(1);
      if (ord) {
        orderCtx = {
          id:             ord.id,
          orderNumber:    ord.orderNumber,
          totalCents:     ord.totalCents,
          trackingNumber: ord.trackingNumber,
          carrier:        ord.carrier,
          createdAt:      ord.createdAt.toISOString(),
        };
      }
    }

    const files = await db.select().from(disputeEvidenceFiles)
      .where(eq(disputeEvidenceFiles.disputeId, row.id))
      .orderBy(asc(disputeEvidenceFiles.createdAt));

    res.json({ ...rowToDispute(row), order: orderCtx, evidenceFiles: files.map(fileToJson) });
  } catch (err) {
    req.log.error({ err, disputeId: req.params.id }, "Failed to load dispute");
    res.status(500).json({ error: "Failed to load dispute" });
  }
});

// ─── POST /api/disputes/:id/evidence — submit to Stripe ───────────────────────

router.post("/:id/evidence", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const [row] = await db
      .select()
      .from(disputes)
      .where(and(eq(disputes.id, req.params.id), eq(disputes.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }

    const isFinal = isFinalDisputeStatus(row.status);
    if (isFinal) {
      res.status(400).json({ error: "Cannot submit evidence for a finalised dispute" }); return;
    }
    if (evidenceAlreadySubmitted(row)) {
      res.status(409).json({ error: "Evidence was already submitted. Stripe allows one submission." }); return;
    }

    const { type, description, trackingNumber } = req.body;
    if (!type || !description?.trim()) {
      res.status(400).json({ error: "type and description are required" }); return;
    }

    // Build the evidence item for our DB
    const evidenceItem = {
      id:          `ev_${Date.now()}`,
      disputeId:   row.id,
      type,
      description: description.trim(),
      submittedAt: new Date().toISOString(),
    };

    // Accumulate all evidence in DB
    const existing = (row.evidenceJson as any[]) ?? [];
    const newEvidence = [...existing, evidenceItem];

    // Merge all evidence fields for Stripe (latest submission wins per field)
    const files = await db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));
    const mergedStripe = buildEvidencePayload(newEvidence as any[], files);

    let stripeStatus = row.status;

    // Forward to Stripe if configured
    if (stripe && row.stripeDisputeId) {
      try {
        const updated = await stripe.disputes.update(row.stripeDisputeId, {
          evidence: mergedStripe,
          submit: false, // accumulate; seller explicitly submits all at end
        });
        stripeStatus = mapStripeStatus(updated.status);
      } catch (stripeErr: any) {
        req.log.error({ err: stripeErr, disputeId: row.id }, "Failed to update Stripe dispute evidence");
        // Non-fatal — we still save to our DB
      }
    }

    const [updated] = await db
      .update(disputes)
      .set({
        evidenceJson:   newEvidence,
        // Saving a draft is not a submission; only Stripe's own status counts.
        status:         stripeStatus,
        updatedAt:      new Date(),
      })
      .where(and(
        eq(disputes.id, row.id),
        sql`${disputes.status} NOT IN ('won', 'lost', 'closed')`,
      ))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Dispute changed while evidence was being submitted" });
      return;
    }

    res.json({ success: true, dispute: rowToDispute(updated), evidenceItem });
  } catch (err) {
    req.log.error({ err, disputeId: req.params.id }, "Failed to submit evidence");
    res.status(500).json({ error: "Failed to submit evidence" });
  }
});

// ─── POST /api/disputes/:id/submit — final submit all evidence to Stripe ──────

router.post("/:id/submit", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const [row] = await db
      .select()
      .from(disputes)
      .where(and(eq(disputes.id, req.params.id), eq(disputes.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }
    if (!stripe || !row.stripeDisputeId) {
      res.status(503).json({ error: "Stripe not configured" }); return;
    }
    if (isFinalDisputeStatus(row.status)) {
      res.status(400).json({ error: "Cannot submit evidence for a finalised dispute" }); return;
    }

    // Stripe allows exactly one submission. Claim it atomically first so two
    // taps (or two devices) cannot both send, and release the claim if Stripe
    // refuses so the seller can try again.
    if (evidenceAlreadySubmitted(row)) {
      res.status(409).json({ error: "Evidence was already submitted. Stripe allows one submission." }); return;
    }
    const [claimed] = await db.update(disputes)
      .set({ evidenceSubmittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(disputes.id, row.id), isNull(disputes.evidenceSubmittedAt)))
      .returning({ id: disputes.id });
    if (!claimed) {
      res.status(409).json({ error: "Evidence was already submitted. Stripe allows one submission." }); return;
    }

    const existing = (row.evidenceJson as any[]) ?? [];
    const files = await db.select().from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));
    const mergedStripe = buildEvidencePayload(existing, files);
    if (Object.keys(mergedStripe).length === 0) {
      await db.update(disputes).set({ evidenceSubmittedAt: null }).where(eq(disputes.id, row.id));
      res.status(400).json({ error: "Add evidence before submitting" }); return;
    }

    let updated;
    try {
      updated = await stripe.disputes.update(row.stripeDisputeId, {
        evidence: mergedStripe,
        submit: true,
      });
    } catch (stripeErr) {
      await db.update(disputes).set({ evidenceSubmittedAt: null }).where(eq(disputes.id, row.id));
      throw stripeErr;
    }

    const [dbRow] = await db
      .update(disputes)
      .set({ status: mapStripeStatus(updated.status), updatedAt: new Date() })
      .where(eq(disputes.id, row.id))
      .returning();
    await db.insert(disputeEvents).values({
      disputeId: row.id,
      stripeEventId: `local-submit/${row.id}`,
      kind: "evidence_submitted",
      payload: { status: updated.status },
    }).onConflictDoNothing({ target: disputeEvents.stripeEventId });

    res.json({ success: true, dispute: rowToDispute(dbRow ?? row) });
  } catch (err: any) {
    req.log.error({ err, disputeId: req.params.id }, "Failed to submit dispute");
    res.status(err.status ?? 500).json({ error: err.message ?? "Failed to submit" });
  }
});

// ─── POST /api/disputes/:id/accept — concede dispute ─────────────────────────

router.post("/:id/accept", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const [row] = await db
      .select()
      .from(disputes)
      .where(and(eq(disputes.id, req.params.id), eq(disputes.sellerId, sellerId)))
      .limit(1);

    if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }

    // Closing a dispute on Stripe is done by NOT submitting evidence;
    // Stripe will auto-close it when the window passes. We mark locally.
    const [updated] = await db
      .update(disputes)
      .set({ status: "closed", updatedAt: new Date() })
      .where(and(
        eq(disputes.id, row.id),
        sql`${disputes.status} NOT IN ('won', 'lost')`,
      ))
      .returning();
    if (!updated) {
      res.status(409).json({ error: "Finalised disputes cannot be accepted" });
      return;
    }

    await db.insert(disputeEvents).values({
      disputeId: row.id,
      stripeEventId: `local-accept/${row.id}`,
      kind: "accepted",
      payload: { status: "closed" },
    }).onConflictDoNothing({ target: disputeEvents.stripeEventId });

    res.json({ accepted: true, dispute: rowToDispute(updated) });
  } catch (err) {
    req.log.error({ err, disputeId: req.params.id }, "Failed to accept dispute");
    res.status(500).json({ error: "Failed to accept dispute" });
  }
});

// ─── POST /api/disputes/:id/evidence/upload — evidence file ──────────────────
// Raw body (Content-Type image/jpeg | image/png | application/pdf), with
// ?type=<evidence field>&filename=<name>. Stored privately, then sent to
// Stripe's Files API (purpose dispute_evidence) and attached to the draft.

const evidenceStorage = new ObjectStorageService();

function uploadDeps(log: any): UploadDeps {
  return {
    storage: {
      async save(bytes, contentType, ownerId) {
        const objectPath = await evidenceStorage.createObjectEntityFromBuffer(bytes, contentType);
        await evidenceStorage.trySetObjectEntityAclPolicy(objectPath, { owner: ownerId, visibility: "private" });
        return objectPath;
      },
      remove: (objectKey) => evidenceStorage.deleteObjectEntity(objectKey),
    },
    stripe: stripe
      ? {
          async createEvidenceFile({ bytes, fileName, contentType }) {
            const file = await stripe!.files.create({
              purpose: "dispute_evidence",
              file: { data: bytes, name: fileName, type: contentType },
            });
            return file.id;
          },
          async attachDraft(stripeDisputeId, field, stripeFileId) {
            await stripe!.disputes.update(stripeDisputeId, { evidence: { [field]: stripeFileId }, submit: false });
          },
        }
      : null,
    repo: {
      async replaceFile(values) {
        return db.transaction(async (tx) => {
          const [previous] = await tx.select().from(disputeEvidenceFiles).where(and(
            eq(disputeEvidenceFiles.disputeId, values.disputeId),
            eq(disputeEvidenceFiles.evidenceType, values.evidenceType),
          )).limit(1);
          if (previous) await tx.delete(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.id, previous.id));
          const [created] = await tx.insert(disputeEvidenceFiles).values(values).returning();
          return { created, replaced: previous ?? null };
        });
      },
    },
    log,
  };
}

router.post(
  "/:id/evidence/upload",
  rateLimit("asset-upload"),
  express.raw({ type: [...EVIDENCE_FILE_MIME_TYPES], limit: MAX_EVIDENCE_FILE_BYTES }),
  async (req, res) => {
    const sellerId = getSellerId(req);
    try {
      const [row] = await db.select().from(disputes)
        .where(and(eq(disputes.id, String(req.params.id)), eq(disputes.sellerId, sellerId))).limit(1);
      if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }

      const existingFiles = await db.select({ evidenceType: disputeEvidenceFiles.evidenceType })
        .from(disputeEvidenceFiles).where(eq(disputeEvidenceFiles.disputeId, row.id));

      const result = await processEvidenceUpload({
        dispute: row,
        existingFiles,
        contentType: req.get("content-type") ?? undefined,
        bytes: req.body,
        evidenceType: req.query.type,
        fileName: req.query.filename,
      }, uploadDeps(req.log));

      if (!result.ok) { res.status(result.status).json({ error: result.error }); return; }
      res.status(201).json({ file: fileToJson(result.file) });
    } catch (err) {
      req.log.error({ err, disputeId: req.params.id }, "Failed to upload dispute evidence");
      res.status(500).json({ error: "Failed to upload evidence" });
    }
  },
);

// ─── GET /api/disputes/:id/timeline ───────────────────────────────────────────
// Stored events merged with Stripe's live state. If Stripe is unreachable the
// stored state is returned and `stripe` is null.

router.get("/:id/timeline", async (req, res) => {
  const sellerId = getSellerId(req);
  try {
    const [row] = await db.select().from(disputes)
      .where(and(eq(disputes.id, req.params.id), eq(disputes.sellerId, sellerId))).limit(1);
    if (!row) { res.status(404).json({ error: "Dispute not found" }); return; }

    const eventRows = await db.select().from(disputeEvents)
      .where(eq(disputeEvents.disputeId, row.id)).orderBy(asc(disputeEvents.occurredAt));
    const events = sortTimelineEvents(eventRows);

    let live: { status: string; evidenceDueBy: string | null; submissionCount: number; pastDue: boolean; hasEvidence: boolean } | null = null;
    let status = row.status;
    let evidenceDueBy = row.evidenceDueBy;
    let evidenceSubmittedAt = row.evidenceSubmittedAt;
    if (stripe && row.stripeDisputeId) {
      try {
        const d = await stripe.disputes.retrieve(row.stripeDisputeId);
        const details = d.evidence_details;
        const submissionCount = details?.submission_count ?? 0;
        live = {
          status: d.status,
          evidenceDueBy: details?.due_by ? new Date(details.due_by * 1000).toISOString() : null,
          submissionCount,
          pastDue: !!details?.past_due,
          hasEvidence: !!details?.has_evidence,
        };
        // Stripe wins for status and deadline; a submission it reports that we
        // missed (dashboard submit) is reflected in the steps.
        const liveStatus = mapStripeStatus(d.status);
        if (!isFinalDisputeStatus(row.status) || isFinalDisputeStatus(liveStatus)) status = liveStatus;
        if (details?.due_by) evidenceDueBy = new Date(details.due_by * 1000);
        if (submissionCount > 0 && !evidenceSubmittedAt) evidenceSubmittedAt = row.updatedAt;
      } catch (stripeErr) {
        req.log.warn({ err: stripeErr, disputeId: row.id }, "Could not load live dispute state from Stripe");
      }
    }

    const steps = buildTimelineSteps({
      status, createdAt: row.createdAt, evidenceDueBy, evidenceSubmittedAt, events,
    });
    res.json({
      status,
      evidenceDeadline: evidenceDueBy?.toISOString() ?? null,
      steps,
      events: events.map((e) => ({ id: e.id, kind: e.kind, occurredAt: e.occurredAt.toISOString(), payload: e.payload })),
      stripe: live,
    });
  } catch (err) {
    req.log.error({ err, disputeId: req.params.id }, "Failed to load dispute timeline");
    res.status(500).json({ error: "Failed to load timeline" });
  }
});

// ─── Status mapping ───────────────────────────────────────────────────────────

function mapStripeStatus(s: string): string {
  switch (s) {
    case "needs_response":           return "needs_response";
    case "under_review":             return "under_review";
    case "warning_needs_response":   return "needs_response";
    case "warning_under_review":     return "under_review";
    case "warning_closed":           return "closed";
    case "charge_refunded":          return "closed";
    case "won":                      return "won";
    case "lost":                     return "lost";
    default:                         return s;
  }
}

export default router;
export { mapStripeStatus };
