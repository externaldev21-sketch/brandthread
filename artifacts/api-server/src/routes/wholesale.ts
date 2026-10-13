/**
 * Wholesale price list (item 59). Mounted at /api/wholesale, next to /api/sales.
 * Rules: lib/pricing/wholesale.ts. Checkout hook: lib/pricing/wholesaleRuntime.ts.
 *
 * Public
 *   GET  /store/:sellerId               is the store's wholesale price list on (and its order minimum)
 * Buyer (signed in)
 *   GET  /store/:sellerId/me            my application status; approved buyers also get the price list
 *   POST /store/:sellerId/apply         apply (or re-apply after a decline) with a business name
 * Seller ("products" permission for prices, "customers" for buyer decisions)
 *   GET    /seller                      settings, fixed prices, products, buyer applications
 *   PUT    /seller/settings             { enabled?, minOrderCents?, defaultPercentOff? }
 *   PUT    /seller/prices               upsert { productId, variantId?, priceCents|null, minQuantity }
 *   DELETE /seller/prices/:id
 *   PATCH  /seller/buyers/:id           { status: "approved" | "declined" }
 */
import { Router } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, productVariants, products, users, wholesaleBuyers, wholesalePrices, wholesaleSettings } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { MAX_DEFAULT_PERCENT_OFF, wholesaleTermsFor, type WholesaleSettings } from "../lib/pricing/wholesale";
import { loadWholesaleRules, loadWholesaleSettings } from "../lib/pricing/wholesaleRuntime";

const router = Router();

const MAX_PRICE_CENTS = 10_000_000;
const MAX_MIN_QUANTITY = 10_000;
const MAX_PRODUCTS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_SETTINGS: WholesaleSettings = { enabled: false, minOrderCents: 0, defaultPercentOff: 0 };

type CatalogProduct = {
  id: string; name: string; image: string | null;
  variants: Array<{ id: string; label: string; priceCents: number }>;
};

/** The seller's active products with their variants (bounded). */
async function catalogFor(sellerId: string): Promise<CatalogProduct[]> {
  const prods = await db.select({ id: products.id, name: products.name, images: products.images }).from(products)
    .where(and(eq(products.ownerId, sellerId), eq(products.status, "active"), isNull(products.deletedAt)))
    .orderBy(asc(products.name)).limit(MAX_PRODUCTS);
  if (prods.length === 0) return [];
  const variants = await db.select({
    id: productVariants.id, productId: productVariants.productId, size: productVariants.size,
    color: productVariants.color, priceCents: productVariants.priceCents,
  }).from(productVariants).where(inArray(productVariants.productId, prods.map((p) => p.id)));
  return prods.map((p) => ({
    id: p.id, name: p.name,
    image: Array.isArray(p.images) && typeof p.images[0] === "string" ? p.images[0] : null,
    variants: variants.filter((v) => v.productId === p.id).map((v) => ({
      id: v.id, label: [v.size, v.color].filter(Boolean).join(" / "), priceCents: v.priceCents,
    })),
  }));
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

// ─── Public ──────────────────────────────────────────────────────────────────

router.get("/store/:sellerId", async (req, res) => {
  const settings = await loadWholesaleSettings(String(req.params.sellerId));
  res.json({ enabled: Boolean(settings?.enabled), minOrderCents: settings?.enabled ? settings.minOrderCents : 0 });
});

// ─── Buyer ───────────────────────────────────────────────────────────────────

router.get("/store/:sellerId/me", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const sellerId = String(req.params.sellerId);
  const settings = await loadWholesaleSettings(sellerId);
  const [application] = await db.select().from(wholesaleBuyers)
    .where(and(eq(wholesaleBuyers.sellerId, sellerId), eq(wholesaleBuyers.buyerId, buyerId))).limit(1);
  const enabled = Boolean(settings?.enabled);
  const status = application?.status ?? "none";
  let priceList: Array<CatalogProduct & { variants: Array<CatalogProduct["variants"][number] & { wholesaleCents: number | null; minQuantity: number }> }> = [];
  if (enabled && status === "approved" && settings) {
    const catalog = await catalogFor(sellerId);
    const rules = await loadWholesaleRules(sellerId, catalog.map((p) => p.id));
    priceList = catalog.map((p) => ({
      ...p,
      variants: p.variants.map((v) => {
        const terms = wholesaleTermsFor(settings, rules, { productId: p.id, variantId: v.id, retailUnitCents: v.priceCents });
        return { ...v, wholesaleCents: terms.unitCents != null && terms.unitCents < v.priceCents ? terms.unitCents : null, minQuantity: terms.minQuantity };
      }),
    })).filter((p) => p.variants.some((v) => v.wholesaleCents != null));
  }
  res.json({
    enabled,
    status,
    businessName: application?.businessName ?? null,
    minOrderCents: enabled ? settings!.minOrderCents : 0,
    priceList,
  });
});

