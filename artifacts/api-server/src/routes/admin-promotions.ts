/**
 * Admin approval for paid promotions (platform admins only: users.role = 'admin').
 *
 * GET  /api/admin/promotions?status=in_review|approved|rejected|all&kind=all|boost|featured_slot
 * POST /api/admin/promotions/boosts/:id/approve
 * POST /api/admin/promotions/boosts/:id/reject       { reason }
 * POST /api/admin/promotions/featured/:id/approve
 * POST /api/admin/promotions/featured/:id/reject     { reason }
 *
 * Only paid items can be reviewed: a boost/slot reaches `in_review` exclusively
 * through server-verified payment. Approval starts the flight / window; a
 * rejection records the reason and refunds the Stripe payment in full. A
 * rejection whose refund failed can be retried by rejecting again.
 */
import { Router } from "express";
import express from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { boosts, db, featuredSlots, posts, promotionReviews, users } from "@workspace/db";
import { requireAuth, requireModerator } from "../middlewares/requireAuth";
import { checkPostMediaEligibility, refundBoostRecord } from "./boosts";
import { refundSlotRecord, settleSlotWindow } from "./featured-slots";
import { slotDisplayState } from "../lib/promotions/featured";

const router = Router();
router.use(requireAuth);
router.use(requireModerator);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;

function parseReason(body: unknown): string | null {
  const reason = (body as { reason?: unknown } | null)?.reason;
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  return trimmed.length >= 3 && trimmed.length <= REASON_MAX ? trimmed : null;
}

async function audit(kind: "boost" | "featured_slot", targetId: string, reviewerId: string, decision: "approved" | "rejected", reason?: string) {
  await db.insert(promotionReviews).values({ kind, targetId, reviewerId, decision, reason: reason ?? null });
}

// ─── Queue ────────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const status = String(req.query.status ?? "in_review");
  const kind = String(req.query.kind ?? "all");
  if (!["in_review", "approved", "rejected", "all"].includes(status)) {
    return res.status(400).json({ error: "status must be in_review, approved, rejected or all" });
  }
  if (!["all", "boost", "featured_slot"].includes(kind)) {
    return res.status(400).json({ error: "kind must be all, boost or featured_slot" });
  }
  const now = new Date();

  const boostStatusFilter = status === "in_review" ? eq(boosts.status, "in_review")
    : status === "rejected" ? eq(boosts.reviewStatus, "rejected")
    // Legacy rows (approved before review existed) never appear in the queue.
    : status === "approved" ? and(eq(boosts.reviewStatus, "approved"), sql`${boosts.reviewedBy} IS NOT NULL`)
    : sql`(${boosts.status} = 'in_review' OR ${boosts.reviewedBy} IS NOT NULL)`;
  const slotStatusFilter = status === "in_review" ? eq(featuredSlots.status, "in_review")
    : status === "rejected" ? eq(featuredSlots.status, "rejected")
    : status === "approved" ? eq(featuredSlots.status, "approved")
    : inArray(featuredSlots.status, ["in_review", "approved", "rejected"]);

  const [boostRows, slotRows, counts] = await Promise.all([
    kind === "featured_slot" ? Promise.resolve([]) : db
      .select({ b: boosts, caption: posts.caption, mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl, mediaType: posts.mediaType })
      .from(boosts)
      .leftJoin(posts, eq(sql`${posts.id}::text`, boosts.targetId))
      .where(boostStatusFilter)
      .orderBy(desc(boosts.paidAt)).limit(100),
    kind === "boost" ? Promise.resolve([]) : db.select().from(featuredSlots)
      .where(slotStatusFilter).orderBy(desc(featuredSlots.paidAt)).limit(100),
    Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(boosts).where(eq(boosts.status, "in_review")),
      db.select({ n: sql<number>`count(*)` }).from(featuredSlots).where(eq(featuredSlots.status, "in_review")),
    ]),
  ]);

  const sellerIds = [...new Set([...boostRows.map((r) => r.b.sellerId), ...slotRows.map((s) => s.sellerId)])];
  const sellers = sellerIds.length === 0 ? [] : await db
    .select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName, avatarUrl: users.avatarUrl })
    .from(users).where(inArray(users.clerkId, sellerIds));
  const sellerById = new Map(sellers.map((u) => [u.clerkId, { userId: u.clerkId, name: u.brandName ?? u.displayName ?? "Seller", avatarUrl: u.avatarUrl }]));

  const items = [
    ...boostRows.map(({ b, caption, mediaUrl, thumbnailUrl, mediaType }) => ({
      kind: "boost" as const,
      id: b.id,
      seller: sellerById.get(b.sellerId) ?? null,
      state: b.status === "in_review" ? "in_review" : b.reviewStatus === "rejected" ? "rejected" : "approved",
      amountCents: b.budgetCents,
      durationDays: b.durationDays,
      submittedAt: b.paidAt,
      reviewedAt: b.reviewedAt,
      rejectionReason: b.rejectionReason,
      refundStatus: b.refundStatus,
      post: { id: b.targetId, caption, mediaUrl, thumbnailUrl, mediaType },
      window: b.startsAt ? { startsAt: b.startsAt, endsAt: b.endsAt } : null,
    })),
    ...slotRows.map((s) => ({
      kind: "featured_slot" as const,
      id: s.id,
      seller: sellerById.get(s.sellerId) ?? null,
      state: s.status === "in_review" ? "in_review" : s.status === "rejected" ? "rejected" : "approved",
      amountCents: s.priceCents,
      durationDays: s.durationDays,
      submittedAt: s.paidAt,
      reviewedAt: s.reviewedAt,
      rejectionReason: s.rejectionReason,
      refundStatus: s.refundStatus,
      post: null,
      window: { startsAt: s.startsAt, endsAt: s.endsAt },
      displayState: slotDisplayState(s, now),
    })),
  ].sort((a, b) => new Date(b.submittedAt ?? 0).getTime() - new Date(a.submittedAt ?? 0).getTime());

  return res.json({
    items,
    summary: { pendingBoosts: Number(counts[0][0]?.n ?? 0), pendingFeatured: Number(counts[1][0]?.n ?? 0) },
  });
});

