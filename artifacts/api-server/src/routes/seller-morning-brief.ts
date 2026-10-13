/**
 * Seller morning brief.
 * GET /api/seller/morning-brief?tz=<IANA>
 *
 * One small summary for the top of the seller dashboard: yesterday's sales
 * (seller-local day), paid orders still to ship, and at most ONE suggestion
 * picked from real data (see lib/morningBrief.ts for the priority rule).
 * Mounted behind teamContext, so `req.clerkUserId` is the store owner.
 *
 * The sales predicates match GET /api/analytics/home exactly (created_at in
 * the window, paid, not cancelled, net = total - refunded), so "Yesterday"
 * on the brief and the dashboard's own Yesterday figure can never disagree.
 */
import { Router } from "express";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db, orders } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  DAY_MS,
  SALES_WINDOW_DAYS,
  SHIP_SUGGESTION_AFTER_MS,
  briefWindow,
  pickSuggestion,
  resolveTimeZone,
  type MorningBriefSuggestion,
} from "../lib/morningBrief";

export interface MorningBriefResponse {
  date: string;
  timeZone: string;
  hasPaidOrder: boolean;
  yesterday: { netCents: number; orderCount: number };
  toShip: number;
  suggestion: MorningBriefSuggestion | null;
}

/** UTC wall-clock literal for the `timestamp without time zone` order columns. */
const ts = (at: Date) => sql`${at.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;

const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;

export async function computeMorningBrief(ownerId: string, rawTz: unknown, now: Date = new Date()): Promise<MorningBriefResponse> {
  const timeZone = resolveTimeZone(rawTz);
  const { date, yesterdayStart, yesterdayEnd } = briefWindow(now, timeZone);
  const since = new Date(now.getTime() - SALES_WINDOW_DAYS * DAY_MS);
  const lateBefore = new Date(now.getTime() - SHIP_SUGGESTION_AFTER_MS);

  // Units sold per product over the last 30 days (paid, not cancelled).
  const sales30 = sql`
    SELECT v.product_id, sum(oi.quantity)::int AS units
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN product_variants v ON v.id = oi.variant_id
    WHERE o.owner_id = ${ownerId}
      AND o.paid_at IS NOT NULL
      AND o.status != 'cancelled'
      AND o.created_at >= ${ts(since)}
    GROUP BY v.product_id
  `;

  const [paidRow, salesRow, shipRow, soldOutRows, lateRows, lowRows] = await Promise.all([
    db.execute(sql`
      SELECT EXISTS (SELECT 1 FROM orders WHERE owner_id = ${ownerId} AND paid_at IS NOT NULL) AS has_paid
    `),
    db.select({
      netCents: sql<number>`coalesce(sum(${orders.totalCents} - coalesce(${orders.refundedCents}, 0)), 0)::int`,
      orderCount: sql<number>`count(*)::int`,
    }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      gte(orders.createdAt, yesterdayStart),
      lt(orders.createdAt, yesterdayEnd),
      sql`${orders.status} != 'cancelled'`,
      sql`${orders.paidAt} IS NOT NULL`,
    )),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(
      eq(orders.ownerId, ownerId),
      sql`${orders.status} IN ('pending', 'processing')`,
      sql`${orders.paidAt} IS NOT NULL`,
    )),
    // Active products whose every variant is at 0 that still sold recently.
    db.execute(sql`
      SELECT p.id, p.name, s.units
      FROM products p
      JOIN (${sales30}) s ON s.product_id = p.id
      JOIN LATERAL (
        SELECT count(*)::int AS n, max(v.stock) AS max_stock
        FROM product_variants v WHERE v.product_id = p.id
      ) st ON st.n > 0 AND st.max_stock <= 0
      WHERE p.owner_id = ${ownerId} AND p.status = 'active' AND p.deleted_at IS NULL
      ORDER BY s.units DESC, p.name
      LIMIT 5
    `),
    db.execute(sql`
      SELECT id, order_number, (extract(epoch FROM paid_at) * 1000)::float8 AS paid_ms
      FROM orders
      WHERE owner_id = ${ownerId}
        AND status IN ('pending', 'processing')
        AND paid_at IS NOT NULL
        AND paid_at < ${ts(lateBefore)}
      ORDER BY paid_at ASC
      LIMIT 1
    `),
    // The five best sellers of the last 30 days, with stock left.
    db.execute(sql`
      SELECT p.id, p.name, s.units, st.stock_left, st.threshold
      FROM products p
      JOIN (${sales30}) s ON s.product_id = p.id
      JOIN LATERAL (
        SELECT coalesce(sum(greatest(v.stock, 0)), 0)::int AS stock_left,
               coalesce(max(v.low_stock_threshold), 0)::int AS threshold
        FROM product_variants v WHERE v.product_id = p.id
      ) st ON true
      WHERE p.owner_id = ${ownerId} AND p.status = 'active' AND p.deleted_at IS NULL
      ORDER BY s.units DESC, p.name
      LIMIT 5
    `),
  ]);

  const suggestion = pickSuggestion({
    now,
    soldOut: rows(soldOutRows).map((r) => ({ productId: String(r.id), name: String(r.name), unitsSold30d: Number(r.units ?? 0) })),
    lateOrders: rows(lateRows).map((r) => ({
      orderId: String(r.id),
      orderNumber: String(r.order_number),
      // epoch of the UTC wall-clock `timestamp without time zone`, so the
      // driver's local-time parsing of that type never shifts it.
      paidAt: new Date(Number(r.paid_ms)),
    })),
    lowStock: rows(lowRows).map((r) => ({
      productId: String(r.id),
      name: String(r.name),
      unitsSold30d: Number(r.units ?? 0),
      stockLeft: Number(r.stock_left ?? 0),
      threshold: Number(r.threshold ?? 0),
    })),
  });

  return {
    date,
    timeZone,
    hasPaidOrder: Boolean(rows(paidRow)[0]?.has_paid),
    yesterday: {
      netCents: Math.max(0, Number(salesRow[0]?.netCents ?? 0)),
      orderCount: Number(salesRow[0]?.orderCount ?? 0),
    },
    toShip: Number(shipRow[0]?.count ?? 0),
    suggestion,
  };
}

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    res.json(await computeMorningBrief(ownerId, req.query.tz));
  } catch (error) {
    req.log?.error?.({ err: error }, "morning brief failed");
    res.status(500).json({ error: "Could not load the morning brief" });
  }
});

export default router;
