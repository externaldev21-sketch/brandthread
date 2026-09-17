/**
 * Paid Promotion / Boost Tool
 *
 * POST   /api/boosts                    — create a pending boost (does NOT charge immediately)
 * GET    /api/boosts                    — list seller's own boosts
 * PATCH  /api/boosts/:id               — pause or cancel an active boost
 * POST   /api/boosts/:id/pay           — create (or reuse) a Stripe Checkout Session
 * POST   /api/boosts/:id/pay/verify    — verify payment after browser redirect; activates idempotently
 * GET    /api/boosts/targets            — seller's eligible posts (video OR slideshow with 2+ images)
 * GET    /api/boosts/summary            — aggregate stats
 * GET    /api/boosts/active-post-ids   — feed helper
 *
 * Activation lifecycle (mirrors ad-campaigns):
 *   1. POST /api/boosts           → creates boost with status='pending_payment'
 *   2. POST /api/boosts/:id/pay   → creates Stripe Checkout Session; returns url
 *   3. WebBrowser.openAuthSessionAsync → Stripe-hosted payment page
 *   4. Browser returns → POST /api/boosts/:id/pay/verify → activates idempotently
 *   5. OR: checkout.session.completed webhook → activates idempotently
 *
 * A boost is NEVER activated on client redirect alone — only after server-verified
 * payment_status=paid via /pay/verify or the webhook.
 *
 * Reach estimate formula (shared with adCampaignService):
 *   low  = floor(budgetCents / 100 * 35)   // ~35 per $1
 *   high = floor(budgetCents / 100 * 65)   // ~65 per $1
 * Labeled "estimated reach" — NEVER reported as delivered impressions.
 */
import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { db, boosts, posts, users } from "@workspace/db";
import { and, desc, eq, inArray, or, gte, lte, sum, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requireStripe } from "../lib/stripe";
import { isAllowedBrandthreadCallbackUrl } from "../lib/brandthreadCallbackUrls";

const router = Router();
router.use(requireAuth);

// ─── Constants ────────────────────────────────────────────────────────────────

export const BOOST_BUDGET_MIN_CENTS  = 500;      // $5
export const BOOST_BUDGET_MAX_CENTS  = 100_000;  // $1000
export const BOOST_DURATION_MIN_DAYS = 1;
export const BOOST_DURATION_MAX_DAYS = 30;

const BOOST_OBJECTIVES = ["views", "likes", "followers", "profile_visits"] as const;
type BoostObjective = typeof BOOST_OBJECTIVES[number];

// ─── Shared reach estimate (mirrors adCampaignService.estimateReach exactly) ──

export function estimateBoostReach(budgetCents: number): { low: number; high: number } {
  const dollars = budgetCents / 100;
  return {
    low:  Math.floor(dollars * 35),
    high: Math.floor(dollars * 65),
  };
}

// ─── Shared post-media eligibility helper ─────────────────────────────────────
// Authoritative rule used by targets, create, pay, verify, and webhook activation.
// Eligible: video post OR slideshow post with 2+ ordered images.
// Ineligible: drafts, scheduled-only, deleted/private/archived, single static images,
//             other sellers' posts, posts with missing media.

export type PostEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

export function checkPostMediaEligibility(post: {
  userId: string;
  mediaType: string;
  mediaUrl: string | null;
  mediaUrls?: string[] | null;
  mediaPaths?: string[] | null;
  postStatus: string;
  scheduledAt?: Date | null;
  visibility?: { isPublic?: boolean } | null;
}): PostEligibility {
  // Must be published (or scheduled-and-due)
  const now = new Date();
  const isPublished = post.postStatus === "published";
  const isScheduledAndDue =
    post.postStatus === "scheduled" &&
    post.scheduledAt != null &&
    post.scheduledAt <= now;

  if (!isPublished && !isScheduledAndDue) {
    return { eligible: false, reason: "Post is not publicly published" };
  }

  // Must be public (visibility.isPublic !== false)
  const vis = post.visibility as { isPublic?: boolean } | null | undefined;
  if (vis && vis.isPublic === false) {
    return { eligible: false, reason: "Post is not publicly visible" };
  }

  // Must have media
  if (!post.mediaUrl) {
    return { eligible: false, reason: "Post has no media" };
  }

  // Video: eligible
  if (post.mediaType === "video") {
    return { eligible: true };
  }

  // Slideshow: must have 2+ images
  if (post.mediaType === "slideshow") {
    const paths = (post.mediaPaths ?? []) as string[];
    const urls  = (post.mediaUrls  ?? []) as string[];
    const count = paths.length > 0 ? paths.length : urls.length;
    if (count >= 2) {
      return { eligible: true };
    }
    return { eligible: false, reason: "Slideshow must have at least 2 images to be eligible" };
  }

  // Single static photo: ineligible
  return { eligible: false, reason: "Single static images are not eligible — only videos and slideshows with 2+ images" };
}

