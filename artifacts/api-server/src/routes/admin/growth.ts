/**
 * Admin → growth & promotion tools.
 *
 * Featured on Discover
 *   GET    /api/admin/featured
 *   POST   /api/admin/featured            { kind: 'brand'|'thread', targetId, label?, position?, endsAt? }
 *   PATCH  /api/admin/featured/:id        { active?, position?, label? }
 *   DELETE /api/admin/featured/:id
 * Announcements (push and/or in-app feed)
 *   GET    /api/admin/announcements
 *   POST   /api/admin/announcements       { title, body, audience, sendPush, sendInApp }
 * Invite codes
 *   GET    /api/admin/invites
 *   POST   /api/admin/invites             { label?, maxUses?, expiresAt?, count? }
 *   POST   /api/admin/invites/:id/disable | /enable
 * Promoted-thread (boost) approvals
 *   GET    /api/admin/boosts?status=pending|reviewed|all
 *   POST   /api/admin/boosts/:id/review   { decision: 'approve'|'reject', reason? }
 */
import { Router } from "express";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  adminAnnouncements, adminInviteCodes, boostReviews, boosts, db, featuredItems, notificationsFeed, posts, users,
} from "@workspace/db";
import { actorOf, recordAdminAction } from "../../lib/admin/audit";
import { AUDIENCES, countAudience, deliverAnnouncement, type Audience } from "../../lib/admin/announcements";
import { generateAdminInviteCode } from "../../lib/admin/inviteCodes";
import { UUID_RE, bodyString, pageParams, queryString } from "./util";

const router = Router();

// ─── Featured on Discover ────────────────────────────────────────────────────

async function describeTargets(rows: { kind: string; targetId: string }[]) {
  const brandIds = rows.filter((r) => r.kind === "brand").map((r) => r.targetId);
  const threadIds = rows.filter((r) => r.kind === "thread" && UUID_RE.test(r.targetId)).map((r) => r.targetId);
  const [brands, threads] = await Promise.all([
    brandIds.length ? db.select({ clerkId: users.clerkId, brandName: users.brandName, name: users.name, username: users.username, suspendedAt: users.suspendedAt })
      .from(users).where(inArray(users.clerkId, brandIds)) : [],
    threadIds.length ? db.select({ id: posts.id, caption: posts.caption, userId: posts.userId, thumbnailUrl: posts.thumbnailUrl })
      .from(posts).where(inArray(posts.id, threadIds)) : [],
  ]);
  const out = new Map<string, { title: string; subtitle: string | null; missing: boolean }>();
  for (const b of brands) out.set(`brand:${b.clerkId}`, { title: b.brandName || b.name, subtitle: b.username ? `@${b.username}` : null, missing: b.suspendedAt != null });
  for (const t of threads) out.set(`thread:${t.id}`, { title: (t.caption ?? "").slice(0, 80) || "Untitled thread", subtitle: null, missing: false });
  return out;
}

