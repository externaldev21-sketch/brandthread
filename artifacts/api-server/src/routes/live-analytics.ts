/**
 * Seller live analytics — the live summary a host sees after (or during) a
 * live, and the list of their recent lives.
 *
 *  GET /api/live/analytics/recent?limit=   host: recent lives with headline numbers
 *  GET /api/live/:id/analytics             host: one live's full summary
 *
 * Only the stream's own seller can read it. Sales are the orders attributed
 * to the stream (orders.source_live_stream_id, set by the paid webhook — see
 * lib/liveAttribution.ts) and use the same definition as routes/analytics.ts:
 * paid, not cancelled, revenue net of refunds. The host's totals are their
 * own orders; a co-host's sales are listed separately under `cohosts`.
 * Mounted before routes/live.ts so GET /:id there never sees /analytics/*.
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same order predicate as routes/analytics.ts: paid and not cancelled. */
const PAID_ORDER = sql`o.status != 'cancelled' AND o.paid_at IS NOT NULL`;

function durationSeconds(startedAt: unknown, endedAt: unknown): number {
  const start = new Date(String(startedAt)).getTime();
  const end = endedAt ? new Date(String(endedAt)).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

function wrap(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: any) => {
      logger.error({ err }, "live analytics failed");
      if (!res.headersSent) res.status(500).json({ error: "Couldn't load live analytics" });
    });
  };
}

// ─── Recent lives ────────────────────────────────────────────────────────────
router.get("/analytics/recent", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 50);
  const rows = await db.execute(sql`
    SELECT ls.id, ls.title, ls.status, ls.started_at, ls.ended_at, ls.peak_viewer_count, ls.thumbnail_url,
           COALESCE(s.order_count, 0)::int AS order_count,
           COALESCE(s.revenue_cents, 0)::int AS revenue_cents
    FROM live_streams ls
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS order_count,
             COALESCE(sum(o.total_cents - COALESCE(o.refunded_cents, 0)), 0)::int AS revenue_cents
      FROM orders o
      WHERE o.source_live_stream_id = ls.id AND o.owner_id = ls.seller_id AND ${PAID_ORDER}
    ) s ON true
    WHERE ls.seller_id = ${me}
    ORDER BY ls.started_at DESC
    LIMIT ${limit}
  `);
  return res.json({
    lives: (rows.rows as any[]).map((r) => ({
      streamId: r.id,
      title: r.title,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      thumbnailUrl: r.thumbnail_url ?? null,
      durationSeconds: durationSeconds(r.started_at, r.ended_at),
      peakViewers: Number(r.peak_viewer_count) || 0,
      orders: Number(r.order_count) || 0,
      revenueCents: Number(r.revenue_cents) || 0,
    })),
  });
}));