// ─── Return-URL allowlist ──────────────────────────────────────────────────────

export function isAllowedBoostReturnUrl(value: unknown): value is string {
  return isAllowedBrandthreadCallbackUrl(value, "boost_checkout");
}

// ─── Internal: find owned boost ───────────────────────────────────────────────

async function findOwnedBoost(id: string, sellerId: string) {
  const [row] = await db
    .select()
    .from(boosts)
    .where(and(eq(boosts.id, id), eq(boosts.sellerId, sellerId)))
    .limit(1);
  return row ?? null;
}

// ─── Internal: activate boost idempotently by Checkout Session ID ─────────────

async function activateBoostBySessionId(
  checkoutSessionId: string,
  paidAt: Date,
): Promise<typeof boosts.$inferSelect | null> {
  const [boost] = await db
    .select()
    .from(boosts)
    .where(eq(boosts.stripeCheckoutSessionId, checkoutSessionId))
    .limit(1);

  if (!boost) return null;
  if (boost.status === "active") return boost; // already activated (idempotent)
  if (boost.status !== "pending_payment") return boost; // wrong state — don't activate

  // Re-validate eligibility inside activation to catch deleted/unpublished posts
  const [postRow] = await db
    .select({
      userId:     posts.userId,
      mediaType:  posts.mediaType,
      mediaUrl:   posts.mediaUrl,
      mediaUrls:  posts.mediaUrls,
      mediaPaths: posts.mediaPaths,
      postStatus: posts.postStatus,
      scheduledAt: posts.scheduledAt,
      visibility:  posts.visibility,
    })
    .from(posts)
    .where(eq(posts.id, boost.targetId))
    .limit(1);

  if (!postRow) return boost; // post deleted — leave pending, do not activate
  const eligibility = checkPostMediaEligibility(postRow);
  if (!eligibility.eligible) return boost; // post no longer eligible — leave pending

  const startsAt = paidAt;
  const endsAt   = new Date(paidAt.getTime() + boost.durationDays * 86_400_000);
  const reach    = estimateBoostReach(boost.budgetCents);

  const [updated] = await db
    .update(boosts)
    .set({
      status:     "active",
      paidAt,
      startsAt,
      endsAt,
      spentCents: boost.budgetCents,
    })
    .where(
      and(
        eq(boosts.stripeCheckoutSessionId, checkoutSessionId),
        eq(boosts.status, "pending_payment"),
      ),
    )
    .returning();

  return updated ?? boost;
}

// ─── Serialize boost for API response ─────────────────────────────────────────

function serializeBoost(b: typeof boosts.$inferSelect) {
  const reach = estimateBoostReach(b.budgetCents);
  return {
    ...b,
    estimatedReachLow:  reach.low,
    estimatedReachHigh: reach.high,
    estimatedReach: {
      low:   reach.low,
      high:  reach.high,
      label: "estimate" as const,
    },
    // Legacy field — kept for compatibility with existing active boost list/summary consumers
    estimatedImpressions: Math.round(b.budgetCents * 0.4),
    paid: b.paidAt != null || b.status === "active",
  };
}

