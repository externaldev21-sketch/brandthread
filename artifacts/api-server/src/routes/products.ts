import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import crypto from "crypto";

const router = Router();
router.use(requireAuth);
// Resolve team membership: managers act on the owner's store while the audit
// log keeps track of who actually performed each action. Staff are read-only
// here — product mutations below require the manager role.
router.use(teamContext());

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

// POST /api/products (manager+)
router.post("/", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, description, category = "apparel", status = "draft", images = [], tags = [], styleTags = [], variant, variants } = req.body;
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
      .values({ ownerId, name: name.trim(), description, category, status, images, tags, styleTags })
      .returning();

    if (validatedVariants.length > 0) {
      await tx.insert(productVariants).values(
        validatedVariants.map((v) => ({ productId: prod.id, ...v })),
      );
    }

    return prod;
  });

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Created product "${product.name}"`,
      "product", product.id,
    );
  }

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

// PUT /api/products/:id (manager+)
router.put("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const {
    name, description, category, status, images, tags, styleTags,
    // Pre-order fields
    isPreOrder, preOrderClosingDate, preOrderEstShipDate, dropId,
    // Size chart
    sizeChart,
  } = req.body;

  const [updated] = await db.update(products)
    .set({
      ...(name         && { name }),
      ...(description  !== undefined && { description }),
      ...(category     && { category }),
      ...(status       && { status }),
      ...(images       && { images }),
      ...(tags         && { tags }),
      ...(styleTags    !== undefined && { styleTags }),
      // Pre-order
      ...(isPreOrder             !== undefined && { isPreOrder }),
      ...(preOrderClosingDate    !== undefined && { preOrderClosingDate: preOrderClosingDate ? new Date(preOrderClosingDate) : null }),
      ...(preOrderEstShipDate    !== undefined && { preOrderEstShipDate: preOrderEstShipDate ? new Date(preOrderEstShipDate) : null }),
      ...(dropId                 !== undefined && { dropId: dropId ?? null }),
      // Size chart (pass null to clear)
      ...(sizeChart              !== undefined && { sizeChart: sizeChart ?? null }),
      updatedAt: new Date(),
    })
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Updated product "${updated.name}"`,
      "product", updated.id,
    );
  }

  res.json(updated);
});

// DELETE /api/products/:id — archive (manager+)
router.delete("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [updated] = await db.update(products)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Archived product "${updated.name}"`,
      "product", updated.id,
    );
  }

  res.json({ success: true });
});

// POST /api/products/:id/variants (manager+)
router.post("/:id/variants", requireRole("manager"), async (req, res) => {
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
router.patch("/:id/variants/:variantId", requireRole("manager"), async (req, res) => {
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

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Updated variant ${updated.sku}`,
      "product", req.params.id, { variantId: updated.id },
    );
  }

  res.json(updated);
});

// POST /api/products/import — CSV bulk product import
// Body: { rows: Array<{ name: string, description?: string, category?: string, price: string, sku?: string, images?: string, tags?: string }> }
// Limits: max 100 rows per call
router.post("/import", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array required" }); return;
  }
  if (rows.length > 100) {
    res.status(400).json({ error: "Maximum 100 rows per import" }); return;
  }

  const results: { success: boolean; name: string; productId?: string; error?: string }[] = [];

  for (const row of rows) {
    const name = String(row.name ?? '').trim();
    if (!name) { results.push({ success: false, name: '(empty)', error: 'name is required' }); continue; }

    const priceCents = Math.round(parseFloat(String(row.price ?? '0')) * 100);
    if (isNaN(priceCents) || priceCents < 0) { results.push({ success: false, name, error: 'invalid price' }); continue; }

    const category = String(row.category ?? 'apparel').toLowerCase().trim() || 'apparel';
    const description = String(row.description ?? '').trim() || null;
    const sku = String(row.sku ?? '').trim() || null;
    const images = String(row.images ?? '').split('|').map((s: string) => s.trim()).filter(Boolean);
    const tags = String(row.tags ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);

    try {
      const [product] = await db.insert(products).values({
        id: crypto.randomUUID(),
        ownerId,
        name,
        description: description ?? '',
        category,
        status: 'draft',
        images,
        tags,
      }).returning({ id: products.id });

      // Insert a default variant if price > 0
      if (priceCents > 0) {
        await db.insert(productVariants).values({
          id: crypto.randomUUID(),
          productId: product.id,
          sku: sku ?? (name.replace(/\s+/g, '-').toUpperCase() + '-DEFAULT'),
          priceCents,
          stock: 0,
          lowStockThreshold: 5,
        });
      }

      results.push({ success: true, name, productId: product.id });
    } catch (err: any) {
      results.push({ success: false, name, error: err.message ?? 'Insert failed' });
    }
  }

  const successCount = results.filter(r => r.success).length;

  if (successCount > 0) {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Imported ${successCount} product${successCount === 1 ? "" : "s"} via CSV`,
      "product", undefined, { successCount, failCount: results.length - successCount },
    );
  }

  res.status(201).json({ successCount, failCount: results.length - successCount, results });
});

export default router;
