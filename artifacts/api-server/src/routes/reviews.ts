/**
 * Buyer reviews — create, list by product, list by seller.
 * POST /api/reviews        (requireAuth — buyer)
 * GET  /api/reviews/product/:productId  (public)
 * GET  /api/reviews/seller/:sellerId    (public)
 */
import express, { Router } from "express";
import crypto from "node:crypto";
import { db, reviews, reviewHelpfulVotes, orders, orderItems, productVariants, products, users } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { assertReviewOrderAuth } from "../lib/reviewOrderAuth";
import { resolveToClerkId } from "./public";
import { toPublicReview } from "../lib/publicProfile";
import { notBlockedWith, optionalViewerId } from "../lib/safety";
import { ObjectStorageService } from "../lib/objectStorage";
import { evaluateContent } from "../lib/contentModerator";
import { publishNotification } from "./notifications-feed";
import {
  MAX_REVIEW_PHOTO_BYTES, REVIEW_REPLY_MAX, normalizeReviewBody, parseFitNote,
  reviewExtras, reviewPhotoPrefix, validateReviewPhotos,
} from "../lib/reviewContent";

// ─── Startup safety net — these columns now ship in migration 113 ─────────────
// Kept (IF NOT EXISTS, harmless) so a database that has not run 113 yet still
// boots; the migration is the source of truth.
(async () => {
  try {
    await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_reply TEXT`);
    await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_replied_at TIMESTAMPTZ`);
  } catch (err) {
    logger.error({ err }, "Failed to add review seller reply columns");
  }
})();

const router = Router();
const objectStorage = new ObjectStorageService();

const REVIEW_PHOTO_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

function hasImageSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

/**
 * Public reviews with their server-derived extras: signed photo URLs, helpful
 * counts, and whether the viewer already voted. `rows` are raw SQL rows or
 * drizzle rows; photo paths never leave the server unsigned.
 */
async function toPublicReviews(rows: Array<Record<string, any>>, viewerId: string | null) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const voteRows = (await db.execute(sql`
    SELECT review_id, count(*)::int AS n,
           bool_or(user_id = ${viewerId ?? ""}) AS mine
    FROM   review_helpful_votes
    WHERE  review_id IN (${idList})
    GROUP  BY review_id
  `)).rows as Array<{ review_id: string; n: number; mine: boolean }>;
  const votes = new Map(voteRows.map((v) => [v.review_id, v]));
  return Promise.all(rows.map(async (r) => {
    const rawPhotos: unknown = r.photos ?? [];
    const paths = Array.isArray(rawPhotos) ? rawPhotos.filter((p): p is string => typeof p === "string") : [];
    const signed = (await Promise.all(paths.map((p) =>
      p.startsWith("/objects/") ? objectStorage.getObjectEntityDownloadURL(p).catch(() => null) : Promise.resolve(p),
    ))).filter((u): u is string => !!u);
    const v = votes.get(r.id);
    return {
      ...toPublicReview(r),
      ...reviewExtras(r, { photos: signed, helpfulCount: v?.n ?? 0, viewerHelpful: !!(viewerId && v?.mine) }),
    };
  }));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Public: reviews for a product ───────────────────────────────────────────
router.get("/product/:productId", async (req, res) => {
  const { productId } = req.params;
  const viewerId = optionalViewerId(req);
  if (!UUID_RE.test(productId)) return res.json({ reviews: [], avgRating: 0, totalCount: 0 });
  // Joined with the buyer's display name + avatar so the buyer-facing review
  // card (Shop sheet + PDP) can show "who" alongside the star rating and
  // text, matching GOAT/SSENSE-style review rows — not just a bare rating.
  const rows = (await db.execute(sql`
    SELECT r.*,
           COALESCE(u.display_name, u.name) AS buyer_name,
           u.profile_image_url              AS buyer_avatar
    FROM   reviews r
    LEFT JOIN users u ON u.clerk_id = r.buyer_id
    WHERE  r.product_id = ${productId}
      ${viewerId ? sql`AND ${notBlockedWith(viewerId, sql.raw("r.buyer_id"))}` : sql``}
    ORDER  BY r.created_at DESC
    LIMIT  50
  `)).rows;

  const [agg] = await db
    .select({
      avgRating:  sql<number>`round(avg(rating)::numeric, 1)`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.productId, productId));

  return res.json({
    reviews:    await toPublicReviews(rows as any[], optionalViewerId(req)),
    avgRating:  Number(agg?.avgRating  ?? 0),
    totalCount: Number(agg?.totalCount ?? 0),
  });
});