// ─── GET /api/boosts/targets ──────────────────────────────────────────────────
// Seller-owned PUBLISHED posts eligible for Boost:
//   - video posts
//   - slideshow posts with 2+ images
// Excludes: drafts, archived, deleted, single static images, other sellers' posts.

router.get("/targets", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const now = new Date();

  const rows = await db
    .select({
      id:         posts.id,
      mediaUrl:   posts.mediaUrl,
      mediaType:  posts.mediaType,
      mediaUrls:  posts.mediaUrls,
      mediaPaths: posts.mediaPaths,
      caption:    posts.caption,
      createdAt:  posts.createdAt,
      postStatus: posts.postStatus,
      scheduledAt: posts.scheduledAt,
      visibility:  posts.visibility,
    })
    .from(posts)
    .where(
      and(
        eq(posts.userId, sellerId),
        or(
          eq(posts.postStatus, "published"),
          and(
            eq(posts.postStatus, "scheduled"),
            lte(posts.scheduledAt, now),
          ),
        ),
      ),
    )
    .orderBy(desc(posts.createdAt))
    .limit(100);

  // Filter to only video/slideshow(2+) in application layer
  const eligible = rows.filter((row) => {
    const check = checkPostMediaEligibility({
      userId:     sellerId,
      mediaType:  row.mediaType,
      mediaUrl:   row.mediaUrl,
      mediaUrls:  row.mediaUrls as string[] | null,
      mediaPaths: row.mediaPaths as string[] | null,
      postStatus: row.postStatus,
      scheduledAt: row.scheduledAt,
      visibility:  row.visibility as { isPublic?: boolean } | null,
    });
    return check.eligible;
  });

  return res.json(
    eligible.map(({ postStatus: _ps, scheduledAt: _sa, visibility: _vis, ...row }) => ({
      ...row,
      // Determine badge type for UI
      mediaKind: row.mediaType === "video" ? "video" : "slideshow",
      imageCount: row.mediaType === "slideshow"
        ? Math.max(
            (row.mediaPaths as string[] | null)?.length ?? 0,
            (row.mediaUrls as string[] | null)?.length ?? 0,
          )
        : null,
    })),
  );
});

// ─── POST /api/boosts — create pending boost ──────────────────────────────────
// Does NOT charge — creates a pending_payment boost, then /pay initiates Checkout.

router.post("/", express.json({ limit: "16kb" }), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const { targetType, targetId, objective, budgetCents, durationDays } = req.body as {
    targetType?: string;
    targetId?:   string;
    objective?:  string;
    budgetCents?: number;
    durationDays?: number;
  };

  if (!targetType || targetType !== "post") {
    return res.status(400).json({ error: "targetType must be 'post'" });
  }
  if (!targetId || typeof targetId !== "string") {
    return res.status(400).json({ error: "targetId required" });
  }

  // Persist objective='views' for schema compatibility; validate if provided
  const resolvedObjective: BoostObjective = "views";
  if (objective !== undefined && !BOOST_OBJECTIVES.includes(objective as BoostObjective)) {
    return res.status(400).json({ error: "objective must be views, likes, followers, or profile_visits" });
  }

  if (!Number.isInteger(budgetCents) || !budgetCents || budgetCents < BOOST_BUDGET_MIN_CENTS || budgetCents > BOOST_BUDGET_MAX_CENTS) {
    return res.status(400).json({ error: `budgetCents must be a whole number of cents between ${BOOST_BUDGET_MIN_CENTS} and ${BOOST_BUDGET_MAX_CENTS}` });
  }
  if (durationDays !== undefined && (!Number.isInteger(durationDays) || durationDays < BOOST_DURATION_MIN_DAYS || durationDays > BOOST_DURATION_MAX_DAYS)) {
    return res.status(400).json({ error: `durationDays must be a whole number between ${BOOST_DURATION_MIN_DAYS} and ${BOOST_DURATION_MAX_DAYS}` });
  }
  const days = durationDays ?? 7;

  // Verify ownership + published status + media eligibility
  const now = new Date();
  const [postRow] = await db
    .select({
      id:         posts.id,
      userId:     posts.userId,
      mediaType:  posts.mediaType,
      mediaUrl:   posts.mediaUrl,
      mediaUrls:  posts.mediaUrls,
      mediaPaths: posts.mediaPaths,
      postStatus: posts.postStatus,
      scheduledAt: posts.scheduledAt,
      visibility:  posts.visibility,
    })
    .from(posts)
    .where(
      and(
        eq(posts.id, targetId),
        eq(posts.userId, sellerId),
        or(
          eq(posts.postStatus, "published"),
          and(
            eq(posts.postStatus, "scheduled"),
            lte(posts.scheduledAt, now),
          ),
        ),
      ),
    )
    .limit(1);

  if (!postRow) {
    return res.status(404).json({ error: "Boost target not found or not yet published" });
  }

  const eligibility = checkPostMediaEligibility({
    userId:     postRow.userId,
    mediaType:  postRow.mediaType,
    mediaUrl:   postRow.mediaUrl,
    mediaUrls:  postRow.mediaUrls as string[] | null,
    mediaPaths: postRow.mediaPaths as string[] | null,
    postStatus: postRow.postStatus,
    scheduledAt: postRow.scheduledAt,
    visibility:  postRow.visibility as { isPublic?: boolean } | null,
  });

  if (!eligibility.eligible) {
    return res.status(422).json({ error: eligibility.reason, code: "ineligible_media" });
  }

  // endsAt is a placeholder — updated to paidAt+days when payment is confirmed
  const endsAt = new Date(now.getTime() + days * 86_400_000);

  const [boost] = await db
    .insert(boosts)
    .values({
      sellerId,
      targetType,
      targetId,
      objective:  resolvedObjective,
      budgetCents,
      durationDays: days,
      status:    "pending_payment",
      endsAt,
    })
    .returning();

  return res.status(201).json(serializeBoost(boost));
});

