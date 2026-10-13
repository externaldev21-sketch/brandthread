/**
 * Mystery boxes (lib/mysteryBox.ts, migration 264).
 *
 * Public (no auth):
 *   GET /api/mystery-boxes/public/:productId
 *       → { isMysteryBox, itemCount, priceRange, reveal, odds? } — exact odds
 *         only when the seller opted in.
 *
 * Seller (auth; writes need the manager role, scoped to the team store owner):
 *   GET /api/mystery-boxes/:productId          → pool + the seller's variants to pick from
 *   PUT /api/mystery-boxes/:productId          → { enabled, reveal, showOdds, items: [{variantId, weight}] }
 *   GET /api/mystery-boxes/orders/:orderId     → every pick on the seller's order (incl. unfilled)
 *
 * Buyer (mounted separately at /api/buyer/mystery-boxes, no team context):
 *   GET /api/buyer/mystery-boxes/orders/:orderId → revealed items ('at_purchase' boxes only)
 */
import { Router } from "express";
import {
  db, products, productVariants, orders, orderItems,
  mysteryBoxPools, mysteryBoxPoolItems, mysteryBoxPicks,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { isUuid } from "../lib/productPairings";
import { parsePoolInput } from "../lib/mysteryBox";

const router = Router();

// ── Public ───────────────────────────────────────────────────────────────────

router.get("/public/:productId", async (req, res) => {
  const { productId } = req.params;
  const none = { isMysteryBox: false };
  if (!isUuid(productId)) { res.json(none); return; }
  try {
    setPublicCacheHeaders(res);
    const [pool] = await db.select({ reveal: mysteryBoxPools.reveal, showOdds: mysteryBoxPools.showOdds })
      .from(mysteryBoxPools)
      .innerJoin(products, eq(products.id, mysteryBoxPools.productId))
      .where(and(eq(mysteryBoxPools.productId, productId), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);
    if (!pool) { res.json(none); return; }
    // Only items that can still be picked count toward "1 piece from N".
    const items = await db.select({
      name: products.name, size: productVariants.size, color: productVariants.color,
      priceCents: productVariants.priceCents, weight: mysteryBoxPoolItems.weight,
    })
      .from(mysteryBoxPoolItems)
      .innerJoin(productVariants, eq(productVariants.id, mysteryBoxPoolItems.variantId))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(mysteryBoxPoolItems.productId, productId), sql`${productVariants.stock} > 0`));
    const prices = items.map((i) => i.priceCents);
    const totalWeight = items.reduce((s, i) => s + i.weight, 0);
    res.json({
      isMysteryBox: true,
      itemCount: items.length,
      priceRange: prices.length ? { minCents: Math.min(...prices), maxCents: Math.max(...prices) } : null,
      reveal: pool.reveal,
      ...(pool.showOdds ? {
        odds: items.map((i) => ({
          name: i.name,
          variantLabel: [i.size, i.color].filter(Boolean).join(" / ") || null,
          chanceBps: Math.round((i.weight / totalWeight) * 10000),
        })),
      } : {}),
    });
  } catch (err) {
    req.log.error({ err, productId }, "Failed to fetch mystery box");
    res.status(500).json({ error: "Failed to fetch mystery box" });
  }
});

// ── Buyer reveal (exported; mounted without team context) ────────────────────

export const buyerMysteryBoxesRouter = Router();
buyerMysteryBoxesRouter.use(requireAuth);
buyerMysteryBoxesRouter.get("/orders/:orderId", async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const { orderId } = req.params;
  if (!isUuid(orderId)) { res.status(404).json({ error: "Order not found" }); return; }
  const [order] = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.buyerId, buyerId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json({ reveals: await listPicks(orderId, { buyerView: true }) });
});

async function listPicks(orderId: string, opts: { buyerView: boolean }) {
  const rows = await db.select({
    orderItemId: mysteryBoxPicks.orderItemId,
    unitIndex: mysteryBoxPicks.unitIndex,
    variantId: mysteryBoxPicks.variantId,
    boxName: orderItems.productName,
    boxVariantId: orderItems.variantId,
  })
    .from(mysteryBoxPicks)
    .innerJoin(orderItems, eq(orderItems.id, mysteryBoxPicks.orderItemId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.id), asc(mysteryBoxPicks.unitIndex));
  if (rows.length === 0) return [];

  const boxVariantIds = [...new Set(rows.map((r) => r.boxVariantId).filter(Boolean))] as string[];
  const reveals = await db.select({ variantId: productVariants.id, reveal: mysteryBoxPools.reveal })
    .from(productVariants)
    .innerJoin(mysteryBoxPools, eq(mysteryBoxPools.productId, productVariants.productId))
    .where(inArray(productVariants.id, boxVariantIds));
  const revealByBox = new Map(reveals.map((r) => [r.variantId, r.reveal]));

  const pickedIds = [...new Set(rows.map((r) => r.variantId).filter(Boolean))] as string[];
  const picked = pickedIds.length ? await db.select({
    variantId: productVariants.id, size: productVariants.size, color: productVariants.color,
    name: products.name, images: products.images, productId: products.id,
  })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, pickedIds)) : [];
  const byVariant = new Map(picked.map((p) => [p.variantId, p]));

  return rows
    // A buyer sees only revealed-at-purchase items that were actually picked.
    .filter((r) => !opts.buyerView || (r.variantId && revealByBox.get(r.boxVariantId ?? "") === "at_purchase"))
    .map((r) => {
      const p = r.variantId ? byVariant.get(r.variantId) : undefined;
      return {
        orderItemId: r.orderItemId,
        unitIndex: r.unitIndex,
        boxName: r.boxName,
        variantId: r.variantId,
        productId: p?.productId ?? null,
        name: p?.name ?? null,
        size: p?.size ?? null,
        color: p?.color ?? null,
        image: p?.images?.[0] ?? null,
        ...(opts.buyerView ? {} : { needsItem: !r.variantId, reveal: revealByBox.get(r.boxVariantId ?? "") ?? null }),
      };
    });
}