router.get("/featured", async (req, res) => {
  try {
    const rows = await db.select().from(featuredItems).orderBy(featuredItems.kind, featuredItems.position, desc(featuredItems.createdAt));
    const details = await describeTargets(rows);
    return res.json({
      items: rows.map((r) => ({
        id: r.id, kind: r.kind, targetId: r.targetId, label: r.label, position: r.position, active: r.active,
        endsAt: r.endsAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
        target: details.get(`${r.kind}:${r.targetId}`) ?? { title: "Unavailable", subtitle: null, missing: true },
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin featured list failed");
    return res.status(500).json({ error: "Could not load featured items." });
  }
});

router.post("/featured", async (req, res) => {
  const { kind, targetId: rawTarget, position, endsAt } = (req.body ?? {}) as Record<string, unknown>;
  const targetId = typeof rawTarget === "string" ? rawTarget.trim() : "";
  if (kind !== "brand" && kind !== "thread") return res.status(400).json({ error: "kind must be brand or thread" });
  if (!targetId) return res.status(400).json({ error: "targetId is required" });
  const label = bodyString(req.body, "label", 120) || null;
  const pos = Number.isInteger(position) ? Math.min(Math.max(position as number, 0), 999) : 0;
  let end: Date | null = null;
  if (endsAt != null && endsAt !== "") {
    end = new Date(String(endsAt));
    if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return res.status(400).json({ error: "endsAt must be a future date" });
  }
  try {
    if (kind === "brand") {
      const [brand] = await db.select({ accountType: users.accountType, suspendedAt: users.suspendedAt })
        .from(users).where(and(eq(users.clerkId, targetId), isNull(users.deletedAt))).limit(1);
      if (!brand || (brand.accountType !== "seller" && brand.accountType !== "both")) return res.status(404).json({ error: "No brand with that ID" });
      if (brand.suspendedAt) return res.status(422).json({ error: "Suspended brands can't be featured." });
    } else {
      if (!UUID_RE.test(targetId)) return res.status(404).json({ error: "No thread with that ID" });
      const [post] = await db.select({ id: posts.id }).from(posts)
        .where(and(eq(posts.id, targetId), eq(posts.postStatus, "published"), eq(posts.moderationStatus, "visible"))).limit(1);
      if (!post) return res.status(404).json({ error: "No published thread with that ID" });
    }
    const item = await db.transaction(async (tx) => {
      const [row] = await tx.insert(featuredItems)
        .values({ kind, targetId, label, position: pos, endsAt: end, createdBy: actorOf(req).clerkId })
        .onConflictDoUpdate({
          target: [featuredItems.kind, featuredItems.targetId],
          set: { label, position: pos, endsAt: end, active: true },
        }).returning();
      await recordAdminAction(actorOf(req), {
        action: "featured.add", targetType: kind, targetId, summary: `Featured a ${kind} on Discover`, metadata: { position: pos, endsAt: end?.toISOString() ?? null },
      }, tx);
      return row!;
    });
    return res.status(201).json({ id: item.id });
  } catch (err) {
    req.log.error({ err }, "Admin feature add failed");
    return res.status(500).json({ error: "Could not feature this item." });
  }
});

router.patch("/featured/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Featured item not found" });
  const { active, position } = (req.body ?? {}) as Record<string, unknown>;
  const set: Partial<typeof featuredItems.$inferInsert> = {};
  if (typeof active === "boolean") set.active = active;
  if (Number.isInteger(position)) set.position = Math.min(Math.max(position as number, 0), 999);
  if ("label" in (req.body ?? {})) set.label = bodyString(req.body, "label", 120) || null;
  if (Object.keys(set).length === 0) return res.status(400).json({ error: "Nothing to update" });
  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(featuredItems).set(set).where(eq(featuredItems.id, id)).returning();
      if (updated) await recordAdminAction(actorOf(req), {
        action: "featured.update", targetType: updated.kind, targetId: updated.targetId, summary: "Updated a featured item", metadata: set as Record<string, unknown>,
      }, tx);
      return updated;
    });
    if (!row) return res.status(404).json({ error: "Featured item not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "Admin feature update failed");
    return res.status(500).json({ error: "Could not update this item." });
  }
});

router.delete("/featured/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Featured item not found" });
  try {
    const row = await db.transaction(async (tx) => {
      const [removed] = await tx.delete(featuredItems).where(eq(featuredItems.id, id)).returning();
      if (removed) await recordAdminAction(actorOf(req), {
        action: "featured.remove", targetType: removed.kind, targetId: removed.targetId, summary: `Removed a ${removed.kind} from Discover`,
      }, tx);
      return removed;
    });
    if (!row) return res.status(404).json({ error: "Featured item not found" });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "Admin feature remove failed");
    return res.status(500).json({ error: "Could not remove this item." });
  }
});

// ─── Announcements ───────────────────────────────────────────────────────────

router.get("/announcements", async (req, res) => {
  const { limit, offset } = pageParams(req, { limit: 20, max: 100 });
  try {
    const rows = await db.select().from(adminAnnouncements).orderBy(desc(adminAnnouncements.createdAt)).limit(limit + 1).offset(offset);
    return res.json({
      items: rows.slice(0, limit).map((a) => ({
        id: a.id, title: a.title, body: a.body, audience: a.audience, sendPush: a.sendPush, sendInApp: a.sendInApp,
        status: a.status, recipientCount: a.recipientCount, deliveredCount: a.deliveredCount,
        createdAt: a.createdAt.toISOString(), sentAt: a.sentAt?.toISOString() ?? null,
      })),
      hasMore: rows.length > limit,
    });
  } catch (err) {
    req.log.error({ err }, "Admin announcements list failed");
    return res.status(500).json({ error: "Could not load announcements." });
  }
});

router.get("/announcements/audience", async (req, res) => {
  const audience = queryString(req, "audience") as Audience;
  if (!AUDIENCES.includes(audience)) return res.status(400).json({ error: "Unknown audience" });
  return res.json({ audience, recipients: await countAudience(audience) });
});

