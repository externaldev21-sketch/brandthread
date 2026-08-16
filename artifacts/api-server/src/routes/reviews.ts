/**
 * Buyer reviews — create, list by product, list by seller.
 * POST /api/reviews        (requireAuth — buyer)
 * GET  /api/reviews/product/:productId  (public)
 * GET  /api/reviews/seller/:sellerId    (public)
 */
import { Router } from "express";
import { db, reviews, orders } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

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

export default router;
