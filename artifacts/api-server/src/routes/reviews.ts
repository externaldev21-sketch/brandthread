/**
 * Buyer reviews — create, list by product, list by seller.
 * POST /api/reviews        (requireAuth — buyer)
 * GET  /api/reviews/product/:productId  (public)
 * GET  /api/reviews/seller/:sellerId    (public)
 */
import { Router } from "express";
import { db, reviews, orders, products, users } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

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
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.productId, productId))
    .orderBy(desc(reviews.createdAt))
    .limit(50);

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

// ─── Public: reviews for a seller ────────────────────────────────────────────
router.get("/seller/:sellerId", async (req, res) => {
  const { sellerId } = req.params;
  if (!sellerId) return res.json({ reviews: [], avgRating: 0, totalCount: 0 });
  const rows = await db
    .select()
    .from(reviews)
    .where(eq(reviews.sellerId, sellerId))
    .orderBy(desc(reviews.createdAt))
    .limit(50);

  const [agg] = await db
    .select({
      avgRating:  sql<number>`round(avg(rating)::numeric, 1)`,
      totalCount: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(eq(reviews.sellerId, sellerId));

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

  // If orderId provided, verify the order exists and has a delivered/fulfilled status.
  if (orderId) {
    const [order] = await db
      .select({ id: orders.id, status: orders.status, ownerId: orders.ownerId })
      .from(orders)
      .where(eq(orders.id, orderId));

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!["delivered", "fulfilled"].includes(order.status ?? "")) {
      return res.status(400).json({ error: "Can only review a delivered order" });
    }
  }

  try {
    const [row] = await db
      .insert(reviews)
      .values({
        buyerId,
        sellerId,
        orderId:   orderId   ?? null,
        productId: productId ?? null,
        rating,
        body: body?.trim() || null,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err: any) {
    if (err?.code === "23505") {
      // Update the existing review instead of creating a duplicate
      const [row] = await db
        .update(reviews)
        .set({ rating, body: body?.trim() || null, updatedAt: new Date() })
        .where(orderId
          ? and(eq(reviews.buyerId, buyerId), eq(reviews.orderId, orderId))
          : eq(reviews.buyerId, buyerId))
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
