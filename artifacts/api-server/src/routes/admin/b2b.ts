/**
 * Admin → B2B money (sample/bulk order cards). Mounted inside /api/admin, so
 * every route already requires a platform admin (requireAdmin).
 *
 * POST /api/admin/sample-orders/:id/refund   { amountCents?, reason?, idempotencyKey? }
 *   Refunds a paid sample/bulk card (full when amountCents is omitted). Same
 *   money rules as the manufacturer's refund (lib/b2b/refunds.ts).
 * GET  /api/admin/b2b-disputes?limit=
 *   Chargebacks on sample/bulk cards and freelancer jobs, with what was
 *   clawed back. (They also appear in GET /api/admin/disputes.)
 */
import { Router } from "express";
import { B2bRefundError, refundSampleOrder } from "../../lib/b2b/refunds";
import { listB2bDisputes } from "../../lib/b2b/disputes";
import { publishNotification } from "../notifications-feed";
import { UUID_RE } from "./util";

const router = Router();

router.post("/sample-orders/:id/refund", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Order not found" });
  const { amountCents, reason, idempotencyKey } = (req.body ?? {}) as { amountCents?: unknown; reason?: unknown; idempotencyKey?: unknown };
  if (amountCents !== undefined && amountCents !== null && (!Number.isSafeInteger(amountCents) || (amountCents as number) < 1)) {
    return res.status(400).json({ error: "amountCents must be a positive whole number of cents." });
  }
  if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > 500)) {
    return res.status(400).json({ error: "Reason must be 500 characters or fewer." });
  }
  try {
    const result = await refundSampleOrder({
      orderId: id,
      amountCents: (amountCents as number | undefined) ?? null,
      reason: (reason as string | undefined) ?? null,
      actor: { role: "admin", clerkId: (req as any).clerkUserId ?? null },
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : null,
      notify: publishNotification,
    });
    req.log.info({ orderId: id, refundId: result.refund.id, admin: (req as any).adminEmail }, "Admin refunded a sample/bulk order");
    return res.json({
      refund: { id: result.refund.id, amountCents: result.refund.amountCents, state: result.refund.state, platformFeeRefundedCents: result.refund.platformFeeRefundedCents },
      order: { id: result.order.id, status: result.order.status, refundedCents: result.order.refundedCents, priceCents: result.order.priceCents },
      replayed: result.replayed,
    });
  } catch (err) {
    if (err instanceof B2bRefundError) return res.status(err.status).json({ error: err.message, code: err.code });
    req.log.error({ err, orderId: id }, "Admin sample order refund failed");
    return res.status(500).json({ error: "The refund couldn't be completed." });
  }
});

router.get("/b2b-disputes", async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  try {
    const rows = await listB2bDisputes(Number.isFinite(limit) ? limit : 50);
    return res.json({
      items: rows.map((d) => ({
        id: d.id,
        stripeDisputeId: d.stripeDisputeId,
        kind: d.sampleOrderId ? "sample_order" : "freelancer_job",
        sampleOrderId: d.sampleOrderId,
        freelancerJobId: d.freelancerJobId,
        amountCents: d.amountCents,
        clawbackCents: d.clawbackCents,
        reason: d.reason,
        status: d.status,
        evidenceDueBy: d.evidenceDueBy?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin B2B dispute list failed");
    return res.status(500).json({ error: "Could not load B2B disputes." });
  }
});

export default router;
