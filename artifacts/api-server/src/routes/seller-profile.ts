/**
 * Seller profile settings — verified status, return / cancellation policies.
 * GET   /api/seller/profile   — read current seller's profile fields
 * PATCH /api/seller/policy    — update return / cancellation policy text
 */
import express, { Router } from "express";
import { db, interactions, orders, posts, users } from "@workspace/db";
import { and, count, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectStorageService } from "../lib/objectStorage";

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
const objectStorage = new ObjectStorageService();

const AVATAR_IMAGE_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function hasValidAvatarSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString() === "RIFF"
    && bytes.subarray(8, 12).toString() === "WEBP";
}

async function displayProfileImage(
  uploadedImagePath: string | null,
  clerkAvatarUrl: string | null,
): Promise<string | null> {
  if (uploadedImagePath?.startsWith("/objects/")) {
    return objectStorage.getObjectEntityDownloadURL(uploadedImagePath).catch(() => clerkAvatarUrl);
  }
  return uploadedImagePath ?? clerkAvatarUrl;
}

// ─── GET /api/seller/profile ──────────────────────────────────────────────────
router.get("/profile", async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;
  const [[user], [likeTotal], [paidOrderMetrics]] = await Promise.all([
    db
      .select({
        id:                  users.id,
        clerkId:             users.clerkId,
        displayName:         users.displayName,
        brandName:           users.brandName,
        bio:                 users.bio,
        website:             users.website,
        username:            users.username,
        profileImageUrl:     users.profileImageUrl,
        avatarUrl:           users.avatarUrl,
        storefrontVisits:    users.storefrontVisitCount,
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
    db
      .select({
        orders:       count(),
        revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
      })
      .from(orders)
      .where(and(
        eq(orders.ownerId, clerkId),
        isNotNull(orders.stripeCheckoutSessionId),
        notInArray(orders.status, ["cancelled", "refund_pending", "refunded"]),
      )),
  ]);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const storefrontVisits = user.storefrontVisits ?? 0;
  const paidOrders = Number(paidOrderMetrics?.orders ?? 0);
  const profileImageUrl = await displayProfileImage(user.profileImageUrl, user.avatarUrl);
  res.json({
    ...user,
    profileImageUrl,
    totalLikes: Number(likeTotal?.totalLikes ?? 0),
    metrics: {
      revenueCents: Number(paidOrderMetrics?.revenueCents ?? 0),
      visitors: storefrontVisits,
      orders: paidOrders,
      conversionRate: storefrontVisits > 0
        ? Math.round((paidOrders / storefrontVisits) * 10_000) / 100
        : 0,
    },
  });
});

// ─── POST /api/seller/profile/avatar/upload ───────────────────────────────────
// A seller-uploaded identity image is stored separately from Clerk's avatar URL,
// so a later Clerk sync cannot overwrite a deliberate brand profile photo.
router.post(
  "/profile/avatar/upload",
  express.raw({ type: "image/*", limit: MAX_AVATAR_BYTES }),
  async (req, res): Promise<void> => {
    const clerkId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;

    if (!AVATAR_IMAGE_MIMES.has(contentType)) {
      res.status(400).json({ error: "Use a JPEG, PNG, or WebP image for your avatar." });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) {
      res.status(400).json({ error: "Avatar images must be no larger than 5 MB." });
      return;
    }
    if (!hasValidAvatarSignature(bytes, contentType)) {
      res.status(400).json({ error: "The uploaded file does not match its declared image type." });
      return;
    }

    const [seller] = await db
      .select({ profileImageUrl: users.profileImageUrl })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (!seller) {
      res.status(404).json({ error: "Seller profile not found" });
      return;
    }

    let objectPath: string | null = null;
    try {
      objectPath = await objectStorage.createObjectEntityFromBuffer(bytes, contentType);
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, {
        owner: clerkId,
        visibility: "private",
      });
      await db
        .update(users)
        .set({ profileImageUrl: objectPath, updatedAt: new Date() })
        .where(eq(users.clerkId, clerkId));

      if (seller.profileImageUrl?.startsWith("/objects/")) {
        void objectStorage.deleteObjectEntity(seller.profileImageUrl).catch((err) => {
          req.log.warn({ err }, "Could not remove replaced seller avatar");
        });
      }

      res.status(201).json({
        profileImageUrl: await objectStorage.getObjectEntityDownloadURL(objectPath),
      });
    } catch (err) {
      if (objectPath) {
        await objectStorage.deleteObjectEntity(objectPath).catch(() => undefined);
      }
      req.log.error({ err }, "Seller avatar upload failed");
      res.status(500).json({ error: "Could not save avatar. Please try again." });
    }
  },
);

// ─── PATCH /api/seller/policy ─────────────────────────────────────────────────
router.patch("/policy", async (req, res): Promise<void> => {
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

  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(updated);
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
