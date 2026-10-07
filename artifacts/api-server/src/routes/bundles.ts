/**
 * Product Bundles — seller CRUD + public buyer views.
 *
 * Seller (auth required; team managers/marketing act on the owner's store):
 *   GET    /api/bundles                    — list seller's (non-archived) bundles, with sales
 *   GET    /api/bundles/sales              — bundle sales (paid, not cancelled, net of refunds)
 *   POST   /api/bundles                    — create bundle
 *   GET    /api/bundles/:id                — get bundle + items (+ sales)
 *   PATCH  /api/bundles/:id                — update
 *   DELETE /api/bundles/:id                — archive (set status='archived')
 *   POST   /api/bundles/:id/items          — add product/variant to bundle
 *   DELETE /api/bundles/:id/items/:itemId  — remove item
 *
 * Public (no auth; only active, buyable bundles with server-computed prices —
 * lib/bundlesPublic.ts):
 *   GET    /api/bundles/public/by-product/:productId — bundles that include this product
 *   GET    /api/bundles/public/bundle/:id            — one bundle (bundle detail screen)
 *   GET    /api/bundles/public/:sellerId             — a seller's storefront bundles
 *
 * Checkout prices bundles itself (lib/money/bundlePricing.ts); nothing here
 * is trusted at payment time.
 */
import { Router } from "express";
import { db, productBundles, bundleItems, products, productVariants } from "@workspace/db";
import { eq, and, desc, inArray, ne } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission, teamContext } from "../middlewares/requireRole";
import {
  bundleSalesForSeller, isUuid, publicBundle, publicBundlesForProduct, publicBundlesForSeller,
} from "../lib/bundlesPublic";

const router = Router();

// ── Public ────────────────────────────────────────────────────────────────────

router.get("/public/by-product/:productId", async (req, res) => {
  res.json(await publicBundlesForProduct(String(req.params.productId)));
});

router.get("/public/bundle/:id", async (req, res) => {
  const bundle = await publicBundle(String(req.params.id));
  if (!bundle) { res.status(404).json({ error: "Bundle not available" }); return; }
  res.json(bundle);
});

router.get("/public/:sellerId", async (req, res) => {
  res.json(await publicBundlesForSeller(String(req.params.sellerId)));
});

// ── All routes below require auth ─────────────────────────────────────────────
// teamContext AFTER requireAuth: requireAuth resets req.clerkUserId to the
// caller, teamContext points it back at the store they act on.

router.use(requireAuth);
router.use(teamContext());
const canEdit = requirePermission("marketing");

function parseCents(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100_000_000 ? n : null;
}

function trimmed(value: unknown, max: number): string | null {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

const itemSelection = {
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
};

/** A bundle item's display price when the buyer picks the size: the product's cheapest variant. */
async function withOpenVariantPrices<T extends { productId: string; variantId: string | null; priceCents: number | null }>(rows: T[]): Promise<T[]> {
  const open = [...new Set(rows.filter((r) => !r.variantId).map((r) => r.productId))];
  if (open.length === 0) return rows;
  const variants = await db.select({ productId: productVariants.productId, priceCents: productVariants.priceCents })
    .from(productVariants).where(inArray(productVariants.productId, open));
  const min = new Map<string, number>();
  for (const v of variants) min.set(v.productId, Math.min(min.get(v.productId) ?? Infinity, v.priceCents));
  return rows.map((r) => (r.variantId ? r : { ...r, priceCents: min.get(r.productId) ?? 0 }));
}

// ── GET /api/bundles ──────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  // Drafts too: a new bundle starts as a draft and must stay findable.
  const bundles = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.ownerId, ownerId), ne(productBundles.status, "archived")))
    .orderBy(desc(productBundles.createdAt));

  const bundleIds = bundles.map((b) => b.id);
  const items = bundleIds.length > 0
    ? await db
        .select({ id: bundleItems.id, bundleId: bundleItems.bundleId, quantity: bundleItems.quantity })
        .from(bundleItems)
        .where(inArray(bundleItems.bundleId, bundleIds))
    : [];

  const countMap: Record<string, number> = {};
  items.forEach((i) => { countMap[i.bundleId] = (countMap[i.bundleId] ?? 0) + i.quantity; });
  const sales = new Map((await bundleSalesForSeller(ownerId)).map((s) => [s.bundleId, s]));

  res.json(bundles.map((b) => {
    const s = sales.get(b.id);
    return {
      ...b,
      itemCount: countMap[b.id] ?? 0,
      sales: {
        setsSold: s?.setsSold ?? 0,
        orderCount: s?.orderCount ?? 0,
        revenueCents: s?.revenueCents ?? 0,
        discountCents: s?.discountCents ?? 0,
      },
    };
  }));
});

// ── GET /api/bundles/sales ────────────────────────────────────────────────────

router.get("/sales", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const days = Number(req.query.days);
  const since = Number.isInteger(days) && days > 0 && days <= 3650 ? new Date(Date.now() - days * 86_400_000) : null;
  res.json(await bundleSalesForSeller(ownerId, since));
});

