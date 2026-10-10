/**
 * Admin → problem sellers (Revenue P1 5/7).
 *
 * GET /api/admin/problem-sellers?days=90&limit=&offset=
 *   Sellers ranked by trouble signals over the window: reports against them
 *   (open and total), content-filter hits on their content, chargebacks,
 *   refund rate and late shipments (past the delivery deadline without a
 *   delivery, or auto-refunded for it). Actions (hold payouts, suspend) reuse
 *   the existing admin endpoints.
 *
 * Score = 3·open reports + total reports + filter hits + 4·disputes
 *       + 2·late shipments + round(20·refund rate). Only sellers with a
 *       score above zero are listed.
 */
import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { clampDays, pageParams } from "./util";

const router = Router();

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0) || 0;

router.get("/problem-sellers", async (req, res) => {
  const days = clampDays(req, 90);
  const { limit, offset } = pageParams(req);
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const result = await db.execute(sql`
      WITH r AS (
        SELECT target_owner_id AS id,
               count(*) AS total,
               count(*) FILTER (WHERE status = 'pending') AS open,
               count(*) FILTER (WHERE source = 'auto_filter') AS filter_hits
        FROM reports WHERE target_owner_id IS NOT NULL AND created_at >= ${since} GROUP BY 1
      ), d AS (
        SELECT seller_id AS id, count(*) AS disputes, COALESCE(sum(amount_cents), 0) AS disputed_cents
        FROM disputes WHERE created_at >= ${since} GROUP BY 1
      ), o AS (
        SELECT owner_id AS id, count(*) AS orders,
               count(*) FILTER (WHERE refunded_cents > 0) AS refunded,
               count(*) FILTER (WHERE auto_refunded_at IS NOT NULL
                 OR (deliver_by < now() AND delivered_at IS NULL AND status NOT IN ('cancelled', 'fulfilled'))) AS late
        FROM orders WHERE paid_at >= ${since} GROUP BY 1
      ), scored AS (
        SELECT u.clerk_id, u.brand_name, u.display_name, u.name, u.username, u.suspended_at, u.created_at,
               COALESCE(r.total, 0) AS reports_total, COALESCE(r.open, 0) AS reports_open, COALESCE(r.filter_hits, 0) AS filter_hits,
               COALESCE(d.disputes, 0) AS disputes, COALESCE(d.disputed_cents, 0) AS disputed_cents,
               COALESCE(o.orders, 0) AS orders, COALESCE(o.refunded, 0) AS refunded, COALESCE(o.late, 0) AS late,
               CASE WHEN COALESCE(o.orders, 0) > 0 THEN o.refunded::float / o.orders ELSE 0 END AS refund_rate,
               pc.state AS payout_state
        FROM users u
        LEFT JOIN r ON r.id = u.clerk_id
        LEFT JOIN d ON d.id = u.clerk_id
        LEFT JOIN o ON o.id = u.clerk_id
        LEFT JOIN payout_controls pc ON pc.party_type = 'seller' AND pc.party_id = u.clerk_id
        WHERE u.account_type IN ('seller', 'both') AND u.deleted_at IS NULL AND u.role <> 'admin'
          AND (r.id IS NOT NULL OR d.id IS NOT NULL OR o.id IS NOT NULL)
      )
      SELECT *, (3 * reports_open + reports_total + filter_hits + 4 * disputes + 2 * late + round(20 * refund_rate))::int AS score
      FROM scored
      WHERE (3 * reports_open + reports_total + filter_hits + 4 * disputes + 2 * late + round(20 * refund_rate)) > 0
      ORDER BY score DESC, reports_open DESC, clerk_id
      LIMIT ${limit + 1} OFFSET ${offset}`);
    const rows = ((result as { rows?: Row[] }).rows ?? []);
    return res.json({
      days,
      items: rows.slice(0, limit).map((r) => ({
        clerkId: String(r.clerk_id),
        name: (r.brand_name || r.display_name || r.name || (r.username ? `@${r.username}` : "Unknown")) as string,
        score: n(r.score),
        reports: { total: n(r.reports_total), open: n(r.reports_open) },
        filterHits: n(r.filter_hits),
        disputes: n(r.disputes),
        disputedCents: n(r.disputed_cents),
        orders: n(r.orders),
        refundedOrders: n(r.refunded),
        refundRate: Math.round(Number(r.refund_rate ?? 0) * 1000) / 1000,
        lateShipments: n(r.late),
        suspended: r.suspended_at != null,
        payoutState: (r.payout_state as string | null) ?? null,
      })),
      hasMore: rows.length > limit,
    });
  } catch (err) {
    req.log.error({ err }, "Admin problem sellers failed");
    return res.status(500).json({ error: "Could not load problem sellers." });
  }
});

export default router;
