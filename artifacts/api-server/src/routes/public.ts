/**
 * Public (unauthenticated) product browsing endpoints for buyers.
 * Mounted at /api/public — no requireAuth middleware.
 */
import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";

const router = Router();

// GET /api/public/products
// Optional query params: ?category=apparel&tag=streetwear&limit=50&offset=0
router.get("/products", async (req, res) => {
  try {
    const { category, tag, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit, 10) || 50, 100);
    const off = parseInt(offset, 10) || 0;

    // Fetch active products
    let query = db
      .select()
      .from(products)
      .where(eq(products.status, "active"))
      .orderBy(desc(products.createdAt))
      .limit(lim)
      .offset(off);

    const rows = await query;

    // Filter by category / tag in JS (keeps query simple; replace with DB filter for scale)
    let filtered = rows;
    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }
    if (tag) {
      filtered = filtered.filter(
        (p) =>
          (p.tags as string[]).includes(tag) ||
          (p.styleTags as string[]).includes(tag)
      );
    }

    if (filtered.length === 0) {
      res.json([]);
      return;
    }

    // Attach variants
    const productIds = filtered.map((p) => p.id);
    const variants = await db
      .select()
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds));

    const variantsByProduct: Record<string, typeof variants> = {};
    for (const v of variants) {
      if (!variantsByProduct[v.productId]) variantsByProduct[v.productId] = [];
      variantsByProduct[v.productId].push(v);
    }

    const result = filtered.map((p) => ({
      ...p,
      variants: variantsByProduct[p.id] ?? [],
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// GET /api/public/products/:id
router.get("/products/:id", async (req, res) => {
  try {
    const [product] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, req.params.id), eq(products.status, "active")))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const variants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, product.id));

    res.json({ ...product, variants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch product" });
  }
});

export default router;
