/**
 * Paid Promotion / Boost Tool
 *
 * POST   /api/boosts          — create a boost + charge seller's card via Stripe
 * GET    /api/boosts          — list seller's own boosts
 * PATCH  /api/boosts/:id      — pause or cancel a boost
 *
 * Boost ranking is applied server-side in /api/posts/feed and /api/public/posts:
 * active boosted posts are surfaced before un-boosted content of the same epoch.
 */
import { Router } from "express";
import { db, boosts, posts, products, users } from "@workspace/db";
import { and, desc, eq, inArray, or, gte, sum, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";

const router = Router();
router.use(requireAuth);

const BOOST_OBJECTIVES = ["views", "likes", "followers", "profile_visits"] as const;
type BoostObjective = typeof BOOST_OBJECTIVES[number];

// ─── GET /api/boosts/targets ──────────────────────────────────────────────────
// Seller-owned posts eligible for the direct Promote flow.
router.get("/targets", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      id: posts.id,
      mediaUrl: posts.mediaUrl,
      mediaType: posts.mediaType,
      caption: posts.caption,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(eq(posts.userId, sellerId))
    .orderBy(desc(posts.createdAt))
    .limit(60);

  return res.json(rows);
});

// ─── POST /api/boosts ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { targetType, targetId, objective, budgetCents, durationDays } = req.body as {
    targetType?: string;
    targetId?:   string;
    objective?: string;
    budgetCents?: number;
    durationDays?: number;
  };

  if (!targetType || !["post", "product"].includes(targetType)) {
    return res.status(400).json({ error: "targetType must be 'post' or 'product'" });
  }
  if (!targetId || typeof targetId !== "string") {
    return res.status(400).json({ error: "targetId required" });
  }
  if (!objective || !BOOST_OBJECTIVES.includes(objective as BoostObjective)) {
    return res.status(400).json({ error: "objective must be views, likes, followers, or profile_visits" });
  }
  if (!Number.isInteger(budgetCents) || !budgetCents || budgetCents < 500 || budgetCents > 100_000) {
    return res.status(400).json({ error: "budgetCents must be a whole number of cents between 500 and 100000" });
  }
  if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 90)) {
    return res.status(400).json({ error: "durationDays must be a whole number between 1 and 90" });
  }
  const days = durationDays ?? 7;

  // Never let a seller pay to promote content owned by another account.
  const ownershipRows = targetType === "post"
    ? await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, targetId), eq(posts.userId, sellerId)))
        .limit(1)
    : await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, targetId), eq(products.ownerId, sellerId)))
        .limit(1);
  if (ownershipRows.length === 0) {
    return res.status(404).json({ error: "Boost target not found" });
  }

  // Fetch seller to get stripeCustomerId
  const [seller] = await db
    .select({ stripeCustomerId: users.stripeCustomerId, brandName: users.brandName, displayName: users.displayName })
    .from(users)
    .where(eq(users.clerkId, sellerId))
    .limit(1);

  if (!seller) return res.status(404).json({ error: "Seller not found" });

  let stripePaymentIntentId: string | null = null;

  if (seller.stripeCustomerId) {
    try {
      const stripe = requireStripe();
      // Retrieve the customer's default payment method
      const customer = await stripe.customers.retrieve(seller.stripeCustomerId) as any;
      const defaultPm =
        customer?.invoice_settings?.default_payment_method ??
        customer?.default_source;

      if (defaultPm) {
        // Off-session charge against their stored card
        const pi = await stripe.paymentIntents.create({
          amount:               budgetCents,
          currency:             "usd",
          customer:             seller.stripeCustomerId,
          payment_method:       typeof defaultPm === "string" ? defaultPm : defaultPm.id,
          confirm:              true,
          off_session:          true,
          description:          `Brandthread boost — ${targetType} ${targetId}`,
          metadata:             { sellerId, targetType, targetId, objective },
        });
        stripePaymentIntentId = pi.id;
      }
      // If no payment method on file, we allow the boost but mark it unpaid.
      // The mobile UI should warn the seller to add a card.
    } catch (stripeErr: any) {
      // Propagate payment errors clearly
      if (stripeErr?.code === "card_declined") {
        return res.status(402).json({
          error: "Card declined. Please update your payment method in Billing.",
          code: "card_declined",
        });
      }
      // For other Stripe errors (no PM on file etc.), proceed without charge
      // and flag as unpaid so the mobile can surface a warning.
    }
  }

  const endsAt = new Date(Date.now() + days * 86_400_000);

  const [boost] = await db
    .insert(boosts)
    .values({
      sellerId,
      targetType,
      targetId,
      objective,
      budgetCents,
      // Record spend immediately: if Stripe charged the seller, the full budget
      // is committed at boost creation. Unpaid / no-payment-method boosts stay at 0.
      spentCents: stripePaymentIntentId ? budgetCents : 0,
      durationDays: days,
      stripePaymentIntentId,
      status:   "active",
      endsAt,
    })
    .returning();

  return res.status(201).json({
    ...boost,
    paid: !!stripePaymentIntentId,
    estimatedImpressions: Math.round(budgetCents * 0.4), // ~40 impressions per $1
  });
});