router.post("/announcements", async (req, res) => {
  const title = bodyString(req.body, "title", 80);
  const body = bodyString(req.body, "body", 240);
  const audience = (req.body as { audience?: unknown } | undefined)?.audience as Audience;
  const sendPush = (req.body as { sendPush?: unknown } | undefined)?.sendPush !== false;
  const sendInApp = (req.body as { sendInApp?: unknown } | undefined)?.sendInApp !== false;
  if (!title || !body) return res.status(400).json({ error: "A title and message are required." });
  if (!AUDIENCES.includes(audience)) return res.status(400).json({ error: "Choose who receives this announcement." });
  if (!sendPush && !sendInApp) return res.status(400).json({ error: "Choose push, in-app, or both." });
  try {
    const announcement = await db.transaction(async (tx) => {
      const [row] = await tx.insert(adminAnnouncements)
        .values({ title, body, audience, sendPush, sendInApp, createdBy: actorOf(req).clerkId }).returning();
      await recordAdminAction(actorOf(req), {
        action: "announcement.send", targetType: "announcement", targetId: row!.id,
        summary: `Sent "${title}" to ${audience}`, metadata: { audience, sendPush, sendInApp },
      }, tx);
      return row!;
    });
    // Delivery runs after the response: a large audience must not hold the request open.
    void deliverAnnouncement(announcement.id);
    return res.status(202).json({ id: announcement.id, status: announcement.status });
  } catch (err) {
    req.log.error({ err }, "Admin announcement failed");
    return res.status(500).json({ error: "Could not send the announcement." });
  }
});

// ─── Invite codes ────────────────────────────────────────────────────────────