// ─── Public: reviews for a seller ────────────────────────────────────────────
// Accepts users.clerkId or users.id (UUID) — resolves to canonical clerkId.
router.get("/seller/:sellerId", async (req, res) => {
  const { sellerId } = req.params;
  if (!sellerId) return res.json({ reviews: [], avgRating: 0, totalCount: 0 });

  // Resolve UUID alias or direct clerkId to canonical clerkId.
  const canonicalClerkId = await resolveToClerkId(sellerId, "seller");
  if (!canonicalClerkId) return res.json({ reviews: [], avgRating: 0, totalCount: 0 });

  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.sellerId, canonicalClerkId))
    .orderBy(desc(reviews.createdAt))
    .limit(50);

  const [agg] = await db
    .select({
      avgRating:  sql<number>`round(avg(rating)::numeric, 1)`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.sellerId, canonicalClerkId));

  return res.json({
    reviews:    await toPublicReviews(rows as any[], optionalViewerId(req)),
    avgRating:  Number(agg?.avgRating  ?? 0),
    totalCount: Number(agg?.totalCount ?? 0),
  });
});

// ─── Authenticated: upload one review photo ──────────────────────────────────
// Same contract as POST /api/returns/evidence: raw image bytes, magic-byte
// check, stored under the buyer's own prefix, private ACL. The reviews routes
// sign the path on read, so only the review card ever shows the photo.
router.post(
  "/photos",
  requireAuth,
  express.raw({ type: "image/*", limit: MAX_REVIEW_PHOTO_BYTES }),
  async (req, res): Promise<void> => {
    const buyerId = (req as any).clerkUserId as string;
    const contentType = String(req.headers["content-type"] ?? "").split(";")[0].toLowerCase();
    const bytes = req.body as Buffer;
    if (!REVIEW_PHOTO_MIMES.has(contentType)) {
      res.status(400).json({ error: "Use a JPEG, PNG, or WebP photo." });
      return;
    }
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_REVIEW_PHOTO_BYTES) {
      res.status(400).json({ error: "Photos must be no larger than 8 MB." });
      return;
    }
    if (!hasImageSignature(bytes, contentType)) {
      res.status(400).json({ error: "The uploaded file does not match its declared image type." });
      return;
    }
    let objectPath: string | null = null;
    try {
      objectPath = await objectStorage.createObjectEntityFromBuffer(
        bytes, contentType, `${reviewPhotoPrefix(buyerId)}${crypto.randomUUID()}`,
      );
      await objectStorage.trySetObjectEntityAclPolicy(objectPath, { owner: buyerId, visibility: "private" });
      res.status(201).json({ objectPath });
    } catch (err) {
      if (objectPath) await objectStorage.deleteObjectEntity(objectPath).catch(() => {});
      logger.error({ err }, "Could not upload review photo");
      res.status(500).json({ error: "The photo could not be uploaded" });
    }
  },
);

// ─── Authenticated: create a review ──────────────────────────────────────────
async function notifyNewReview(input: { buyerId: string; sellerId: string; reviewId: string; rating: number }): Promise<void> {
  if (input.buyerId === input.sellerId) return;
  const [buyer] = await db
    .select({ displayName: users.displayName, name: users.name, username: users.username })
    .from(users)
    .where(eq(users.clerkId, input.buyerId))
    .limit(1);
  const actorName = buyer?.displayName || buyer?.name || (buyer?.username ? `@${buyer.username}` : "A customer");
  await publishNotification({
    userId: input.sellerId,
    category: "reviews",
    type: "new_review",
    title: `${actorName} left a ${input.rating}-star review`,
    actorId: input.buyerId,
    actorName,
    actorHandle: buyer?.username ? `@${buyer.username}` : undefined,
    targetId: input.reviewId,
    targetType: "review",
  });
}

