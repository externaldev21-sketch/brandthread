import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/products — scoped to the authenticated user's brand
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      status: products.status,
      images: products.images,
      tags: products.tags,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      variantCount: sql<number>`count(${productVariants.id})::int`,
      totalStock: sql<number>`coalesce(sum(${productVariants.stock}),0)::int`,
      lowStockCount: sql<number>`count(case when ${productVariants.stock} <= ${productVariants.lowStockThreshold} then 1 end)::int`,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(eq(products.ownerId, ownerId))
    .groupBy(products.id)
    .orderBy(desc(products.createdAt));
  res.json(rows);
});

// POST /api/products
router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, description, category = "apparel", status = "draft", images = [], tags = [], variant, variants } = req.body;
  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "name required" }); return;
  }

  // Reject if `variants` is present but is not an array — silently treating it as
  // "no variants" would create an active product with no purchasable SKUs.
  if (variants !== undefined && !Array.isArray(variants)) {
    res.status(400).json({ error: "variants must be an array" }); return;
  }

  // Accept both `variant` (singular, legacy) and `variants` (array, preferred)
  const rawVariantList: any[] = Array.isArray(variants) ? variants : (variant ? [variant] : []);

  // Validate ALL variants before any DB writes so we never leave a partial product
  const validatedVariants: Array<{
    size?: string; color?: string; sku: string;
    priceCents: number; stock: number; lowStockThreshold: number;
  }> = [];
  for (let i = 0; i < rawVariantList.length; i++) {
    const v = rawVariantList[i];
    if (!v.sku || typeof v.sku !== "string" || v.sku.trim() === "") {
      res.status(400).json({ error: `variants[${i}]: sku is required` }); return;
    }
    if (!Number.isInteger(v.priceCents) || v.priceCents <= 0) {
      res.status(400).json({ error: `variants[${i}] (${v.sku}): priceCents must be a positive integer` }); return;
    }
    const stock = v.stock ?? 0;
    if (!Number.isInteger(stock) || stock < 0) {
      res.status(400).json({ error: `variants[${i}] (${v.sku}): stock must be a non-negative integer` }); return;
    }
    const threshold = v.lowStockThreshold ?? 10;
    if (!Number.isInteger(threshold) || threshold < 0) {
      res.status(400).json({ error: `variants[${i}] (${v.sku}): lowStockThreshold must be a non-negative integer` }); return;
    }
    validatedVariants.push({
      size:              v.size,
      color:             v.color,
      sku:               v.sku.trim(),
      priceCents:        v.priceCents,
      stock,
      lowStockThreshold: threshold,
    });
  }

  // Insert product + all variants atomically so a partial failure leaves no orphan records
  const product = await db.transaction(async (tx) => {
    const [prod] = await tx
      .insert(products)
      .values({ ownerId, name: name.trim(), description, category, status, images, tags })
      .returning();

    if (validatedVariants.length > 0) {
      await tx.insert(productVariants).values(
        validatedVariants.map((v) => ({ productId: prod.id, ...v })),
      );
    }

    return prod;
  });

  res.status(201).json(product);
});

// GET /api/products/:id
router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [product] = await db.select().from(products)
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Not found" }); return; }
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, product.id));
  res.json({ ...product, variants });
});

// PUT /api/products/:id
router.put("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, description, category, status, images, tags } = req.body;
  const [updated] = await db.update(products)
    .set({
      ...(name         && { name }),
      ...(description  !== undefined && { description }),
      ...(category     && { category }),
      ...(status       && { status }),
      ...(images       && { images }),
      ...(tags         && { tags }),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// DELETE /api/products/:id — archive
router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [updated] = await db.update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

// POST /api/products/:id/variants
router.post("/:id/variants", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  // Verify product ownership first
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const { size, color, sku, priceCents, stock = 0, lowStockThreshold = 10 } = req.body;
  if (!sku || !priceCents || priceCents <= 0) {
    res.status(400).json({ error: "sku and positive priceCents required" }); return;
  }
  const [variant] = await db.insert(productVariants)
    .values({ productId: req.params.id, size, color, sku, priceCents, stock, lowStockThreshold })
    .returning();
  res.status(201).json(variant);
});

// PATCH /api/products/:id/variants/:variantId — update stock / price (ownership via product join)
router.patch("/:id/variants/:variantId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  // Verify product ownership
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const { stock, priceCents, lowStockThreshold } = req.body;
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    res.status(400).json({ error: "stock must be a non-negative integer" }); return;
  }
  const [updated] = await db.update(productVariants)
    .set({
      ...(stock             !== undefined && { stock }),
      ...(priceCents        !== undefined && priceCents > 0 && { priceCents }),
      ...(lowStockThreshold !== undefined && { lowStockThreshold }),
      updatedAt: new Date(),
    })
    .where(and(eq(productVariants.id, req.params.variantId), eq(productVariants.productId, req.params.id)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Variant not found" }); return; }
  res.json(updated);
});

export default router;
