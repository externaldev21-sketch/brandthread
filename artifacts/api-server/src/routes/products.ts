import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, desc, sql, and, isNull, gt, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import crypto from "crypto";
import { canRestoreProduct, PRODUCT_DELETE_RECOVERY_WINDOW_MS } from "../lib/productRecovery";
import { getVerifiedPlanAccess, sendPlanLimitReached, sendPlanLookupUnavailable } from "../lib/planAccess";

const router = Router();
/** Short server-side recovery interval; exported so integration tests need not
 * depend on a magic number. */
export { PRODUCT_DELETE_RECOVERY_WINDOW_MS } from "../lib/productRecovery";
router.use(requireAuth);
// Resolve team membership: managers act on the owner's store while the audit
// log keeps track of who actually performed each action. Staff are read-only
// here — product mutations below require the manager role.
router.use(teamContext());

async function getProductAccess(req: any, res: any) {
  const ownerId = req.clerkUserId as string;
  try {
    return await getVerifiedPlanAccess(ownerId);
  } catch (error) {
    sendPlanLookupUnavailable(req, res, error);
    return null;
  }
}

async function hasProductCapacity(tx: any, ownerId: string, limit: number | null, requested: number): Promise<boolean> {
  if (limit === null) return true;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"product-limit:" + ownerId}))`);
  const [result] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .where(and(
      eq(products.ownerId, ownerId),
      ne(products.status, "archived"),
      isNull(products.deletedAt),
    ));
  return (result?.count ?? 0) + requested <= limit;
}

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
    .where(and(eq(products.ownerId, ownerId), isNull(products.deletedAt)))
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

  const access = await getProductAccess(req, res);
  if (!access) return;

  // Serialize quota admission with insertion so concurrent requests cannot
  // push Starter above its catalogue allowance.
  const product = await db.transaction(async (tx) => {
    if (!await hasProductCapacity(tx, ownerId, access.limits.products, status === "archived" ? 0 : 1)) return null;
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
  if (!product) {
    sendPlanLimitReached(res, {
      resource: "products",
      currentPlan: access.planId,
      requiredPlan: "growth",
      limit: access.limits.products!,
    });
    return;
  }

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

  const updateValues = {
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
  };

  const access = status && status !== "archived" ? await getProductAccess(req, res) : null;
  if (status && status !== "archived" && !access) return;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ status: products.status, deletedAt: products.deletedAt })
      .from(products)
      .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
      .limit(1);
    if (!existing) return { updated: null, limited: false };
    if (
      !existing.deletedAt
      && existing.status === "archived"
      && status !== undefined
      && status !== "archived"
      && access
      && !await hasProductCapacity(tx, ownerId, access.limits.products, 1)
    ) {
      return { updated: null, limited: true };
    }
    const [updated] = await tx
      .update(products)
      .set(updateValues)
      .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId)))
      .returning();
    return { updated, limited: false };
  });
  if (result.limited && access) {
    sendPlanLimitReached(res, {
      resource: "products",
      currentPlan: access.planId,
      requiredPlan: "growth",
      limit: access.limits.products!,
    });
    return;
  }
  const updated = result.updated;
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

// DELETE /api/products/:id — soft delete, immediately hidden from public views.
router.delete("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const now = new Date();
  const recoverableUntil = new Date(now.getTime() + PRODUCT_DELETE_RECOVERY_WINDOW_MS);
  const [updated] = await db.update(products)
    .set({ deletedAt: now, recoverableUntil, removalKind: "seller_deleted", updatedAt: now })
    .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .returning();
  if (!updated) {
    const [existing] = await db.select({
      deletedAt: products.deletedAt, recoverableUntil: products.recoverableUntil, removalKind: products.removalKind,
    }).from(products).where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (existing.removalKind === "seller_deleted") {
      res.json({ success: true, recoverableUntil: existing.recoverableUntil }); return;
    }
    res.status(410).json({ error: "Product has been permanently removed", code: "PRODUCT_REMOVED" }); return;
  }

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Deleted product "${updated.name}"`,
      "product", updated.id,
    );
  }

  res.json({ success: true, recoverableUntil: updated.recoverableUntil });
});

// POST /api/products/:id/restore — owner-only, idempotent within recovery window.
router.post("/:id/restore", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const now = new Date();
  const access = await getProductAccess(req, res);
  if (!access) return;
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(products)
      .where(and(eq(products.id, req.params.id), eq(products.ownerId, ownerId))).limit(1);
    if (!existing) return { kind: "missing" as const };
    if (!existing.deletedAt) return { kind: "unchanged" as const, product: existing };
    if (!canRestoreProduct(existing, now)) return { kind: "expired" as const };
    if (
      existing.status !== "archived"
      && !await hasProductCapacity(tx, ownerId, access.limits.products, 1)
    ) {
      return { kind: "limited" as const };
    }
    const [product] = await tx.update(products)
      .set({ deletedAt: null, recoverableUntil: null, removalKind: null, updatedAt: now })
      .where(and(
        eq(products.id, existing.id),
        eq(products.ownerId, ownerId),
        eq(products.removalKind, "seller_deleted"),
        gt(products.recoverableUntil, now),
      ))
      .returning();
    return product
      ? { kind: "restored" as const, product }
      : { kind: "unchanged" as const };
  });
  if (result.kind === "missing") { res.status(404).json({ error: "Not found" }); return; }
  if (result.kind === "unchanged") {
    res.json({ success: true, restored: false, ...(result.product ? { product: result.product } : {}) });
    return;
  }
  if (result.kind === "expired") {
    res.status(410).json({ error: "Product recovery window has expired", code: "PRODUCT_RECOVERY_EXPIRED" }); return;
  }
  if (result.kind === "limited") {
    sendPlanLimitReached(res, {
      resource: "products",
      currentPlan: access.planId,
      requiredPlan: "growth",
      limit: access.limits.products!,
    });
    return;
  }
  const product = result.product;
  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Restored product "${product.name}"`, "product", product.id);
  res.json({ success: true, restored: true, product });
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
  const validRows: Array<{
    name: string; priceCents: number; category: string; description: string;
    sku: string | null; images: string[]; tags: string[];
  }> = [];

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

    validRows.push({ name, priceCents, category, description: description ?? '', sku, images, tags });
  }

  const access = await getProductAccess(req, res);
  if (!access) return;
  const inserted = await db.transaction(async (tx) => {
    if (!await hasProductCapacity(tx, ownerId, access.limits.products, validRows.length)) return null;
    const created: Array<{ name: string; productId: string }> = [];
    for (const row of validRows) {
      const [product] = await tx.insert(products).values({
        id: crypto.randomUUID(),
        ownerId,
        name: row.name,
        description: row.description,
        category: row.category,
        status: 'draft',
        images: row.images,
        tags: row.tags,
      }).returning({ id: products.id });

      if (row.priceCents > 0) {
        await tx.insert(productVariants).values({
          id: crypto.randomUUID(),
          productId: product.id,
          sku: row.sku ?? (row.name.replace(/\s+/g, '-').toUpperCase() + '-DEFAULT'),
          priceCents: row.priceCents,
          stock: 0,
          lowStockThreshold: 5,
        });
      }
      created.push({ name: row.name, productId: product.id });
    }
    return created;
  });
  if (!inserted) {
    sendPlanLimitReached(res, {
      resource: "products",
      currentPlan: access.planId,
      requiredPlan: "growth",
      limit: access.limits.products!,
    });
    return;
  }
  results.push(...inserted.map((row) => ({ success: true, ...row })));

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
