/**
 * Admin → orders, refunds, disputes, revenue. Read-only: money is never moved
 * from the admin dashboard.
 *
 * GET /api/admin/orders?q=&status=&limit=&offset=
 * GET /api/admin/orders/:id
 * GET /api/admin/refunds?limit=&offset=
 * GET /api/admin/disputes?status=open|closed|all&limit=&offset=
 * GET /api/admin/revenue?days=30
 * GET /api/admin/thread-cash/liability   outstanding Thread Cash owed + this month's rewards budget
 */
import { Router } from "express";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, or, sql, sum } from "drizzle-orm";
import { boosts, db, disputes, orderItems, orders, users } from "@workspace/db";
import { UUID_RE, clampDays, likePattern, pageParams, queryString } from "./util";
import { getThreadCashLiabilityReport } from "../../lib/threadCash/liability";

const router = Router();

const ORDER_STATUSES = ["pending", "processing", "fulfilled", "shipped", "cancelled"];
const CLOSED_DISPUTE = ["won", "lost", "warning_closed", "charge_refunded"];

async function namesByClerkId(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await db.select({ clerkId: users.clerkId, name: users.name, displayName: users.displayName, brandName: users.brandName })
    .from(users).where(inArray(users.clerkId, unique));
  return new Map(rows.map((r) => [r.clerkId, r.brandName || r.displayName || r.name]));
}

function orderSummary(o: typeof orders.$inferSelect, names: Map<string, string>) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    totalCents: o.totalCents,
    platformFeeCents: o.platformFeeCents,
    refundedCents: o.refundedCents,
    fundsState: o.fundsState,
    seller: { clerkId: o.ownerId, name: names.get(o.ownerId) ?? null },
    buyer: o.buyerId ? { clerkId: o.buyerId, name: names.get(o.buyerId) ?? null } : { clerkId: null, name: o.guestEmail },
    paidAt: o.paidAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

router.get("/orders", async (req, res) => {
  const q = queryString(req, "q");
  const status = queryString(req, "status");
  const { limit, offset } = pageParams(req);
  if (status && !ORDER_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status" });

  const filters = [];
  if (status) filters.push(eq(orders.status, status));
  if (q) {
    const p = likePattern(q);
    filters.push(or(ilike(orders.orderNumber, p), ilike(orders.guestEmail, p), UUID_RE.test(q) ? eq(orders.id, q) : undefined)!);
  }
  try {
    const where = filters.length ? and(...filters) : undefined;
    const [rows, [total]] = await Promise.all([
      db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(limit + 1).offset(offset),
      db.select({ n: count() }).from(orders).where(where),
    ]);
    const page = rows.slice(0, limit);
    const names = await namesByClerkId(page.flatMap((o) => [o.ownerId, o.buyerId]));
    return res.json({ items: page.map((o) => orderSummary(o, names)), hasMore: rows.length > limit, total: Number(total?.n ?? 0) });
  } catch (err) {
    req.log.error({ err }, "Admin order list failed");
    return res.status(500).json({ error: "Could not load orders." });
  }
});

router.get("/orders/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Order not found" });
  try {
    const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!order) return res.status(404).json({ error: "Order not found" });
    const [items, orderDisputes, names] = await Promise.all([
      db.select({ id: orderItems.id, name: orderItems.productName, quantity: orderItems.quantity, priceCents: orderItems.priceCents })
        .from(orderItems).where(eq(orderItems.orderId, id)),
      db.select().from(disputes).where(eq(disputes.orderId, id)),
      namesByClerkId([order.ownerId, order.buyerId]),
    ]);
    return res.json({
      ...orderSummary(order, names),
      subtotalCents: order.subtotalCents,
      shippingCents: order.shippingCents,
      taxCents: order.taxCents,
      sellerNetCents: order.sellerNetCents,
      platformFeeRefundedCents: order.platformFeeRefundedCents,
      threadCashAppliedCents: order.threadCashAppliedCents,
      trackingNumber: order.trackingNumber,
      carrier: order.carrier,
      trackingStatus: order.trackingStatus,
      deliverBy: order.deliverBy?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      autoRefundedAt: order.autoRefundedAt?.toISOString() ?? null,
      cancellationReason: order.cancellationReason,
      items,
      disputes: orderDisputes.map((d) => ({ id: d.id, status: d.status, reason: d.reason, amountCents: d.amountCents })),
    });
  } catch (err) {
    req.log.error({ err, id }, "Admin order detail failed");
    return res.status(500).json({ error: "Could not load this order." });
  }
});

