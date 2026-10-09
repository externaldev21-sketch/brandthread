/**
 * Host-side view of Live tips (see lib/liveTips.ts for the `live_tips` flag).
 *
 *  GET /api/live-tips/:streamId/total   host only: { enabled, totalCents, giftCount }
 *
 * Read-only: sums the seller's existing 'live_gift' credit entries for the
 * stream (thread_cash_entries.reference_id = stream id). Never writes to the
 * Thread Cash ledger. When the flag is OFF it answers { enabled: false } with
 * zeros instead of an error so the host screen can simply hide the total.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { isLiveTipsEnabled } from "../lib/liveTips";

const router = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/:streamId/total", async (req, res) => {
  try {
    const hostId = (req as any).clerkUserId as string;
    const streamId = String(req.params.streamId);
    if (!UUID_RE.test(streamId)) return res.status(404).json({ error: "Not found" });

    const owned = await db.execute(sql`
      SELECT 1 FROM live_streams WHERE id = ${streamId}::uuid AND seller_id = ${hostId} LIMIT 1
    `);
    if (!owned.rows.length) return res.status(404).json({ error: "Not found or not your stream" });

    if (!(await isLiveTipsEnabled())) {
      return res.json({ enabled: false, totalCents: 0, giftCount: 0 });
    }
    const sums = await db.execute(sql`
      SELECT COALESCE(SUM(amount_cents), 0)::int AS total_cents, COUNT(*)::int AS gift_count
      FROM thread_cash_entries
      WHERE buyer_id = ${hostId} AND source = 'live_gift' AND reference_id = ${streamId}
    `);
    const row = sums.rows[0] as any;
    return res.json({
      enabled: true,
      totalCents: Number(row?.total_cents ?? 0),
      giftCount: Number(row?.gift_count ?? 0),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default router;