// ── Seller ───────────────────────────────────────────────────────────────────

router.use(requireAuth);
router.use(teamContext());

router.get("/orders/:orderId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { orderId } = req.params;
  if (!isUuid(orderId)) { res.status(404).json({ error: "Order not found" }); return; }
  const [order] = await db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.ownerId, ownerId))).limit(1);
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json({ picks: await listPicks(orderId, { buyerView: false }) });
});

async function ownProduct(ownerId: string, productId: string) {
  if (!isUuid(productId)) return null;
  const [product] = await db.select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  return product ?? null;
}

async function loadPool(productId: string, ownerId: string) {
  const [pool] = await db.select().from(mysteryBoxPools).where(eq(mysteryBoxPools.productId, productId)).limit(1);
  const items = pool ? await db.select({ variantId: mysteryBoxPoolItems.variantId, weight: mysteryBoxPoolItems.weight })
    .from(mysteryBoxPoolItems).where(eq(mysteryBoxPoolItems.productId, productId)) : [];
  // What the seller can pick from: their own non-deleted products, excluding
  // this box and any other mystery box.
  const catalog = await db.select({
    variantId: productVariants.id, productId: products.id, name: products.name, images: products.images,
    size: productVariants.size, color: productVariants.color, priceCents: productVariants.priceCents,
    stock: productVariants.stock, status: products.status,
  })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(
      eq(products.ownerId, ownerId), isNull(products.deletedAt), ne(products.id, productId),
      sql`NOT EXISTS (SELECT 1 FROM mystery_box_pools p WHERE p.product_id = ${products.id})`,
    ))
    .orderBy(asc(products.name), asc(productVariants.size))
    .limit(1000);
  return {
    isMysteryBox: Boolean(pool),
    reveal: pool?.reveal ?? "at_purchase",
    showOdds: pool?.showOdds ?? false,
    items,
    catalog: catalog.map((c) => ({
      variantId: c.variantId, productId: c.productId, name: c.name, image: c.images?.[0] ?? null,
      size: c.size, color: c.color, priceCents: c.priceCents, stock: c.stock, active: c.status === "active",
    })),
  };
}

router.get("/:productId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownProduct(ownerId, req.params.productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json(await loadPool(product.id, ownerId));
});

router.put("/:productId", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownProduct(ownerId, req.params.productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  if ((req.body as any)?.enabled === false) {
    await db.delete(mysteryBoxPools).where(eq(mysteryBoxPools.productId, product.id));
    res.json(await loadPool(product.id, ownerId));
    return;
  }

  const parsed = parsePoolInput(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error, code: parsed.code }); return; }
  const { reveal, showOdds, items } = parsed.value;
  if (items.length === 0) { res.status(400).json({ error: "Pick at least one item.", code: "INVALID_ITEMS" }); return; }

  const ids = items.map((i) => i.variantId);
  const owned = await db.select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(inArray(productVariants.id, ids), eq(products.ownerId, ownerId), isNull(products.deletedAt)));
  const ownedIds = new Set(owned.map((o) => o.id));
  if (ids.some((id) => !ownedIds.has(id)) || owned.some((o) => o.productId === product.id)) {
    res.status(400).json({ error: "Items must be your own products.", code: "NOT_OWNER" });
    return;
  }
  const nested = await db.select({ id: mysteryBoxPools.productId }).from(mysteryBoxPools)
    .where(inArray(mysteryBoxPools.productId, [...new Set(owned.map((o) => o.productId))])).limit(1);
  if (nested.length > 0) {
    res.status(400).json({ error: "A mystery box can't hold another mystery box.", code: "NESTED_BOX" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(mysteryBoxPools).values({ productId: product.id, reveal, showOdds })
      .onConflictDoUpdate({ target: mysteryBoxPools.productId, set: { reveal, showOdds, updatedAt: new Date() } });
    await tx.delete(mysteryBoxPoolItems).where(eq(mysteryBoxPoolItems.productId, product.id));
    await tx.insert(mysteryBoxPoolItems).values(items.map((i) => ({ productId: product.id, variantId: i.variantId, weight: i.weight })));
  });
  res.json(await loadPool(product.id, ownerId));
});

export default router;