router.post("/", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const { orderId, sellerId, productId, rating, body, photos, fitNote } = req.body as {
    orderId?:   string;
    sellerId:   string;
    productId?: string;
    rating:     number;
    body?:      string;
    photos?:    string[];
    fitNote?:   string;
  };

  if (!sellerId || !rating || rating < 1 || rating > 5 || !Number.isInteger(rating)) {
    return res.status(400).json({ error: "sellerId and rating (1-5) are required" });
  }

  // orderId is now mandatory — every buyer review must reference a real purchase.
  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  const bodyCheck = normalizeReviewBody(body);
  if (!bodyCheck.ok) return res.status(400).json({ error: bodyCheck.error });
  const photoCheck = validateReviewPhotos(photos, buyerId);
  if (!photoCheck.ok) return res.status(400).json({ error: photoCheck.error });
  const fit = parseFitNote(fitNote);
  if (fit === null) return res.status(400).json({ error: "fitNote must be Runs small, True to size or Runs large" });
  if (bodyCheck.body && evaluateContent(bodyCheck.body, "public").action === "reject") {
    return res.status(400).json({ error: "This review can't be posted. Edit it and try again." });
  }

  // Authoritative order-ownership + delivery + seller + product checks.
  const authResult = await assertReviewOrderAuth({ orderId, buyerId, sellerId, productId });
  if (!authResult.ok) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  // The order decides which product (and size) was bought — not the client.
  // With no productId supplied, a single-product order is attributed to that
  // product so the review appears on its page.
  const lines = await db
    .select({ productId: productVariants.productId, size: productVariants.size })
    .from(orderItems)
    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .where(eq(orderItems.orderId, orderId));
  const distinctProducts = [...new Set(lines.map((l) => l.productId))];
  const resolvedProductId = productId ?? (distinctProducts.length === 1 ? distinctProducts[0] : null);
  const sizeBought = resolvedProductId
    ? (lines.find((l) => l.productId === resolvedProductId)?.size ?? null)
    : null;

  const values = {
    productId: resolvedProductId,
    rating,
    body: bodyCheck.body,
    photos: photoCheck.photos,
    sizeBought,
    fitNote: fit?.fitNote ?? null,
    fitScale: fit?.fitScale ?? null,
  };

  try {
    const [row] = await db
      .insert(reviews)
      .values({ buyerId, sellerId, orderId, ...values })
      .returning();
    // A first review (not an edit) tells the seller — in Activity and by push.
    void notifyNewReview({ buyerId, sellerId, reviewId: row.id, rating }).catch((err) =>
      logger.warn({ err, reviewId: row.id }, "New review notification failed"));
    return res.status(201).json({ ...row, ...(await toPublicReviews([row], buyerId))[0] });
  } catch (err: any) {
    // Unique violation: (buyer_id, order_id) already exists — update idempotently.
    // Drizzle ≥0.44 wraps pg errors in DrizzleQueryError; the pg error code sits
    // on err.cause rather than err itself.  Check both so the guard is robust.
    const pgCode = err?.code ?? (err?.cause as any)?.code;
    if (pgCode === "23505") {
      const [row] = await db
        .update(reviews)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(reviews.buyerId, buyerId), eq(reviews.orderId, orderId)))
        .returning();
      return res.json({ ...row, ...(await toPublicReviews([row], buyerId))[0] });
    }
    throw err;
  }
});

// ─── Authenticated: "Helpful" votes (idempotent) ─────────────────────────────
// PUT sets the viewer's vote, DELETE clears it; repeating either is a no-op,
// so a double tap or a retry can never inflate the count. Buyers can't vote
// on their own review.
async function helpfulState(reviewId: string, userId: string) {
  const [row] = (await db.execute(sql`
    SELECT count(*)::int AS n, bool_or(user_id = ${userId}) AS mine
    FROM   review_helpful_votes WHERE review_id = ${reviewId}
  `)).rows as Array<{ n: number; mine: boolean | null }>;
  return { helpfulCount: row?.n ?? 0, viewerHelpful: !!row?.mine };
}