router.get("/refunds", async (req, res) => {
  const { limit, offset } = pageParams(req);
  try {
    const where = sql`${orders.refundedCents} > 0`;
    const [rows, [totals]] = await Promise.all([
      db.select().from(orders).where(where).orderBy(desc(orders.updatedAt)).limit(limit + 1).offset(offset),
      db.select({ n: count(), cents: sum(orders.refundedCents) }).from(orders).where(where),
    ]);
    const page = rows.slice(0, limit);
    const names = await namesByClerkId(page.flatMap((o) => [o.ownerId, o.buyerId]));
    return res.json({
      items: page.map((o) => ({
        ...orderSummary(o, names),
        full: o.refundedCents >= o.totalCents,
        autoRefunded: o.autoRefundedAt != null,
        refundedAt: o.updatedAt.toISOString(),
      })),
      hasMore: rows.length > limit,
      summary: { orders: Number(totals?.n ?? 0), refundedCents: Number(totals?.cents ?? 0) },
    });
  } catch (err) {
    req.log.error({ err }, "Admin refund list failed");
    return res.status(500).json({ error: "Could not load refunds." });
  }
});

router.get("/disputes", async (req, res) => {
  const status = queryString(req, "status") || "open";
  if (!["open", "closed", "all"].includes(status)) return res.status(400).json({ error: "status must be open, closed or all" });
  const { limit, offset } = pageParams(req);
  const where = status === "open" ? sql`${disputes.status} NOT IN (${sql.join(CLOSED_DISPUTE.map((s) => sql`${s}`), sql`, `)})`
    : status === "closed" ? inArray(disputes.status, CLOSED_DISPUTE) : undefined;
  try {
    const [rows, [totals]] = await Promise.all([
      db.select({ d: disputes, orderNumber: orders.orderNumber })
        .from(disputes).leftJoin(orders, eq(orders.id, disputes.orderId))
        .where(where).orderBy(desc(disputes.createdAt)).limit(limit + 1).offset(offset),
      db.select({ n: count(), cents: sum(disputes.amountCents) }).from(disputes).where(where),
    ]);
    const page = rows.slice(0, limit);
    const names = await namesByClerkId(page.map((r) => r.d.sellerId));
    return res.json({
      items: page.map(({ d, orderNumber }) => ({
        id: d.id,
        stripeDisputeId: d.stripeDisputeId,
        orderId: d.orderId,
        orderNumber,
        seller: { clerkId: d.sellerId, name: names.get(d.sellerId) ?? null },
        amountCents: d.amountCents,
        reason: d.reason,
        status: d.status,
        evidenceDueBy: d.evidenceDueBy?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      hasMore: rows.length > limit,
      summary: { disputes: Number(totals?.n ?? 0), amountCents: Number(totals?.cents ?? 0) },
    });
  } catch (err) {
    req.log.error({ err }, "Admin dispute list failed");
    return res.status(500).json({ error: "Could not load disputes." });
  }
});

router.get("/revenue", async (req, res) => {
  const days = clampDays(req);
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const paid = and(isNotNull(orders.paidAt), gte(orders.paidAt, since));
    const day = sql<string>`to_char(date_trunc('day', ${orders.paidAt}), 'YYYY-MM-DD')`;
    const [[totals], series, [boostRev]] = await Promise.all([
      db.select({
        orders: count(),
        gmv: sum(orders.totalCents),
        fees: sum(orders.platformFeeCents),
        feesRefunded: sum(orders.platformFeeRefundedCents),
        refunded: sum(orders.refundedCents),
      }).from(orders).where(paid),
      db.select({ day, gmv: sum(orders.totalCents), fees: sum(orders.platformFeeCents), feesRefunded: sum(orders.platformFeeRefundedCents), n: count() })
        .from(orders).where(paid).groupBy(day).orderBy(day),
      db.select({ n: count(), cents: sum(boosts.budgetCents) }).from(boosts)
        .where(and(isNotNull(boosts.paidAt), gte(boosts.paidAt, since))),
    ]);
    const gmv = Number(totals?.gmv ?? 0);
    const fees = Number(totals?.fees ?? 0) - Number(totals?.feesRefunded ?? 0);
    return res.json({
      days,
      orders: Number(totals?.orders ?? 0),
      gmvCents: gmv,
      platformFeesCents: fees,
      refundedCents: Number(totals?.refunded ?? 0),
      boostRevenueCents: Number(boostRev?.cents ?? 0),
      boostsSold: Number(boostRev?.n ?? 0),
      series: series.map((s) => ({
        day: s.day,
        orders: Number(s.n),
        gmvCents: Number(s.gmv ?? 0),
        platformFeesCents: Number(s.fees ?? 0) - Number(s.feesRefunded ?? 0),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin revenue failed");
    return res.status(500).json({ error: "Could not load revenue." });
  }
});

router.get("/thread-cash/liability", async (req, res) => {
  try {
    return res.json(await getThreadCashLiabilityReport());
  } catch (err) {
    req.log.error({ err }, "Admin Thread Cash liability failed");
    return res.status(500).json({ error: "Could not load Thread Cash liability." });
  }
});

export default router;