// ─── GET /api/boosts ──────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { targetId } = req.query as { targetId?: string };

  const conditions = [eq(boosts.sellerId, sellerId)];
  if (targetId) conditions.push(eq(boosts.targetId, targetId));

  const rows = await db
    .select()
    .from(boosts)
    .where(and(...conditions))
    .orderBy(desc(boosts.createdAt))
    .limit(50);

  // Mark expired boosts as completed in the background
  const now = new Date();
  const toComplete = rows
    .filter((b) => b.status === "active" && b.endsAt < now)
    .map((b) => b.id);
  if (toComplete.length > 0) {
    db.update(boosts)
      .set({ status: "completed" })
      .where(inArray(boosts.id, toComplete))
      .catch(() => {});
  }

  return res.json(
    rows.map((b) => ({
      ...b,
      estimatedImpressions: Math.round(b.budgetCents * 0.4),
    }))
  );
});

// ─── PATCH /api/boosts/:id ────────────────────────────────────────────────────
router.patch("/:id", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { status } = req.body as { status?: string };

  if (!status || !["paused", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "status must be 'paused' or 'cancelled'" });
  }

  const [existing] = await db
    .select({ id: boosts.id, status: boosts.status })
    .from(boosts)
    .where(and(eq(boosts.id, req.params.id), eq(boosts.sellerId, sellerId)))
    .limit(1);

  if (!existing) return res.status(404).json({ error: "Boost not found" });
  if (existing.status === "completed") {
    return res.status(409).json({ error: "Completed boosts cannot be modified" });
  }

  const [updated] = await db
    .update(boosts)
    .set({ status })
    .where(eq(boosts.id, req.params.id))
    .returning();

  return res.json(updated);
});

// ─── GET /api/boosts/summary ─────────────────────────────────────────────────
// Returns aggregate stats for the authenticated seller's boosts.
// { totalImpressions, spentCentsThisMonth, activeCount }
//
// totalImpressions — lifetime sum across ALL boosts (no date filter):
//   impressionsCount is a cumulative counter on each boost row, so filtering
//   by createdAt would miss ongoing campaigns launched last month and would
//   double-count impressions for any campaign that spans a month boundary.
//
// spentCentsThisMonth — sum of budgetCents for non-cancelled boosts whose
//   payment was processed this calendar month (createdAt >= first of month).
router.get("/summary", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Lifetime impressions — no date filter so all active/completed campaigns count
  const [impressionTotals] = await db
    .select({ totalImpressions: sum(boosts.impressionsCount) })
    .from(boosts)
    .where(eq(boosts.sellerId, sellerId));

  // Spend this calendar month — only boosts created (and thus charged) this month
  const [spendTotals] = await db
    .select({ totalSpentCents: sum(boosts.spentCents) })
    .from(boosts)
    .where(and(
      eq(boosts.sellerId, sellerId),
      gte(boosts.createdAt, monthStart),
    ));

  const [activeCnt] = await db
    .select({ cnt: count() })
    .from(boosts)
    .where(and(
      eq(boosts.sellerId, sellerId),
      eq(boosts.status, "active"),
      gte(boosts.endsAt, now),
    ));

  return res.json({
    totalImpressions:    Number(impressionTotals?.totalImpressions ?? 0),
    spentCentsThisMonth: Number(spendTotals?.totalSpentCents ?? 0),
    activeCount:         Number(activeCnt?.cnt ?? 0),
  });
});

// ─── GET /api/boosts/active-post-ids ─────────────────────────────────────────
// Internal helper: used by posts feed to find currently active boosted post IDs.
// Query: ?ids[]=uuid1&ids[]=uuid2 (the candidate post IDs from the feed page)
router.get("/active-post-ids", async (req, res) => {
  const raw = req.query.ids;
  if (!raw) return res.json([]);
  const ids = (Array.isArray(raw) ? raw : [raw]) as string[];
  if (ids.length === 0) return res.json([]);

  const now = new Date();
  const rows = await db
    .select({ targetId: boosts.targetId })
    .from(boosts)
    .where(
      and(
        eq(boosts.targetType, "post"),
        eq(boosts.status, "active"),
        inArray(boosts.targetId, ids),
        gte(boosts.endsAt, now),
      )
    );

  return res.json(rows.map((r) => r.targetId));
});

export default router;
