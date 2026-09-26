/**
 * Buyer reviews — create, list by product, list by seller.
 * POST /api/reviews        (requireAuth — buyer)
 * GET  /api/reviews/product/:productId  (public)
 * GET  /api/reviews/seller/:sellerId    (public)
 */
import { Router } from "express";
import { db, reviews, products, users } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { assertReviewOrderAuth } from "../lib/reviewOrderAuth";
import { resolveToClerkId } from "./public";

// ─── Startup migration — add seller reply columns ─────────────────────────────
(async () => {
  try {
    await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_reply TEXT`);
    await db.execute(sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS seller_replied_at TIMESTAMPTZ`);
  } catch (err) {
    logger.error({ err }, "Failed to add review seller reply columns");
  }
})();

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Public: reviews for a product ───────────────────────────────────────────
router.get("/product/:productId", async (req, res) => {
  const { productId } = req.params;
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
    reviews:    rows,
    avgRating:  Number(agg?.avgRating  ?? 0),
    totalCount: Number(agg?.totalCount ?? 0),
  });
});

// Note: buyer-supplied size/fit-note/photo fields aren't in the reviews
// schema yet (see docs backlog) — the buyer review card below degrades
// gracefully (hides those rows) until a migration adds them.

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
    reviews:    rows,
    avgRating:  Number(agg?.avgRating  ?? 0),
    totalCount: Number(agg?.totalCount ?? 0),
  });
});

// ─── Authenticated: create a review ──────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const { orderId, sellerId, productId, rating, body } = req.body as {
    orderId?:   string;
    sellerId:   string;
    productId?: string;
    rating:     number;
    body?:      string;
  };

  if (!sellerId || !rating || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "sellerId and rating (1-5) are required" });
  }

  // orderId is now mandatory — every buyer review must reference a real purchase.
  if (!orderId) {
    return res.status(400).json({ error: "orderId is required" });
  }

  // Authoritative order-ownership + delivery + seller + product checks.
  const authResult = await assertReviewOrderAuth({ orderId, buyerId, sellerId, productId });
  if (!authResult.ok) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  try {
    const [row] = await db
      .insert(reviews)
      .values({
        buyerId,
        sellerId,
        orderId,
        productId: productId ?? null,
        rating,
        body: body?.trim() || null,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err: any) {
    // Unique violation: (buyer_id, order_id) already exists — update idempotently.
    // Drizzle ≥0.44 wraps pg errors in DrizzleQueryError; the pg error code sits
    // on err.cause rather than err itself.  Check both so the guard is robust.
    const pgCode = err?.code ?? (err?.cause as any)?.code;
    if (pgCode === "23505") {
      const [row] = await db
        .update(reviews)
        .set({ rating, body: body?.trim() || null, updatedAt: new Date() })
        .where(and(eq(reviews.buyerId, buyerId), eq(reviews.orderId, orderId)))
        .returning();
      return res.json(row);
    }
    throw err;
  }
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
  `)).rows;
  return res.json(rows);
});

// ─── POST /api/reviews/:reviewId/reply  (seller only)
router.post("/:reviewId/reply", requireAuth, async (req, res) => {
  const sellerId  = (req as any).clerkUserId as string;
  const reviewId = req.params.reviewId as string;
  const { replyText } = req.body as { replyText?: string };

  if (!replyText?.trim()) {
    return res.status(400).json({ error: "replyText is required" });
  }

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
  `)).rows[0];

  return res.json(updated ?? {});
});

export default router;