// ─── Boosts ───────────────────────────────────────────────────────────────────

router.post("/boosts/:id/approve", async (req, res) => {
  const reviewerId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const [boost] = await db.select().from(boosts).where(eq(boosts.id, id)).limit(1);
    if (!boost) return res.status(404).json({ error: "Boost not found" });
    if (boost.status !== "in_review" || !boost.paidAt || !boost.stripeCheckoutSessionId) {
      return res.status(409).json({ error: "Only paid boosts awaiting review can be approved", code: "not_reviewable" });
    }
    const [post] = await db.select({
      userId: posts.userId, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl, mediaUrls: posts.mediaUrls,
      mediaPaths: posts.mediaPaths, postStatus: posts.postStatus, scheduledAt: posts.scheduledAt, visibility: posts.visibility,
    }).from(posts).where(eq(posts.id, boost.targetId)).limit(1);
    const eligibility = post ? checkPostMediaEligibility(post as any) : { eligible: false as const, reason: "Post no longer exists" };
    if (!eligibility.eligible) {
      return res.status(422).json({ error: eligibility.reason, code: "ineligible_media" });
    }

    const now = new Date();
    const [approved] = await db.update(boosts).set({
      status: "active",
      reviewStatus: "approved",
      reviewedBy: reviewerId,
      reviewedAt: now,
      startsAt: now,
      endsAt: new Date(now.getTime() + boost.durationDays * 86_400_000),
      spentCents: boost.budgetCents,
    }).where(and(
      eq(boosts.id, id),
      eq(boosts.status, "in_review"),
      sql`${boosts.paidAt} IS NOT NULL`,
    )).returning();
    if (!approved) return res.status(409).json({ error: "Boost is no longer in review", code: "not_reviewable" });
    await audit("boost", id, reviewerId, "approved");
    return res.json({ kind: "boost", id, state: "approved", status: approved.status });
  } catch (err) {
    req.log?.error?.({ err, id }, "Failed to approve boost");
    return res.status(500).json({ error: "Failed to approve" });
  }
});