// ─── POST /api/boosts/:id/pay — create or reuse Stripe Checkout Session ───────
// Body: { returnUrl: string }
// returnUrl must satisfy isAllowedBoostReturnUrl.
// A still-open session is reused; expired sessions are rotated.
// Boost stays pending_payment until /pay/verify or webhook confirms paid.

router.post("/:id/pay", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const boost = await findOwnedBoost(req.params.id, sellerId);
    if (!boost) return res.status(404).json({ error: "Boost not found" });

    if (boost.status === "active") {
      return res.status(409).json({ error: "Boost is already active", code: "already_active" });
    }
    if (boost.status !== "pending_payment" && boost.status !== "failed") {
      return res.status(409).json({ error: `Boost cannot be paid in status: ${boost.status}` });
    }

    const { returnUrl } = req.body as { returnUrl?: unknown };
    if (!isAllowedBoostReturnUrl(returnUrl)) {
      return res.status(400).json({
        error: "returnUrl must be an allowed Brandthread boost callback URL",
      });
    }

    // Re-validate eligibility before charging
    const now = new Date();
    const [postRow] = await db
      .select({
        userId:     posts.userId,
        mediaType:  posts.mediaType,
        mediaUrl:   posts.mediaUrl,
        mediaUrls:  posts.mediaUrls,
        mediaPaths: posts.mediaPaths,
        postStatus: posts.postStatus,
        scheduledAt: posts.scheduledAt,
        visibility:  posts.visibility,
      })
      .from(posts)
      .where(
        and(
          eq(posts.id, boost.targetId),
          eq(posts.userId, sellerId),
        ),
      )
      .limit(1);

    if (!postRow) {
      return res.status(422).json({ error: "Target post no longer exists", code: "post_not_found" });
    }

    const eligibility = checkPostMediaEligibility({
      userId:     postRow.userId,
      mediaType:  postRow.mediaType,
      mediaUrl:   postRow.mediaUrl,
      mediaUrls:  postRow.mediaUrls as string[] | null,
      mediaPaths: postRow.mediaPaths as string[] | null,
      postStatus: postRow.postStatus,
      scheduledAt: postRow.scheduledAt,
      visibility:  postRow.visibility as { isPublic?: boolean } | null,
    });

    if (!eligibility.eligible) {
      return res.status(422).json({ error: eligibility.reason, code: "ineligible_media" });
    }

    const stripe = requireStripe();

    // ── Reuse still-open session ───────────────────────────────────────────
    let checkoutSessionVersion = boost.checkoutSessionVersion;

    if (boost.stripeCheckoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(boost.stripeCheckoutSessionId);
      if (
        existing.payment_status === "paid" ||
        existing.status === "complete" ||
        existing.status === "open"
      ) {
        return res.json({
          sessionId:     existing.id,
          url:           existing.url,
          paymentStatus: existing.payment_status,
          status:        boost.status,
        });
      }

      // Expired: rotate session atomically
      const [rotated] = await db
        .update(boosts)
        .set({
          stripeCheckoutSessionId: null,
          checkoutSessionVersion: sql`${boosts.checkoutSessionVersion} + 1`,
        })
        .where(
          and(
            eq(boosts.id, boost.id),
            eq(boosts.stripeCheckoutSessionId, boost.stripeCheckoutSessionId),
          ),
        )
        .returning({ checkoutSessionVersion: boosts.checkoutSessionVersion });

      if (rotated) {
        checkoutSessionVersion = rotated.checkoutSessionVersion;
      } else {
        // Another request won the rotation race — re-read and return their session
        const [current] = await db
          .select({ stripeCheckoutSessionId: boosts.stripeCheckoutSessionId })
          .from(boosts)
          .where(eq(boosts.id, boost.id))
          .limit(1);
        if (current?.stripeCheckoutSessionId) {
          const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
          return res.json({
            sessionId:     replacement.id,
            url:           replacement.url,
            paymentStatus: replacement.payment_status,
            status:        boost.status,
          });
        }
      }
    }

    // ── Create new Checkout Session ────────────────────────────────────────
    const budgetDollars = (boost.budgetCents / 100).toFixed(2);
    const productName = `Brandthread Boost · ${boost.durationDays}-day promotion`;

    const successUrl = returnUrl.includes("?")
      ? `${returnUrl}&checkout_session_id={CHECKOUT_SESSION_ID}`
      : `${returnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: boost.budgetCents,
              product_data: {
                name: productName,
                description: `$${budgetDollars} budget · ${boost.durationDays}-day boost · post ${boost.targetId.slice(0, 8)}`,
              },
            },
          },
        ],
        success_url: successUrl,
        cancel_url:  returnUrl,
        metadata: {
          kind:       "boost",
          boostId:    boost.id,
          sellerId,
          targetId:   boost.targetId,
          budgetCents: String(boost.budgetCents),
          durationDays: String(boost.durationDays),
        },
      },
      {
        idempotencyKey: `boost-checkout/${boost.id}/v${checkoutSessionVersion}`,
      },
    );

    // Persist session ID — race-safe: only updates if no other session was persisted first
    const [persisted] = await db
      .update(boosts)
      .set({
        stripeCheckoutSessionId: session.id,
        status: "pending_payment",
      })
      .where(
        and(
          eq(boosts.id, boost.id),
          eq(boosts.sellerId, sellerId),
          sql`${boosts.stripeCheckoutSessionId} IS NULL`,
          eq(boosts.checkoutSessionVersion, checkoutSessionVersion),
        ),
      )
      .returning({ stripeCheckoutSessionId: boosts.stripeCheckoutSessionId });

    if (persisted) {
      return res.status(201).json({
        sessionId:     session.id,
        url:           session.url,
        paymentStatus: session.payment_status,
        status:        "pending_payment",
      });
    }

    // Race: another request persisted a different session — return theirs
    const [current] = await db
      .select({ stripeCheckoutSessionId: boosts.stripeCheckoutSessionId })
      .from(boosts)
      .where(eq(boosts.id, boost.id))
      .limit(1);
    if (current?.stripeCheckoutSessionId) {
      const replacement = await stripe.checkout.sessions.retrieve(current.stripeCheckoutSessionId);
      return res.json({
        sessionId:     replacement.id,
        url:           replacement.url,
        paymentStatus: replacement.payment_status,
        status:        "pending_payment",
      });
    }

    return res.status(409).json({ error: "Checkout session changed; retry" });
  } catch (err) {
    req.log?.error?.({ err, boostId: req.params.id }, "Failed to create Boost Checkout Session");
    return res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

// ─── POST /api/boosts/:id/pay/verify — confirm payment after redirect ─────────
// Called by the mobile client after the browser returns from Stripe Checkout.
// Validates ownership + metadata + amount, checks payment_status=paid,
// and activates the boost idempotently.
// NEVER activates on client redirect alone — only after server-verified payment_status.

router.post("/:id/pay/verify", express.json({ limit: "4kb" }), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const boost = await findOwnedBoost(req.params.id, sellerId);
    if (!boost) return res.status(404).json({ error: "Boost not found" });

    // Already active (webhook or earlier verify call won the race) — idempotent
    if (boost.status === "active") {
      return res.json(serializeBoost(boost));
    }

    if (!boost.stripeCheckoutSessionId) {
      return res.status(409).json({
        error: "No checkout session found for this boost. Start payment first.",
        code:  "no_session",
      });
    }

    const stripe = requireStripe();
    const session = await stripe.checkout.sessions.retrieve(boost.stripeCheckoutSessionId);

    // Validate metadata to prevent cross-boost tampering
    if (
      session.metadata?.kind !== "boost" ||
      session.metadata?.boostId !== boost.id ||
      session.metadata?.sellerId !== sellerId
    ) {
      return res.status(403).json({ error: "Session metadata does not match boost", code: "metadata_mismatch" });
    }

    // Validate exact amount + currency
    if (
      session.amount_total !== boost.budgetCents ||
      session.currency !== "usd"
    ) {
      return res.status(403).json({ error: "Session amount does not match boost budget", code: "amount_mismatch" });
    }

    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      return res.status(402).json({
        error:         "Payment has not been completed",
        paymentStatus: session.payment_status,
        code:          "unpaid",
      });
    }

    const paidAt = new Date();
    const activated = await activateBoostBySessionId(boost.stripeCheckoutSessionId, paidAt);
    return res.json(serializeBoost(activated ?? boost));
  } catch (err) {
    req.log?.error?.({ err, boostId: req.params.id }, "Failed to verify boost payment");
    return res.status(500).json({ error: "Failed to verify payment. Please try again." });
  }
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

  // Mark expired active boosts as completed in the background
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

  return res.json(rows.map(serializeBoost));
});

// ─── PATCH /api/boosts/:id ────────────────────────────────────────────────────

router.patch("/:id", express.json({ limit: "4kb" }), async (req, res) => {
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
  if (existing.status === "pending_payment") {
    return res.status(409).json({ error: "Pending boosts cannot be paused — cancel instead" });
  }

  const [updated] = await db
    .update(boosts)
    .set({ status })
    .where(eq(boosts.id, req.params.id))
    .returning();

  return res.json(serializeBoost(updated));
});

// ─── GET /api/boosts/summary ─────────────────────────────────────────────────

router.get("/summary", async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [impressionTotals] = await db
    .select({ totalImpressions: sum(boosts.impressionsCount) })
    .from(boosts)
    .where(eq(boosts.sellerId, sellerId));

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

// ─── Webhook activation helpers (called from webhooks.ts) ─────────────────────

export async function activateBoostFromCheckoutSession(
  session: {
    id: string;
    payment_status: string;
    amount_total?: number | null;
    currency?: string | null;
    metadata?: Record<string, string> | null;
  },
  paidAt: Date,
): Promise<void> {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return;
  if (session.metadata?.kind !== "boost") return;
  await activateBoostBySessionId(session.id, paidAt);
}

export async function markBoostCheckoutFailed(
  session: { id: string; metadata?: Record<string, string> | null },
): Promise<void> {
  if (session.metadata?.kind !== "boost") return;
  await db
    .update(boosts)
    .set({ status: "failed" })
    .where(
      and(
        eq(boosts.stripeCheckoutSessionId, session.id),
        eq(boosts.status, "pending_payment"),
      ),
    );
}