router.post("/store/:sellerId/apply", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  const sellerId = String(req.params.sellerId);
  const businessName = typeof req.body?.businessName === "string" ? req.body.businessName.trim() : "";
  if (businessName.length < 2 || businessName.length > 120) {
    res.status(400).json({ error: "Enter your business name.", code: "BUSINESS_NAME_REQUIRED" });
    return;
  }
  if (sellerId === buyerId) {
    res.status(400).json({ error: "You can't apply to your own store.", code: "OWN_STORE" });
    return;
  }
  const settings = await loadWholesaleSettings(sellerId);
  if (!settings?.enabled) {
    res.status(404).json({ error: "This store doesn't offer wholesale pricing.", code: "WHOLESALE_OFF" });
    return;
  }
  const [existing] = await db.select().from(wholesaleBuyers)
    .where(and(eq(wholesaleBuyers.sellerId, sellerId), eq(wholesaleBuyers.buyerId, buyerId))).limit(1);
  if (existing?.status === "approved" || existing?.status === "pending") {
    res.json({ status: existing.status, businessName: existing.businessName });
    return;
  }
  const now = new Date();
  const [row] = await db.insert(wholesaleBuyers)
    .values({ sellerId, buyerId, businessName, status: "pending" })
    .onConflictDoUpdate({
      target: [wholesaleBuyers.sellerId, wholesaleBuyers.buyerId],
      set: { businessName, status: "pending", updatedAt: now, decidedAt: null },
    })
    .returning();
  res.status(201).json({ status: row.status, businessName: row.businessName });
});

// ─── Seller ──────────────────────────────────────────────────────────────────

router.get("/seller", requireAuth, requirePermission("products"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const [settings, prices, catalog, buyers] = await Promise.all([
    loadWholesaleSettings(sellerId),
    db.select().from(wholesalePrices).where(eq(wholesalePrices.sellerId, sellerId)),
    catalogFor(sellerId),
    db.select({
      id: wholesaleBuyers.id, buyerId: wholesaleBuyers.buyerId, status: wholesaleBuyers.status,
      businessName: wholesaleBuyers.businessName, createdAt: wholesaleBuyers.createdAt,
      name: users.displayName, fallbackName: users.name, username: users.username, avatarUrl: users.avatarUrl,
    }).from(wholesaleBuyers)
      .leftJoin(users, eq(users.clerkId, wholesaleBuyers.buyerId))
      .where(eq(wholesaleBuyers.sellerId, sellerId))
      .orderBy(desc(wholesaleBuyers.createdAt)),
  ]);
  res.json({
    settings: settings ?? DEFAULT_SETTINGS,
    prices: prices.map((p) => ({ id: p.id, productId: p.productId, variantId: p.variantId, priceCents: p.priceCents, minQuantity: p.minQuantity })),
    products: catalog,
    buyers: buyers.map((b) => ({
      id: b.id, buyerId: b.buyerId, status: b.status, businessName: b.businessName, createdAt: b.createdAt,
      name: b.name || b.fallbackName || null, username: b.username ?? null, avatarUrl: b.avatarUrl ?? null,
    })),
  });
});