router.put("/:reviewId/helpful", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const reviewId = req.params.reviewId as string;
  if (!UUID_RE.test(reviewId)) return res.status(404).json({ error: "Review not found" });
  const [review] = await db.select({ id: reviews.id, buyerId: reviews.buyerId })
    .from(reviews).where(eq(reviews.id, reviewId)).limit(1);
  if (!review) return res.status(404).json({ error: "Review not found" });
  if (review.buyerId === userId) return res.status(400).json({ error: "You can't vote on your own review" });
  await db.insert(reviewHelpfulVotes).values({ reviewId, userId }).onConflictDoNothing();
  return res.json(await helpfulState(reviewId, userId));
});

router.delete("/:reviewId/helpful", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const reviewId = req.params.reviewId as string;
  if (!UUID_RE.test(reviewId)) return res.status(404).json({ error: "Review not found" });
  await db.delete(reviewHelpfulVotes)
    .where(and(eq(reviewHelpfulVotes.reviewId, reviewId), eq(reviewHelpfulVotes.userId, userId)));
  return res.json(await helpfulState(reviewId, userId));
});

// ─── GET /api/reviews/mine  (seller — received reviews with buyer + product info)
router.get("/mine", requireAuth, async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const rows = (await db.execute(sql`
    SELECT r.*,
           p.name           AS product_name,
           u.name           AS buyer_name,
           u.display_name   AS buyer_display_name,
           u.profile_image_url AS buyer_avatar
    FROM   reviews r
    LEFT JOIN products p ON p.id = r.product_id
    LEFT JOIN users    u ON u.clerk_id = r.buyer_id
    WHERE  r.seller_id = ${sellerId}
    ORDER  BY r.created_at DESC
    LIMIT  100
  `)).rows as Array<Record<string, any>>;
  // Same row shape as before (snake_case) with the stored photo paths replaced
  // by short-lived signed URLs — raw private paths never leave the server.
  const signedPhotos = await Promise.all(rows.map(async (r) => {
    const paths = Array.isArray(r.photos) ? (r.photos as unknown[]).filter((p): p is string => typeof p === "string") : [];
    return (await Promise.all(paths.map((p) =>
      p.startsWith("/objects/") ? objectStorage.getObjectEntityDownloadURL(p).catch(() => null) : Promise.resolve(p),
    ))).filter((u): u is string => !!u);
  }));
  return res.json(rows.map((r, i) => ({ ...r, photos: signedPhotos[i], verified_purchase: !!r.order_id })));
});

// ─── POST /api/reviews/:reviewId/reply  (seller only)
router.post("/:reviewId/reply", requireAuth, async (req, res) => {
  const sellerId  = (req as any).clerkUserId as string;
  const reviewId = req.params.reviewId as string;
  const { replyText } = req.body as { replyText?: string };

  if (typeof replyText !== "string" || !replyText.trim()) {
    return res.status(400).json({ error: "replyText is required" });
  }
  if (replyText.trim().length > REVIEW_REPLY_MAX) {
    return res.status(400).json({ error: `Replies can be up to ${REVIEW_REPLY_MAX} characters.` });
  }
  if (!UUID_RE.test(reviewId)) return res.status(404).json({ error: "Review not found" });

  const [existing] = await db
    .select({ id: reviews.id, sellerId: reviews.sellerId })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);

  if (!existing)                    return res.status(404).json({ error: "Review not found" });
  if (existing.sellerId !== sellerId) return res.status(403).json({ error: "Forbidden" });

  const updated = (await db.execute(sql`
    UPDATE reviews
    SET    seller_reply      = ${replyText.trim()},
           seller_replied_at = now(),
           updated_at        = now()
    WHERE  id        = ${reviewId}
    AND    seller_id = ${sellerId}
    RETURNING *
  `)).rows[0] as Record<string, any> | undefined;

  if (!updated) return res.json({});
  // Private photo paths stay server-side; callers get the reply fields.
  const { photos: _photos, ...rest } = updated;
  return res.json(rest);
});

export default router;
