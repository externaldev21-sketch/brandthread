/**
 * Admin → users & sellers.
 *
 * GET  /api/admin/users?q=&kind=all|sellers|buyers|suspended|admins&limit=&offset=
 * GET  /api/admin/users/:clerkId
 * POST /api/admin/users/:clerkId/verify      { verified: boolean }
 * POST /api/admin/users/:clerkId/suspend     { reason }
 * POST /api/admin/users/:clerkId/reinstate
 *
 * Accounts are never deleted from here — only suspended and reinstated.
 */
import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { and, count, desc, eq, ilike, isNotNull, isNull, or, sql, sum } from "drizzle-orm";
import { aiUsageEvents, db, orders, reports, users } from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { deriveSellerVerified } from "../../lib/sellerEligibility";
import { bodyString, likePattern, pageParams, queryString } from "./util";

const router = Router();

function publicUser(u: typeof users.$inferSelect) {
  return {
    clerkId: u.clerkId,
    name: u.displayName || u.name,
    email: u.email,
    username: u.username,
    role: u.role,
    accountType: u.accountType,
    brandName: u.brandName,
    avatarUrl: u.profileImageUrl ?? u.avatarUrl,
    plan: u.subscriptionPlanId,
    subscriptionStatus: u.subscriptionStatus,
    stripeAccountStatus: u.stripeAccountStatus,
    verified: deriveSellerVerified(u),
    verificationStatus: u.verificationStatus,
    suspended: u.suspendedAt != null,
    suspendedAt: u.suspendedAt?.toISOString() ?? null,
    suspensionReason: u.suspensionReason,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const q = queryString(req, "q");
  const kind = queryString(req, "kind") || "all";
  const { limit, offset } = pageParams(req);

  const filters = [isNull(users.deletedAt), eq(users.isSystemAccount, false)];
  if (q) {
    const p = likePattern(q);
    filters.push(or(
      ilike(users.email, p), ilike(users.name, p), ilike(users.displayName, p),
      ilike(users.username, p), ilike(users.brandName, p), eq(users.clerkId, q),
    )!);
  }
  if (kind === "sellers") filters.push(or(eq(users.accountType, "seller"), eq(users.accountType, "both"))!);
  else if (kind === "buyers") filters.push(or(eq(users.accountType, "buyer"), isNull(users.accountType))!);
  else if (kind === "suspended") filters.push(isNotNull(users.suspendedAt));
  else if (kind === "admins") filters.push(eq(users.role, "admin"));
  else if (kind !== "all") return res.status(400).json({ error: "Unknown kind filter" });

  try {
    const where = and(...filters);
    const [rows, [total]] = await Promise.all([
      db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(limit + 1).offset(offset),
      db.select({ n: count() }).from(users).where(where),
    ]);
    return res.json({ items: rows.slice(0, limit).map(publicUser), hasMore: rows.length > limit, total: Number(total?.n ?? 0) });
  } catch (err) {
    req.log.error({ err }, "Admin user list failed");
    return res.status(500).json({ error: "Could not load users." });
  }
});

router.get("/:clerkId", async (req, res) => {
  const clerkId = String(req.params.clerkId);
  try {
    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
    if (!user || user.deletedAt) return res.status(404).json({ error: "User not found" });

    const [sales, purchases, reportsAgainst, ai] = await Promise.all([
      db.select({ n: count(), gross: sum(orders.totalCents), fees: sum(orders.platformFeeCents) })
        .from(orders).where(and(eq(orders.ownerId, clerkId), isNotNull(orders.paidAt))),
      db.select({ n: count(), spent: sum(orders.totalCents) })
        .from(orders).where(and(eq(orders.buyerId, clerkId), isNotNull(orders.paidAt))),
      db.select({ n: count(), open: sql<number>`count(*) FILTER (WHERE ${reports.status} = 'pending')` })
        .from(reports).where(eq(reports.targetOwnerId, clerkId)),
      db.select({ micros: sum(aiUsageEvents.costMicros), calls: count() })
        .from(aiUsageEvents).where(eq(aiUsageEvents.userId, clerkId)),
    ]);

    return res.json({
      ...publicUser(user),
      stripeAccountId: user.stripeAccountId,
      referredByCode: user.referredByCode,
      sales: { orders: Number(sales[0]?.n ?? 0), grossCents: Number(sales[0]?.gross ?? 0), platformFeeCents: Number(sales[0]?.fees ?? 0) },
      purchases: { orders: Number(purchases[0]?.n ?? 0), spentCents: Number(purchases[0]?.spent ?? 0) },
      reports: { total: Number(reportsAgainst[0]?.n ?? 0), open: Number(reportsAgainst[0]?.open ?? 0) },
      aiSpend: { costMicros: Number(ai[0]?.micros ?? 0), calls: Number(ai[0]?.calls ?? 0) },
    });
  } catch (err) {
    req.log.error({ err, clerkId }, "Admin user detail failed");
    return res.status(500).json({ error: "Could not load this user." });
  }
});