// ─── One live's summary ──────────────────────────────────────────────────────
router.get("/:id/analytics", requireAuth, wrap(async (req, res) => {
  const me = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Stream not found" });
  const [stream] = await db.execute(sql`
    SELECT id, seller_id, title, status, started_at, ended_at, peak_viewer_count, viewer_count, like_count, thumbnail_url
    FROM live_streams WHERE id = ${id}::uuid LIMIT 1
  `).then((r) => r.rows as any[]);
  if (!stream || stream.seller_id !== me) return res.status(404).json({ error: "Stream not found" });

  const [audience, sales, products, cohosts, gifts] = await Promise.all([
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM live_stream_unique_viewers v WHERE v.stream_id = ${id}::uuid) AS unique_viewers,
        (SELECT count(*)::int FROM live_comments c WHERE c.stream_id = ${id}::uuid) AS comments
    `).then((r) => (r.rows as any[])[0] ?? {}),
    db.execute(sql`
      SELECT count(*)::int AS order_count,
             count(DISTINCT COALESCE(o.buyer_id, o.guest_email))::int AS buyers,
             COALESCE(sum(o.total_cents), 0)::int AS gross_cents,
             COALESCE(sum(COALESCE(o.refunded_cents, 0)), 0)::int AS refunded_cents,
             COALESCE(sum(o.total_cents - COALESCE(o.refunded_cents, 0)), 0)::int AS net_cents,
             COALESCE((SELECT sum(oi.quantity) FROM order_items oi JOIN orders o2 ON o2.id = oi.order_id
                        WHERE o2.source_live_stream_id = ${id}::uuid AND o2.owner_id = ${me}
                          AND o2.status != 'cancelled' AND o2.paid_at IS NOT NULL), 0)::int AS units
      FROM orders o
      WHERE o.source_live_stream_id = ${id}::uuid AND o.owner_id = ${me} AND ${PAID_ORDER}
    `).then((r) => (r.rows as any[])[0] ?? {}),
    db.execute(sql`
      SELECT COALESCE(p.id::text, oi.product_name) AS key, p.id AS product_id,
             COALESCE(p.name, oi.product_name) AS name, (p.images::jsonb ->> 0) AS image_url,
             sum(oi.quantity)::int AS units, sum(oi.quantity * oi.price_cents)::int AS revenue_cents
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN product_variants pv ON pv.id = oi.variant_id
      LEFT JOIN products p ON p.id = pv.product_id
      WHERE o.source_live_stream_id = ${id}::uuid AND o.owner_id = ${me} AND ${PAID_ORDER}
      GROUP BY 1, 2, 3, 4
      ORDER BY revenue_cents DESC, units DESC
      LIMIT 5
    `).then((r) => r.rows as any[]),
    db.execute(sql`
      SELECT c.cohost_id,
             COALESCE(u.brand_name, u.display_name, 'Co-host') AS display_name,
             COALESCE(u.username, '') AS username, u.profile_image_url,
             min(c.responded_at) AS joined_at,
             COALESCE((SELECT count(*) FROM orders o WHERE o.source_live_stream_id = ${id}::uuid
                        AND o.owner_id = c.cohost_id AND ${PAID_ORDER}), 0)::int AS order_count,
             COALESCE((SELECT sum(o.total_cents - COALESCE(o.refunded_cents, 0)) FROM orders o
                        WHERE o.source_live_stream_id = ${id}::uuid AND o.owner_id = c.cohost_id AND ${PAID_ORDER}), 0)::int AS revenue_cents
      FROM live_cohosts c LEFT JOIN users u ON u.clerk_id = c.cohost_id
      WHERE c.stream_id = ${id}::uuid AND c.responded_at IS NOT NULL AND c.status IN ('accepted', 'removed', 'left')
      GROUP BY c.cohost_id, u.brand_name, u.display_name, u.username, u.profile_image_url
      ORDER BY joined_at ASC
    `).then((r) => r.rows as any[]),
    // Thread Cash gifts the host received in this live (wallet.ts writes the
    // seller's credit with source 'live_gift' and the stream id as reference).
    db.execute(sql`
      SELECT count(*)::int AS gift_count, COALESCE(sum(amount_cents), 0)::int AS gift_cents
      FROM thread_cash_entries
      WHERE buyer_id = ${me} AND source = 'live_gift' AND reference_id = ${id}
    `).then((r) => (r.rows as any[])[0] ?? {}),
  ]);

  const uniqueViewers = Number(audience.unique_viewers) || 0;
  const buyers = Number(sales.buyers) || 0;
  return res.json({
    stream: {
      id: stream.id,
      title: stream.title,
      status: stream.status,
      startedAt: stream.started_at,
      endedAt: stream.ended_at,
      thumbnailUrl: stream.thumbnail_url ?? null,
      durationSeconds: durationSeconds(stream.started_at, stream.ended_at),
    },
    audience: {
      peakViewers: Math.max(Number(stream.peak_viewer_count) || 0, stream.status === "live" ? Number(stream.viewer_count) || 0 : 0),
      uniqueViewers,
      comments: Number(audience.comments) || 0,
      likes: Number(stream.like_count) || 0,
    },
    gifts: {
      count: Number(gifts.gift_count) || 0,
      threadCashCents: Number(gifts.gift_cents) || 0,
    },
    sales: {
      orders: Number(sales.order_count) || 0,
      buyers,
      units: Number(sales.units) || 0,
      grossCents: Number(sales.gross_cents) || 0,
      refundedCents: Number(sales.refunded_cents) || 0,
      revenueCents: Number(sales.net_cents) || 0,
      // Share of unique viewers who bought; null when nobody watched.
      conversionRate: uniqueViewers > 0 ? Math.round((buyers / uniqueViewers) * 1000) / 1000 : null,
    },
    topProducts: products.map((p) => ({
      productId: p.product_id ?? null,
      name: p.name,
      imageUrl: typeof p.image_url === "string" && p.image_url ? p.image_url : null,
      units: Number(p.units) || 0,
      revenueCents: Number(p.revenue_cents) || 0,
    })),
    cohosts: cohosts.map((c) => ({
      userId: c.cohost_id,
      displayName: c.display_name,
      username: c.username,
      avatarUrl: c.profile_image_url ?? null,
      joinedAt: c.joined_at,
      orders: Number(c.order_count) || 0,
      revenueCents: Number(c.revenue_cents) || 0,
    })),
  });
}));

export default router;
