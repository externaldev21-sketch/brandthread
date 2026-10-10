/**
 * Admin → carrier label adjustments.
 *
 * POST /api/admin/shipping-adjustments
 *   { adjustments: [{ externalId, amountCents, reason?, transactionId?, trackingNumber? }] }
 *
 * Shippo bills carrier re-weigh / re-size surcharges to Brandthread's account
 * (Shippo dashboard → Billing → Adjustments, exportable as CSV). Posting those
 * rows here charges each one to the seller who bought the label — from the
 * order's held funds, or reversed from their payout — and tells the seller.
 * Re-posting the same export is safe: each externalId is booked once.
 *
 * GET /api/admin/shipping-adjustments?limit=50 lists the most recent ones.
 */
import { Router } from "express";
import { desc } from "drizzle-orm";
import { db, shippingLabelAdjustments } from "@workspace/db";
import { adjustmentInputError, recordLabelAdjustment, type LabelAdjustmentInput } from "../../lib/shipping/labelAdjustments";

const router = Router();
const MAX_ROWS = 500;

router.get("/", async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const rows = await db.select().from(shippingLabelAdjustments).orderBy(desc(shippingLabelAdjustments.createdAt)).limit(limit);
  res.json({ adjustments: rows });
});

router.post("/", async (req, res) => {
  const list = Array.isArray(req.body?.adjustments) ? req.body.adjustments as Partial<LabelAdjustmentInput>[] : null;
  if (!list || list.length === 0 || list.length > MAX_ROWS) {
    return void res.status(400).json({ error: `adjustments must be a list of 1–${MAX_ROWS} rows` });
  }
  const results = [];
  for (const row of list) {
    const problem = adjustmentInputError(row);
    if (problem) {
      results.push({ externalId: row?.externalId ?? null, status: "invalid", error: problem });
      continue;
    }
    const outcome = await recordLabelAdjustment({
      externalId: row.externalId!.trim(),
      amountCents: row.amountCents!,
      reason: typeof row.reason === "string" ? row.reason.slice(0, 200) : null,
      transactionId: row.transactionId ?? null,
      trackingNumber: row.trackingNumber ?? null,
    });
    results.push({ externalId: row.externalId, ...outcome });
  }
  res.json({ results });
});

export default router;