router.put("/seller/settings", requireAuth, requirePermission("products"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const b = (req.body ?? {}) as Partial<WholesaleSettings>;
  if (b.enabled !== undefined && typeof b.enabled !== "boolean") { res.status(400).json({ error: "enabled must be true or false" }); return; }
  if (b.minOrderCents !== undefined && !isInt(b.minOrderCents, 0, MAX_PRICE_CENTS)) { res.status(400).json({ error: "Enter a minimum order of $0 or more." }); return; }
  if (b.defaultPercentOff !== undefined && !isInt(b.defaultPercentOff, 0, MAX_DEFAULT_PERCENT_OFF)) {
    res.status(400).json({ error: `Enter a discount from 0% to ${MAX_DEFAULT_PERCENT_OFF}%.` }); return;
  }
  const patch = Object.fromEntries(
    Object.entries({ enabled: b.enabled, minOrderCents: b.minOrderCents, defaultPercentOff: b.defaultPercentOff }).filter(([, v]) => v !== undefined),
  ) as Partial<WholesaleSettings>;
  const [row] = await db.insert(wholesaleSettings)
    .values({ sellerId, ...DEFAULT_SETTINGS, ...patch })
    .onConflictDoUpdate({ target: wholesaleSettings.sellerId, set: { ...patch, updatedAt: new Date() } })
    .returning();
  res.json({ enabled: row.enabled, minOrderCents: row.minOrderCents, defaultPercentOff: row.defaultPercentOff });
});

router.put("/seller/prices", requireAuth, requirePermission("products"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const b = req.body ?? {};
  const productId = typeof b.productId === "string" ? b.productId : "";
  const variantId = typeof b.variantId === "string" && b.variantId ? b.variantId : null;
  const priceCents = b.priceCents ?? null;
  const minQuantity = b.minQuantity ?? 1;
  if (!UUID.test(productId) || (variantId && !UUID.test(variantId))) { res.status(400).json({ error: "productId is required" }); return; }
  if (priceCents !== null && !isInt(priceCents, 0, MAX_PRICE_CENTS)) { res.status(400).json({ error: "Enter a wholesale price of $0 or more." }); return; }
  if (!isInt(minQuantity, 1, MAX_MIN_QUANTITY)) { res.status(400).json({ error: "Minimum quantity must be at least 1." }); return; }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, sellerId), isNull(products.deletedAt))).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (variantId) {
    const [variant] = await db.select({ id: productVariants.id }).from(productVariants)
      .where(and(eq(productVariants.id, variantId), eq(productVariants.productId, productId))).limit(1);
    if (!variant) { res.status(404).json({ error: "Variant not found" }); return; }
  }
  const row = await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: wholesalePrices.id }).from(wholesalePrices).where(and(
      eq(wholesalePrices.productId, productId),
      variantId ? eq(wholesalePrices.variantId, variantId) : isNull(wholesalePrices.variantId),
    )).limit(1);
    if (existing) {
      const [updated] = await tx.update(wholesalePrices).set({ priceCents, minQuantity, updatedAt: new Date() })
        .where(eq(wholesalePrices.id, existing.id)).returning();
      return updated;
    }
    const [created] = await tx.insert(wholesalePrices).values({ sellerId, productId, variantId, priceCents, minQuantity }).returning();
    return created;
  });
  res.json({ id: row.id, productId: row.productId, variantId: row.variantId, priceCents: row.priceCents, minQuantity: row.minQuantity });
});

router.delete("/seller/prices/:id", requireAuth, requirePermission("products"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  if (!UUID.test(id)) { res.status(404).json({ error: "Price not found" }); return; }
  const deleted = await db.delete(wholesalePrices)
    .where(and(eq(wholesalePrices.id, id), eq(wholesalePrices.sellerId, sellerId))).returning({ id: wholesalePrices.id });
  if (deleted.length === 0) { res.status(404).json({ error: "Price not found" }); return; }
  res.json({ ok: true });
});

router.patch("/seller/buyers/:id", requireAuth, requirePermission("customers"), async (req, res) => {
  const sellerId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  const status = req.body?.status;
  if (status !== "approved" && status !== "declined") { res.status(400).json({ error: "status must be approved or declined" }); return; }
  if (!UUID.test(id)) { res.status(404).json({ error: "Request not found" }); return; }
  const now = new Date();
  const [row] = await db.update(wholesaleBuyers).set({ status, decidedAt: now, updatedAt: now })
    .where(and(eq(wholesaleBuyers.id, id), eq(wholesaleBuyers.sellerId, sellerId))).returning();
  if (!row) { res.status(404).json({ error: "Request not found" }); return; }
  res.json({ id: row.id, status: row.status });
});

export default router;
