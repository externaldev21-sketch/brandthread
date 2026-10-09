/**
 * Admin → overview, AI spend, audit log.
 *
 * GET /api/admin/overview
 * GET /api/admin/ai-spend?days=30&limit=&offset=   per-user spend, highest first
 * GET /api/admin/audit?actor=&action=&targetId=&limit=&offset=
 */
import { Router } from "express";
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { adminAuditLog, aiUsageEvents, boostReviews, boosts, db, disputes, orders, reports, users } from "@workspace/db";
import { clampDays, likePattern, pageParams, queryString } from "./util";
import { accountBalanceCents } from "../../lib/money/ledger";

const router = Router();

router.get("/overview", async (req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  try {
    const [[people], [sales], [open], [disp], [pendingBoosts], threadCashLiabilityCents] = await Promise.all([
      db.select({
        total: count(),
        sellers: sql<number>`count(*) FILTER (WHERE ${users.accountType} IN ('seller','both'))`,
        suspended: sql<number>`count(*) FILTER (WHERE ${users.suspendedAt} IS NOT NULL)`,
        joined30d: sql<number>`count(*) FILTER (WHERE ${users.createdAt} >= ${since})`,
      }).from(users).where(and(isNull(users.deletedAt), eq(users.isSystemAccount, false))),
      db.select({ orders: count(), gmv: sum(orders.totalCents), fees: sum(orders.platformFeeCents), feesRefunded: sum(orders.platformFeeRefundedCents) })
        .from(orders).where(and(isNotNull(orders.paidAt), gte(orders.paidAt, since))),
      db.select({ n: count() }).from(reports).where(eq(reports.status, "pending")),
      db.select({ n: count() }).from(disputes)
        .where(sql`${disputes.status} IN ('needs_response','under_review','warning_needs_response','warning_under_review')`),
      db.select({ n: count() }).from(boosts)
        .leftJoin(boostReviews, eq(boostReviews.boostId, boosts.id))
        .where(and(isNotNull(boosts.paidAt), isNull(boostReviews.boostId))),
      // Thread Cash owed to holders, per the money ledger (detail: /thread-cash/liability).
      accountBalanceCents(db, { account: "thread_cash_liability" }),
    ]);
    return res.json({
      users: Number(people?.total ?? 0),
      sellers: Number(people?.sellers ?? 0),
      suspended: Number(people?.suspended ?? 0),
      joinedLast30Days: Number(people?.joined30d ?? 0),
      orders30d: Number(sales?.orders ?? 0),
      gmv30dCents: Number(sales?.gmv ?? 0),
      platformFees30dCents: Number(sales?.fees ?? 0) - Number(sales?.feesRefunded ?? 0),
      openReports: Number(open?.n ?? 0),
      openDisputes: Number(disp?.n ?? 0),
      boostsAwaitingReview: Number(pendingBoosts?.n ?? 0),
      threadCashLiabilityCents,
    });
  } catch (err) {
    req.log.error({ err }, "Admin overview failed");
    return res.status(500).json({ error: "Could not load the overview." });
  }
});

router.get("/ai-spend", async (req, res) => {
  const days = clampDays(req);
  const { limit, offset } = pageParams(req);
  const since = new Date(Date.now() - days * 86_400_000);
  try {
    const inRange = gte(aiUsageEvents.createdAt, since);
    const perUser = await db.select({
      userId: aiUsageEvents.userId,
      costMicros: sum(aiUsageEvents.costMicros),
      calls: count(),
      inputTokens: sum(aiUsageEvents.inputTokens),
      outputTokens: sum(aiUsageEvents.outputTokens),
      unpriced: sql<number>`count(*) FILTER (WHERE NOT ${aiUsageEvents.priced})`,
    }).from(aiUsageEvents).where(inRange).groupBy(aiUsageEvents.userId)
      .orderBy(desc(sum(aiUsageEvents.costMicros))).limit(limit + 1).offset(offset);
    const page = perUser.slice(0, limit);

    const ids = page.map((r) => r.userId).filter((id): id is string => !!id);
    const profiles = ids.length
      ? await db.select({ clerkId: users.clerkId, name: users.name, displayName: users.displayName, email: users.email, plan: users.subscriptionPlanId })
          .from(users).where(inArray(users.clerkId, ids))
      : [];
    const byId = new Map(profiles.map((p) => [p.clerkId, p]));

    const [[totals], byFeature] = await Promise.all([
      db.select({ micros: sum(aiUsageEvents.costMicros), calls: count(), unpriced: sql<number>`count(*) FILTER (WHERE NOT ${aiUsageEvents.priced})` })
        .from(aiUsageEvents).where(inRange),
      db.select({ feature: aiUsageEvents.feature, micros: sum(aiUsageEvents.costMicros), calls: count() })
        .from(aiUsageEvents).where(inRange).groupBy(aiUsageEvents.feature).orderBy(desc(sum(aiUsageEvents.costMicros))),
    ]);

    return res.json({
      days,
      totalCostMicros: Number(totals?.micros ?? 0),
      totalCalls: Number(totals?.calls ?? 0),
      unpricedCalls: Number(totals?.unpriced ?? 0),
      byFeature: byFeature.map((f) => ({ feature: f.feature, costMicros: Number(f.micros ?? 0), calls: Number(f.calls) })),
      items: page.map((r) => {
        const p = r.userId ? byId.get(r.userId) : undefined;
        return {
          userId: r.userId,
          name: p ? (p.displayName || p.name) : r.userId ? "Unknown user" : "System (no user)",
          email: p?.email ?? null,
          plan: p?.plan ?? null,
          costMicros: Number(r.costMicros ?? 0),
          calls: Number(r.calls),
          inputTokens: Number(r.inputTokens ?? 0),
          outputTokens: Number(r.outputTokens ?? 0),
          unpricedCalls: Number(r.unpriced),
        };
      }),
      hasMore: perUser.length > limit,
    });
  } catch (err) {
    req.log.error({ err }, "Admin AI spend failed");
    return res.status(500).json({ error: "Could not load AI spend." });
  }
});

router.get("/audit", async (req, res) => {
  const { limit, offset } = pageParams(req, { limit: 50, max: 200 });
  const actor = queryString(req, "actor");
  const action = queryString(req, "action");
  const targetId = queryString(req, "targetId");
  const filters = [];
  if (actor) filters.push(eq(adminAuditLog.actorClerkId, actor));
  if (action) filters.push(ilike(adminAuditLog.action, likePattern(action)));
  if (targetId) filters.push(eq(adminAuditLog.targetId, targetId));
  try {
    const where = filters.length ? and(...filters) : undefined;
    const [rows, [total]] = await Promise.all([
      db.select().from(adminAuditLog).where(where).orderBy(desc(adminAuditLog.createdAt)).limit(limit + 1).offset(offset),
      db.select({ n: count() }).from(adminAuditLog).where(where),
    ]);
    return res.json({
      items: rows.slice(0, limit).map((r) => ({
        id: r.id,
        actor: { clerkId: r.actorClerkId, email: r.actorEmail },
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: r.summary,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
      hasMore: rows.length > limit,
      total: Number(total?.n ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Admin audit list failed");
    return res.status(500).json({ error: "Could not load the audit log." });
  }
});

export default router;
