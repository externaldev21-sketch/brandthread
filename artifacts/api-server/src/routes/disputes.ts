/**
 * Disputes / Chargebacks API
 * Mounted at /api/disputes
 *
 * GET  /                    list disputes for this seller (newest first)
 * GET  /:id                 get one dispute with full evidence
 * POST /:id/evidence        submit evidence to Stripe
 * POST /:id/accept          accept dispute (concede, stop contesting)
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { disputes, orders } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { stripe, requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSellerId(req: any): string {
  return (req as any).clerkUserId as string;
}

/** Map our UI evidence type to Stripe evidence fields */
function buildStripeEvidence(type: string, description: string, trackingNumber?: string): Record<string, string> {
  switch (type) {
    case "tracking":
      return {
        shipping_tracking_number: trackingNumber ?? "",
        shipping_documentation:   description,
        customer_communication:   description,
      };
    case "photo":
      return {
        product_description: description,
      };
    case "policy":
      return {
        refund_policy:             description,
        refund_policy_disclosure:  description,
      };
    case "written_response":
      return {
        customer_communication: description,
        uncategorized_text:     description,
      };
    default:
      return { uncategorized_text: description };
  }
}

function rowToDispute(row: typeof disputes.$inferSelect) {
  return {
    id:                   row.id,
    stripeDisputeId:      row.stripeDisputeId,
    orderId:              row.orderId,
    sellerId:             row.sellerId,
    amount:               row.amountCents / 100,
    currency:             row.currency,
    reason:               row.reason,
    status:               row.status,
    customerClaim:        row.customerClaim,
    evidenceDeadline:     row.evidenceDueBy?.toISOString() ?? null,
    evidence:             (row.evidenceJson as any[]) ?? [],
    stripeEvidenceDetails: row.stripeEvidenceDetails,
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
      .select()
      .from(disputes)
      .where(eq(disputes.sellerId, sellerId))
      .orderBy(desc(disputes.createdAt))
      .limit(50);

    res.json(rows.map(rowToDispute));
  } catch (err) {
    console.error(err);
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

    res.json({ ...rowToDispute(row), order: orderCtx });
  } catch (err) {
    console.error(err);
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

    const isFinal = ["won", "lost", "closed"].includes(row.status);
    if (isFinal) {
      res.status(400).json({ error: "Cannot submit evidence for a finalised dispute" }); return;
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
    const mergedStripe = newEvidence.reduce((acc: Record<string, string>, ev: any) => {
      const tracking = newEvidence.find((e: any) => e.type === "tracking")?.description;
      return { ...acc, ...buildStripeEvidence(ev.type, ev.description, tracking) };
    }, {});

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
        console.error("Stripe evidence update failed:", stripeErr.message);
        // Non-fatal — we still save to our DB
      }
    }

    const [updated] = await db
      .update(disputes)
      .set({
        evidenceJson:   newEvidence,
        status:         stripeStatus === row.status ? "evidence_submitted" : stripeStatus,
        updatedAt:      new Date(),
      })
      .where(eq(disputes.id, row.id))
      .returning();

    res.json({ success: true, dispute: rowToDispute(updated), evidenceItem });
  } catch (err) {
    console.error(err);
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

    const existing = (row.evidenceJson as any[]) ?? [];
    const mergedStripe = existing.reduce((acc: Record<string, string>, ev: any) => {
      const tracking = existing.find((e: any) => e.type === "tracking")?.description;
      return { ...acc, ...buildStripeEvidence(ev.type, ev.description, tracking) };
    }, {});

    const updated = await stripe.disputes.update(row.stripeDisputeId, {
      evidence: mergedStripe,
      submit: true,
    });

    const [dbRow] = await db
      .update(disputes)
      .set({ status: mapStripeStatus(updated.status), updatedAt: new Date() })
      .where(eq(disputes.id, row.id))
      .returning();

    res.json({ success: true, dispute: rowToDispute(dbRow) });
  } catch (err: any) {
    console.error(err);
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
      .where(eq(disputes.id, row.id))
      .returning();

    res.json({ accepted: true, dispute: rowToDispute(updated) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to accept dispute" });
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
