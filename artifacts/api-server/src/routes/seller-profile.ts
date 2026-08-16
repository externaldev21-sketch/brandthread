/**
 * Seller profile settings — verified status, return / cancellation policies.
 * GET   /api/seller/profile   — read current seller's profile fields
 * PATCH /api/seller/policy    — update return / cancellation policy text
 */
import { Router } from "express";
import { db, users } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// ─── GET /api/seller/profile ──────────────────────────────────────────────────
router.get("/profile", async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const [user] = await db
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
    .where(eq(users.clerkId, clerkId));

  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json(user);
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

export default router;