router.get("/invites", async (req, res) => {
  try {
    const rows = await db.select().from(adminInviteCodes).orderBy(desc(adminInviteCodes.createdAt)).limit(200);
    const now = Date.now();
    return res.json({
      items: rows.map((c) => ({
        id: c.id, code: c.code, label: c.label, maxUses: c.maxUses, uses: c.uses,
        expiresAt: c.expiresAt?.toISOString() ?? null, disabled: c.disabledAt != null,
        status: c.disabledAt ? "disabled" : c.expiresAt && c.expiresAt.getTime() <= now ? "expired"
          : c.maxUses != null && c.uses >= c.maxUses ? "used up" : "active",
        createdAt: c.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Admin invites list failed");
    return res.status(500).json({ error: "Could not load invite codes." });
  }
});

router.post("/invites", async (req, res) => {
  const { maxUses, expiresAt, count: rawCount } = (req.body ?? {}) as Record<string, unknown>;
  const label = bodyString(req.body, "label", 80) || null;
  const qty = rawCount == null ? 1 : Number(rawCount);
  if (!Number.isInteger(qty) || qty < 1 || qty > 50) return res.status(400).json({ error: "count must be between 1 and 50" });
  if (maxUses != null && (!Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > 100000)) {
    return res.status(400).json({ error: "maxUses must be a positive whole number" });
  }
  let expires: Date | null = null;
  if (expiresAt != null && expiresAt !== "") {
    expires = new Date(String(expiresAt));
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) return res.status(400).json({ error: "expiresAt must be a future date" });
  }
  try {
    const created = await db.transaction(async (tx) => {
      const made: { id: string; code: string }[] = [];
      while (made.length < qty) {
        const code = generateAdminInviteCode();
        const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.inviteCode, code)).limit(1);
        if (clash) continue;
        const [row] = await tx.insert(adminInviteCodes)
          .values({ code, label, maxUses: (maxUses as number | null) ?? null, expiresAt: expires, createdBy: actorOf(req).clerkId })
          .onConflictDoNothing().returning({ id: adminInviteCodes.id, code: adminInviteCodes.code });
        if (row) made.push(row);
      }
      await recordAdminAction(actorOf(req), {
        action: "invite.create", targetType: "invite_code", targetId: made[0]!.id,
        summary: `Generated ${qty} invite code${qty === 1 ? "" : "s"}${label ? ` (${label})` : ""}`,
        metadata: { count: qty, maxUses: maxUses ?? null, expiresAt: expires?.toISOString() ?? null, codes: made.map((m) => m.code) },
      }, tx);
      return made;
    });
    return res.status(201).json({ codes: created.map((c) => c.code) });
  } catch (err) {
    req.log.error({ err }, "Admin invite create failed");
    return res.status(500).json({ error: "Could not generate invite codes." });
  }
});

for (const [path, disabled] of [["disable", true], ["enable", false]] as const) {
  router.post(`/invites/:id/${path}`, async (req, res) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return res.status(404).json({ error: "Invite code not found" });
    try {
      const row = await db.transaction(async (tx) => {
        const [updated] = await tx.update(adminInviteCodes)
          .set({ disabledAt: disabled ? new Date() : null }).where(eq(adminInviteCodes.id, id)).returning({ code: adminInviteCodes.code });
        if (updated) await recordAdminAction(actorOf(req), {
          action: disabled ? "invite.disable" : "invite.enable", targetType: "invite_code", targetId: id,
          summary: `${disabled ? "Disabled" : "Re-enabled"} invite code ${updated.code}`,
        }, tx);
        return updated;
      });
      if (!row) return res.status(404).json({ error: "Invite code not found" });
      return res.json({ ok: true });
    } catch (err) {
      req.log.error({ err, id }, "Admin invite toggle failed");
      return res.status(500).json({ error: "Could not update this code." });
    }
  });
}

// ─── Promoted-thread approvals ───────────────────────────────────────────────

router.get("/boosts", async (req, res) => {
  const status = queryString(req, "status") || "pending";
  if (!["pending", "reviewed", "all"].includes(status)) return res.status(400).json({ error: "status must be pending, reviewed or all" });
  const { limit, offset } = pageParams(req);
  // Only paid boosts are reviewable: unpaid ones aren't running and have no money attached.
  const reviewable = sql`${boosts.paidAt} IS NOT NULL`;
  const where = status === "pending" ? and(reviewable, isNull(boostReviews.boostId))
    : status === "reviewed" ? and(reviewable, sql`${boostReviews.boostId} IS NOT NULL`) : reviewable;
  try {
    const [rows, [total]] = await Promise.all([
      db.select({ b: boosts, r: boostReviews, caption: posts.caption, thumbnailUrl: posts.thumbnailUrl, mediaUrl: posts.mediaUrl, brandName: users.brandName, sellerName: users.name })
        .from(boosts)
        .leftJoin(boostReviews, eq(boostReviews.boostId, boosts.id))
        .leftJoin(posts, sql`${posts.id}::text = ${boosts.targetId}`)
        .leftJoin(users, eq(users.clerkId, boosts.sellerId))
        .where(where).orderBy(desc(boosts.paidAt)).limit(limit + 1).offset(offset),
      db.select({ n: count() }).from(boosts).leftJoin(boostReviews, eq(boostReviews.boostId, boosts.id)).where(where),
    ]);
    return res.json({
      items: rows.slice(0, limit).map(({ b, r, caption, thumbnailUrl, mediaUrl, brandName, sellerName }) => ({
        id: b.id,
        seller: { clerkId: b.sellerId, name: brandName || sellerName },
        thread: { id: b.targetId, caption, thumbnailUrl: thumbnailUrl ?? mediaUrl },
        objective: b.objective,
        budgetCents: b.budgetCents,
        durationDays: b.durationDays,
        boostStatus: b.status,
        paidAt: b.paidAt?.toISOString() ?? null,
        review: r ? { status: r.status, reason: r.reason, reviewedAt: r.reviewedAt.toISOString() } : null,
      })),
      hasMore: rows.length > limit,
      total: Number(total?.n ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Admin boost list failed");
    return res.status(500).json({ error: "Could not load promoted threads." });
  }
});

router.post("/boosts/:id/review", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Promotion not found" });
  const decision = (req.body as { decision?: unknown } | undefined)?.decision;
  const reason = bodyString(req.body, "reason", 500);
  if (decision !== "approve" && decision !== "reject") return res.status(400).json({ error: "decision must be approve or reject" });
  if (decision === "reject" && !reason) return res.status(400).json({ error: "A reason is required to reject a promotion." });
  const actor = actorOf(req);
  try {
    const outcome = await db.transaction(async (tx) => {
      const [boost] = await tx.select().from(boosts).where(eq(boosts.id, id)).limit(1);
      if (!boost || !boost.paidAt) return "missing" as const;
      const [already] = await tx.select({ boostId: boostReviews.boostId }).from(boostReviews).where(eq(boostReviews.boostId, id)).limit(1);
      if (already) return "reviewed" as const;
      const status = decision === "approve" ? "approved" : "rejected";
      await tx.insert(boostReviews).values({ boostId: id, status, reason: reason || null, reviewedBy: actor.clerkId });
      if (decision === "reject") {
        // Rejecting stops delivery through the boost's existing status. Refunds
        // stay a deliberate, separate step in Stripe — the dashboard moves no money.
        await tx.update(boosts).set({ status: "cancelled" }).where(eq(boosts.id, id));
        await tx.insert(notificationsFeed).values({
          userId: boost.sellerId, category: "system", type: "boost_rejected",
          title: "Your promotion was not approved", body: reason, targetId: id, targetType: "boost",
        });
      }
      await recordAdminAction(actor, {
        action: decision === "approve" ? "boost.approve" : "boost.reject", targetType: "boost", targetId: id,
        summary: `${decision === "approve" ? "Approved" : "Rejected"} a promoted thread (${(boost.budgetCents / 100).toFixed(2)} USD)`,
        metadata: { sellerId: boost.sellerId, threadId: boost.targetId, budgetCents: boost.budgetCents, reason: reason || null },
      }, tx);
      return "ok" as const;
    });
    if (outcome === "missing") return res.status(404).json({ error: "Promotion not found" });
    if (outcome === "reviewed") return res.status(409).json({ error: "This promotion was already reviewed." });
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err, id }, "Admin boost review failed");
    return res.status(500).json({ error: "Could not save the review." });
  }
});

export default router;