// ── POST /api/bundles ─────────────────────────────────────────────────────────

router.post("/", canEdit, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const name = trimmed(req.body?.name, 120);
  const bundlePriceCents = parseCents(req.body?.bundlePriceCents);
  const compareAtCents = req.body?.compareAtCents == null ? 0 : parseCents(req.body.compareAtCents);
  const images = Array.isArray(req.body?.images) ? (req.body.images as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 10) : [];

  if (!name) { res.status(400).json({ error: "name required" }); return; }
  if (!bundlePriceCents || bundlePriceCents <= 0) { res.status(400).json({ error: "bundlePriceCents required (>0)" }); return; }
  if (compareAtCents === null) { res.status(400).json({ error: "compareAtCents must be whole cents" }); return; }

  const [bundle] = await db.insert(productBundles).values({
    ownerId,
    name,
    description: trimmed(req.body?.description, 1000) || null,
    bundlePriceCents,
    compareAtCents,
    images,
  }).returning();

  res.status(201).json(bundle);
});

// ── GET /api/bundles/:id ──────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }

  const [bundle] = await db
    .select()
    .from(productBundles)
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .limit(1);
  if (!bundle) { res.status(404).json({ error: "Not found" }); return; }

  const items = await withOpenVariantPrices(await db
    .select(itemSelection)
    .from(bundleItems)
    .leftJoin(products, eq(products.id, bundleItems.productId))
    .leftJoin(productVariants, eq(productVariants.id, bundleItems.variantId))
    .where(eq(bundleItems.bundleId, bundle.id)));
  const sales = (await bundleSalesForSeller(ownerId)).find((s) => s.bundleId === bundle.id) ?? null;

  res.json({ ...bundle, items, sales });
});

// ── PATCH /api/bundles/:id ────────────────────────────────────────────────────

router.patch("/:id", canEdit, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const body = req.body ?? {};
  const { status } = body as { status?: string };

  if (status !== undefined && !["draft", "active", "archived"].includes(status)) {
    res.status(400).json({ error: "status must be draft | active | archived" }); return;
  }
  const bundlePriceCents = body.bundlePriceCents === undefined ? undefined : parseCents(body.bundlePriceCents);
  if (bundlePriceCents === null || bundlePriceCents === 0) { res.status(400).json({ error: "bundlePriceCents must be > 0 whole cents" }); return; }
  const compareAtCents = body.compareAtCents === undefined ? undefined : parseCents(body.compareAtCents);
  if (compareAtCents === null) { res.status(400).json({ error: "compareAtCents must be whole cents" }); return; }
  const name = body.name === undefined ? undefined : trimmed(body.name, 120);
  if (name === null || name === "") { res.status(400).json({ error: "name required" }); return; }

  const [updated] = await db
    .update(productBundles)
    .set({
      ...(name              !== undefined && { name }),
      ...(body.description  !== undefined && { description: trimmed(body.description, 1000) || null }),
      ...(bundlePriceCents  !== undefined && { bundlePriceCents }),
      ...(compareAtCents    !== undefined && { compareAtCents }),
      ...(status            !== undefined && { status }),
      ...(Array.isArray(body.images) && { images: (body.images as unknown[]).filter((u): u is string => typeof u === "string").slice(0, 10) }),
      updatedAt: new Date(),
    })
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

// ── DELETE /api/bundles/:id ───────────────────────────────────────────────────

router.delete("/:id", canEdit, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }

  const [updated] = await db
    .update(productBundles)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(productBundles.id, req.params.id), eq(productBundles.ownerId, ownerId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ archived: true });
});

// ── POST /api/bundles/:id/items ───────────────────────────────────────────────

router.post("/:id/items", canEdit, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { productId, variantId } = (req.body ?? {}) as { productId?: unknown; variantId?: unknown };
  const quantity = req.body?.quantity == null ? 1 : Number(req.body.quantity);

  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Bundle not found" }); return; }
  if (!isUuid(productId)) { res.status(400).json({ error: "productId required" }); return; }
  if (variantId != null && !isUuid(variantId)) { res.status(400).json({ error: "variantId must be a variant id" }); return; }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) { res.status(400).json({ error: "quantity must be 1–20" }); return; }

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

  // A fixed variant must be one of THIS product's variants.
  if (variantId) {
    const [variant] = await db.select({ id: productVariants.id }).from(productVariants)
      .where(and(eq(productVariants.id, variantId as string), eq(productVariants.productId, productId))).limit(1);
    if (!variant) { res.status(400).json({ error: "That variant isn't part of this product" }); return; }
  }

  const [item] = await db.insert(bundleItems).values({
    bundleId:  bundle.id,
    productId,
    variantId: (variantId as string | null | undefined) ?? null,
    quantity,
  }).returning();

  res.status(201).json(item);
});

// ── DELETE /api/bundles/:id/items/:itemId ─────────────────────────────────────

router.delete("/:id/items/:itemId", canEdit, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id) || !isUuid(req.params.itemId)) { res.status(404).json({ error: "Bundle not found" }); return; }

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
