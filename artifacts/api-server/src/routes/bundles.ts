/**
 * Product Bundles — seller CRUD + public buyer view.
 *
 * Seller (auth required):
 *   GET    /api/bundles                    — list seller's bundles
 *   POST   /api/bundles                    — create bundle
 *   GET    /api/bundles/:id                — get bundle + items
 *   PATCH  /api/bundles/:id                — update
 *   DELETE /api/bundles/:id                — archive (set status='archived')
 *   POST   /api/bundles/:id/items          — add product/variant to bundle
 *   DELETE /api/bundles/:id/items/:itemId  — remove item
 *
 * Public (no auth):
 *   GET    /api/bundles/public/:sellerId   — active bundles for a seller storefront
 */
import { Router } from "express";
import { db, productBundles, bundleItems, products, productVariants } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

// ── Public: GET /api/bundles/public/:sellerId ─────────────────────────────────

router.get("/public/:sellerId", async (req, res) => {
  const { sellerId } = req.params;

  const bundles = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.ownerId, sellerId), eq(productBundles.status, "active")))
    .orderBy(desc(productBundles.createdAt));

  if (bundles.length === 0) { res.json([]); return; }

  // Attach items for each bundle
  const bundleIds = bundles.map((b) => b.id);
  const items = await db
    .select({
      id:          bundleItems.id,
      bundleId:    bundleItems.bundleId,
      productId:   bundleItems.productId,
      variantId:   bundleItems.variantId,
      quantity:    bundleItems.quantity,
      productName: products.name,
      images:      products.images,
      priceCents:  productVariants.priceCents,
      size:        productVariants.size,
      color:       productVariants.color,
    })
    .from(bundleItems)
    .leftJoin(products, eq(products.id, bundleItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .where(inArray(bundleItems.bundleId, bundleIds));

  const itemsByBundle: Record<string, typeof items> = {};
  items.forEach((item) => {
    if (!itemsByBundle[item.bundleId]) itemsByBundle[item.bundleId] = [];
    itemsByBundle[item.bundleId].push(item);
  });

  res.json(bundles.map((b) => ({ ...b, items: itemsByBundle[b.id] ?? [] })));
});

// ── All routes below require auth ─────────────────────────────────────────────

router.use(requireAuth);

// ── GET /api/bundles ──────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const bundles = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.ownerId, ownerId), eq(productBundles.status, "active")))
    .orderBy(desc(productBundles.createdAt));

  // Include item count for each
  const bundleIds = bundles.map((b) => b.id);
  const items = bundleIds.length > 0
    ? await db
        .select({ id: bundleItems.id, bundleId: bundleItems.bundleId, quantity: bundleItems.quantity })
        .from(bundleItems)
        .where(inArray(bundleItems.bundleId, bundleIds))
    : [];

  const countMap: Record<string, number> = {};
  items.forEach((i) => { countMap[i.bundleId] = (countMap[i.bundleId] ?? 0) + i.quantity; });

  res.json(bundles.map((b) => ({ ...b, itemCount: countMap[b.id] ?? 0 })));
});

// ── POST /api/bundles ─────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, description, bundlePriceCents, compareAtCents, images } = req.body as {
    name?: string;
    description?: string;
    bundlePriceCents?: number;
    compareAtCents?: number;
    images?: string[];
  };

  if (!name || typeof name !== "string") { res.status(400).json({ error: "name required" }); return; }
  if (!bundlePriceCents || bundlePriceCents <= 0) { res.status(400).json({ error: "bundlePriceCents required (>0)" }); return; }

  const [bundle] = await db.insert(productBundles).values({
    ownerId,
    name,
    description: description ?? null,
    bundlePriceCents,
    compareAtCents: compareAtCents ?? 0,
    images: images ?? [],
  }).returning();

  res.status(201).json(bundle);
});

// ── GET /api/bundles/:id ──────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const [bundle] = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .limit(1);
  if (!bundle) { res.status(404).json({ error: "Not found" }); return; }

  const items = await db
    .select({
      id:          bundleItems.id,
      bundleId:    bundleItems.bundleId,
      productId:   bundleItems.productId,
      variantId:   bundleItems.variantId,
      quantity:    bundleItems.quantity,
      productName: products.name,
      images:      products.images,
      priceCents:  productVariants.priceCents,
      size:        productVariants.size,
      color:       productVariants.color,
    })
    .from(bundleItems)
    .leftJoin(products, eq(products.id, bundleItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .where(eq(bundleItems.bundleId, bundle.id));

  res.json({ ...bundle, items });
});

// ── PATCH /api/bundles/:id ────────────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name, description, bundlePriceCents, compareAtCents, status, images } = req.body as {
    name?: string; description?: string; bundlePriceCents?: number;
    compareAtCents?: number; status?: string; images?: string[];
  };

  if (status && !["draft", "active", "archived"].includes(status)) {
    res.status(400).json({ error: "status must be draft | active | archived" }); return;
  }

  const [updated] = await db
    .update(productBundles)
    .set({
      ...(name              !== undefined && { name }),
      ...(description       !== undefined && { description }),
      ...(bundlePriceCents  !== undefined && { bundlePriceCents }),
      ...(compareAtCents    !== undefined && { compareAtCents }),
      ...(status            !== undefined && { status }),
      ...(images            !== undefined && { images }),
      updatedAt: new Date(),
    })
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── DELETE /api/bundles/:id ───────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const [updated] = await db
    .update(productBundles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ archived: true });
});

// ── POST /api/bundles/:id/items ───────────────────────────────────────────────

router.post("/:id/items", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { productId, variantId, quantity = 1 } = req.body as {
    productId?: string; variantId?: string; quantity?: number;
  };

  if (!productId) { res.status(400).json({ error: "productId required" }); return; }

  // Verify bundle ownership
  const [bundle] = await db
    .select({ id: productBundles.id })
    .from(productBundles)
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  // Verify product belongs to same seller
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId)))
    .limit(1);
  if (!product) { res.status(400).json({ error: "Product not found or not yours" }); return; }

  const [item] = await db.insert(bundleItems).values({
    bundleId:  bundle.id,
    productId,
    variantId: variantId ?? null,
    quantity:  Math.max(1, quantity),
  }).returning();

  res.status(201).json(item);
});

// ── DELETE /api/bundles/:id/items/:itemId ─────────────────────────────────────

router.delete("/:id/items/:itemId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  // Verify bundle ownership
  const [bundle] = await db
    .select({ id: productBundles.id })
    .from(productBundles)
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .limit(1);
  if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

  await db
    .delete(bundleItems)
    .where(and(eq(bundleItems.id, req.params.itemId), eq(bundleItems.bundleId, bundle.id)));

  res.json({ removed: true });
});

export default router;