router.post("/boosts/:id/reject", express.json({ limit: "4kb" }), async (req, res) => {
  const reviewerId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id" });
  const reason = parseReason(req.body);
  if (!reason) return res.status(400).json({ error: `A reason of 3–${REASON_MAX} characters is required`, code: "reason_required" });
  try {
    const [boost] = await db.select().from(boosts).where(eq(boosts.id, id)).limit(1);
    if (!boost) return res.status(404).json({ error: "Boost not found" });

    let rejected = boost.status === "rejected" ? boost : null;
    if (!rejected) {
      if (boost.status !== "in_review") {
        return res.status(409).json({ error: "Only boosts awaiting review can be rejected", code: "not_reviewable" });
      }
      const [claimed] = await db.update(boosts).set({
        status: "rejected", reviewStatus: "rejected", reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason,
      }).where(and(eq(boosts.id, id), eq(boosts.status, "in_review"))).returning();
      if (!claimed) return res.status(409).json({ error: "Boost is no longer in review", code: "not_reviewable" });
      rejected = claimed;
      await audit("boost", id, reviewerId, "rejected", reason);
    }
    // Payment is released back to the seller. Idempotent; retried if a previous attempt failed.
    const final = await refundBoostRecord(rejected, "admin_rejected");
    const status = final.refundStatus === "failed" ? 502 : 200;
    return res.status(status).json({ kind: "boost", id, state: "rejected", refundStatus: final.refundStatus, refundId: final.refundId });
  } catch (err) {
    req.log?.error?.({ err, id }, "Failed to reject boost");
    return res.status(500).json({ error: "Failed to reject" });
  }
});

// ─── Featured slots ───────────────────────────────────────────────────────────

router.post("/featured/:id/approve", async (req, res) => {
  const reviewerId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id" });
  try {
    const result = await db.transaction(async (tx) => {
      const [slot] = await tx.select().from(featuredSlots).where(eq(featuredSlots.id, id)).limit(1);
      if (!slot) return { error: 404 as const };
      if (slot.status !== "in_review" || !slot.paidAt) return { error: 409 as const };
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"featured:" + slot.placement}))`);
      const now = new Date();
      const w = await settleSlotWindow(tx, slot, now);
      const [approved] = await tx.update(featuredSlots).set({
        status: "approved", reviewedBy: reviewerId, reviewedAt: now, startsAt: w.startsAt, endsAt: w.endsAt,
      }).where(and(eq(featuredSlots.id, id), eq(featuredSlots.status, "in_review"))).returning();
      return approved ? { slot: approved } : { error: 409 as const };
    });
    if (result.error !== undefined || !result.slot) {
      const code = result.error ?? 409;
      return res.status(code).json({ error: code === 404 ? "Slot not found" : "Only paid slots awaiting review can be approved", code: "not_reviewable" });
    }
    await audit("featured_slot", id, reviewerId, "approved");
    return res.json({ kind: "featured_slot", id, state: "approved", startsAt: result.slot.startsAt, endsAt: result.slot.endsAt });
  } catch (err) {
    req.log?.error?.({ err, id }, "Failed to approve featured slot");
    return res.status(500).json({ error: "Failed to approve" });
  }
});

router.post("/featured/:id/reject", express.json({ limit: "4kb" }), async (req, res) => {
  const reviewerId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "Invalid id" });
  const reason = parseReason(req.body);
  if (!reason) return res.status(400).json({ error: `A reason of 3–${REASON_MAX} characters is required`, code: "reason_required" });
  try {
    const [slot] = await db.select().from(featuredSlots).where(eq(featuredSlots.id, id)).limit(1);
    if (!slot) return res.status(404).json({ error: "Slot not found" });
    let rejected = slot.status === "rejected" ? slot : null;
    if (!rejected) {
      if (slot.status !== "in_review") {
        return res.status(409).json({ error: "Only slots awaiting review can be rejected", code: "not_reviewable" });
      }
      const [claimed] = await db.update(featuredSlots).set({
        status: "rejected", reviewedBy: reviewerId, reviewedAt: new Date(), rejectionReason: reason,
      }).where(and(eq(featuredSlots.id, id), eq(featuredSlots.status, "in_review"))).returning();
      if (!claimed) return res.status(409).json({ error: "Slot is no longer in review", code: "not_reviewable" });
      rejected = claimed;
      await audit("featured_slot", id, reviewerId, "rejected", reason);
    }
    const final = await refundSlotRecord(rejected, "admin_rejected");
    const status = final.refundStatus === "failed" ? 502 : 200;
    return res.status(status).json({ kind: "featured_slot", id, state: "rejected", refundStatus: final.refundStatus, refundId: final.refundId });
  } catch (err) {
    req.log?.error?.({ err, id }, "Failed to reject featured slot");
    return res.status(500).json({ error: "Failed to reject" });
  }
});

export default router;
