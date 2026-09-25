/**
 * Buyer "recently viewed products" history.
 *
 * Mounted at /api/buyer/recently-viewed (before the catch-all /api/buyer).
 *
 * POST /api/buyer/recently-viewed        — record a view (upsert, bumps viewedAt)
 * GET  /api/buyer/recently-viewed        — list, newest first, live price/image/brand
 */
import { Router } from "express";
import { db, recentlyViewedProducts, products, productVariants, users } from "@workspace/db";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

const MAX_HISTORY = 30;

router.post("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { productId } = req.body as { productId?: string };
  if (!productId) return res.status(400).json({ error: "productId required" });

  const [product] = await db.select({ id: products.id }).from(products)
    .where(eq(products.id, productId)).limit(1);
  if (!product) return res.status(404).json({ error: "Product not found" });

  await db.insert(recentlyViewedProducts)
    .values({ userId, productId })
    .onConflictDoUpdate({
      target: [recentlyViewedProducts.userId, recentlyViewedProducts.productId],
      set: { viewedAt: new Date() },
    });

  // Trim to the most recent MAX_HISTORY rows for this buyer so the table
  // doesn't grow unbounded with a lifetime of casual browsing.
  await db.execute(sql`
    DELETE FROM recently_viewed_products
    WHERE user_id = ${userId}
      AND id NOT IN (
        SELECT id FROM recently_viewed_products
        WHERE user_id = ${userId}
        ORDER BY viewed_at DESC
        LIMIT ${MAX_HISTORY}
      )
  `);

  return res.status(204).end();
});

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "12"), 10) || 12, 1), MAX_HISTORY);

  const rows = await db.select({
    productId: recentlyViewedProducts.productId,
    viewedAt: recentlyViewedProducts.viewedAt,
    name: products.name,
    images: products.images,
    ownerId: products.ownerId,
    status: products.status,
  }).from(recentlyViewedProducts)
    .innerJoin(products, eq(products.id, recentlyViewedProducts.productId))
    .where(and(eq(recentlyViewedProducts.userId, userId), eq(products.status, "active")))
    .orderBy(desc(recentlyViewedProducts.viewedAt))
    .limit(limit);

  if (rows.length === 0) return res.json([]);

  const productIds = rows.map((r) => r.productId);
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const [variantRows, sellerRows] = await Promise.all([
    db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents })
      .from(productVariants).where(inArray(productVariants.productId, productIds)),
    db.select({ clerkId: users.clerkId, displayName: users.displayName, brandName: users.brandName })
      .from(users).where(inArray(users.clerkId, ownerIds)),
  ]);
  const minPriceByProduct = new Map<string, number>();
  for (const v of variantRows) {
    const current = minPriceByProduct.get(v.productId);
    if (current === undefined || v.priceCents < current) minPriceByProduct.set(v.productId, v.priceCents);
  }
  const brandByOwner = new Map(sellerRows.map((s) => [s.clerkId, s.brandName ?? s.displayName ?? "Brand"]));

  return res.json(rows.map((r) => {
    const images = Array.isArray(r.images) ? r.images.filter((i): i is string => typeof i === "string") : [];
    return {
      productId: r.productId,
      name: r.name,
      brand: brandByOwner.get(r.ownerId) ?? "Brand",
      image: images[0] ?? null,
      priceCents: minPriceByProduct.get(r.productId) ?? null,
      viewedAt: r.viewedAt,
    };
  }));
});

export default router;