router.post("/:clerkId/verify", async (req, res) => {
  const clerkId = String(req.params.clerkId);
  const verified = (req.body as { verified?: unknown } | undefined)?.verified;
  if (typeof verified !== "boolean") return res.status(400).json({ error: "verified must be true or false" });

  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx.select({ verified: users.verified, verificationStatus: users.verificationStatus })
        .from(users).where(eq(users.clerkId, clerkId)).limit(1);
      if (!before) return null;
      await tx.update(users)
        .set({ verified, verificationStatus: verified ? "verified" : "unverified", updatedAt: new Date() })
        .where(eq(users.clerkId, clerkId));
      await recordAdminAction(actorOf(req), {
        action: verified ? "user.verify" : "user.unverify",
        targetType: "user",
        targetId: clerkId,
        summary: verified ? "Granted the verified badge" : "Removed the verified badge",
        metadata: { before },
      }, tx);
      return true;
    });
    if (!result) return res.status(404).json({ error: "User not found" });
    return res.json({ ok: true, verified });
  } catch (err) {
    req.log.error({ err, clerkId }, "Admin verify failed");
    return res.status(500).json({ error: "Could not update the badge." });
  }
});

router.post("/:clerkId/suspend", async (req, res) => {
  const clerkId = String(req.params.clerkId);
  const actor = actorOf(req);
  const reason = bodyString(req.body, "reason", 500);
  if (!reason) return res.status(400).json({ error: "A reason is required to suspend an account." });
  if (clerkId === actor.clerkId) return res.status(400).json({ error: "You can't suspend your own account." });

  try {
    const outcome = await db.transaction(async (tx) => {
      const [target] = await tx.select({ role: users.role, suspendedAt: users.suspendedAt })
        .from(users).where(eq(users.clerkId, clerkId)).limit(1);
      if (!target) return "missing" as const;
      if (target.role === "admin") return "admin" as const;
      await tx.update(users)
        .set({ suspendedAt: new Date(), suspensionReason: reason, activeStanding: false, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkId));
      await recordAdminAction(actor, {
        action: "user.suspend", targetType: "user", targetId: clerkId,
        summary: `Suspended account: ${reason}`, metadata: { reason, alreadySuspended: target.suspendedAt != null },
      }, tx);
      return "ok" as const;
    });
    if (outcome === "missing") return res.status(404).json({ error: "User not found" });
    if (outcome === "admin") return res.status(403).json({ error: "Admin accounts can't be suspended." });

    // Ban in Clerk so every session ends now. The database flag already hides
    // content and blocks publishing, so a Clerk outage doesn't undo it.
    let signedOut = false;
    try { await clerkClient.users.banUser(clerkId); signedOut = true; }
    catch (err) { req.log.warn({ err, clerkId }, "Clerk ban failed after admin suspension"); }
    return res.json({ ok: true, signedOut });
  } catch (err) {
    req.log.error({ err, clerkId }, "Admin suspend failed");
    return res.status(500).json({ error: "Could not suspend this account." });
  }
});

router.post("/:clerkId/reinstate", async (req, res) => {
  const clerkId = String(req.params.clerkId);
  try {
    const found = await db.transaction(async (tx) => {
      const rows = await tx.update(users)
        .set({ suspendedAt: null, suspensionReason: null, activeStanding: true, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkId)).returning({ id: users.id });
      if (rows.length === 0) return false;
      await recordAdminAction(actorOf(req), {
        action: "user.reinstate", targetType: "user", targetId: clerkId, summary: "Lifted the suspension",
      }, tx);
      return true;
    });
    if (!found) return res.status(404).json({ error: "User not found" });
    try { await clerkClient.users.unbanUser(clerkId); }
    catch (err) { req.log.warn({ err, clerkId }, "Clerk unban failed after admin reinstatement"); }
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, clerkId }, "Admin reinstate failed");
    return res.status(500).json({ error: "Could not reinstate this account." });
  }
});

export default router;
