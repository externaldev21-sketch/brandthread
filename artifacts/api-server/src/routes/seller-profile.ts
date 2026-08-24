/**
 * Seller profile settings — verified status, return / cancellation policies.
 * GET   /api/seller/profile   — read current seller's profile fields
 * PATCH /api/seller/policy    — update return / cancellation policy text
 */
import { Router } from "express";
import { db, interactions, posts, users } from "@workspace/db";
import { and, count, eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

// ─── Startup migration — add tutorial flag + questionnaire columns ─────────────
(async () => {
  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_seller_tutorial BOOLEAN NOT NULL DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS seller_goals JSONB`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS buyer_style_interests JSONB`);
  } catch (err) {
    console.error("[seller-profile] migration error:", err);
  }
})();

const router = Router();
router.use(requireAuth);

// ─── GET /api/seller/profile ──────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const [[user], [likeTotal]] = await Promise.all([
    db
      .select({
        id:                  users.id,
        clerkId:             users.clerkId,
        displayName:         users.displayName,
        brandName:           users.brandName,
        bio:                 users.bio,
        verified:            users.verified,
        verificationStatus:  users.verificationStatus,
        returnPolicy:        users.returnPolicy,
        cancellationPolicy:  users.cancellationPolicy,
        subscriptionStatus:  users.subscriptionStatus,
        subscriptionPlanId:  users.subscriptionPlanId,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId)),
    db
      .select({ totalLikes: count() })
      .from(interactions)
      .innerJoin(posts, eq(posts.id, interactions.postId))
      .where(and(eq(posts.userId, clerkId), eq(interactions.type, "like"))),
  ]);

  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ ...user, totalLikes: Number(likeTotal?.totalLikes ?? 0) });
});

// ─── PATCH /api/seller/policy ─────────────────────────────────────────────────
router.patch("/policy", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { returnPolicy, cancellationPolicy } = req.body as {
    returnPolicy?:       string;
    cancellationPolicy?: string;
  };

  const updates: { returnPolicy?: string; cancellationPolicy?: string; updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (returnPolicy       !== undefined) updates.returnPolicy       = returnPolicy       ?? null as any;
  if (cancellationPolicy !== undefined) updates.cancellationPolicy = cancellationPolicy ?? null as any;

  const [updated] = await db
    .update(users)
    .set(updates)
    .where(eq(users.clerkId, clerkId))
    .returning({
      returnPolicy:       users.returnPolicy,
      cancellationPolicy: users.cancellationPolicy,
    });

  if (!updated) return res.status(404).json({ error: "User not found" });
  return res.json(updated);
});

// ─── POST /api/seller/tutorial/seen ──────────────────────────────────────────
router.post("/tutorial/seen", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  await db.execute(sql`
    UPDATE users
    SET    has_seen_seller_tutorial = TRUE,
           updated_at               = now()
    WHERE  clerk_id = ${clerkId}
  `);
  return res.json({ ok: true });
});

// ─── POST /api/seller/onboarding/data ────────────────────────────────────────
router.post("/onboarding/data", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { goals, brandStage, sellModel, styleInterests } = req.body as {
    goals?:          string[];
    brandStage?:     string;
    sellModel?:      string;
    styleInterests?: string[];
  };

  await db.execute(sql`
    UPDATE users
    SET
      seller_goals          = ${JSON.stringify(goals          ?? [])}::jsonb,
      buyer_style_interests = ${JSON.stringify(styleInterests ?? [])}::jsonb,
      brand_stage = COALESCE(NULLIF(${brandStage ?? ''}, ''), brand_stage),
      sell_model  = COALESCE(NULLIF(${sellModel  ?? ''}, ''), sell_model),
      updated_at  = now()
    WHERE clerk_id = ${clerkId}
  `);
  return res.json({ ok: true });
});

export default router;
