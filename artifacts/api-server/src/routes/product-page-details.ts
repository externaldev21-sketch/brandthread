/**
 * Product page details (polish 87, 88, 91, 93, 94).
 *
 *   GET /api/product-page-details/public/:productId/in-bags — "X people have this in their bag" (public)
 *   GET /api/product-page-details/:productId                — seller: model line, fabric/care/origin, colour photos
 *   PUT /api/product-page-details/:productId                — seller: save (manager+)
 *
 * The details themselves reach buyers on GET /api/public/products/:id, which
 * returns every product column.
 */
import { Router } from "express";
import { db, cartItems, productVariants, products } from "@workspace/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { rateLimit } from "../middlewares/rateLimit";
import { logActivity, reqActor } from "../lib/activityLog";
import { optionalViewerId } from "../lib/safety";
import {
  parseProductPageDetails, productPageDetailsOf, publicInBagCount,
} from "../lib/productPageDetails";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Public ──────────────────────────────────────────────────────────────────

router.get("/public/:productId/in-bags", rateLimit("public-read"), async (req, res): Promise<void> => {
  const productId = String(req.params.productId);
  if (!UUID_RE.test(productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId), eq(products.status, "active"), isNull(products.deletedAt))).limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  // Other shoppers only (the viewer's own bag is not "people"), bag lines
  // only (saved-for-later is not "in their bag"), counted once per person.
  const viewerId = optionalViewerId(req);
  const [row] = await db
    .select({ shoppers: sql<number>`count(distinct ${cartItems.userId})::int` })
    .from(cartItems)
    .innerJoin(productVariants, sql`${cartItems.variantId} = ${productVariants.id}::text`)
    .where(and(
      eq(productVariants.productId, productId),
      eq(cartItems.savedForLater, false),
      ...(viewerId ? [ne(cartItems.userId, viewerId)] : []),
    ));
  // Short shared cache when signed out; the count changes slowly.
  res.set("Cache-Control", viewerId ? "private, max-age=60" : "public, max-age=60");
  res.json({ count: publicInBagCount(Number(row?.shoppers ?? 0)) });
});

// ─── Seller ──────────────────────────────────────────────────────────────────
router.use(requireAuth);
router.use(teamContext());

async function ownedProduct(ownerId: string, productId: string) {
  if (!UUID_RE.test(productId)) return null;
  const [p] = await db.select().from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  return p ?? null;
}

async function describe(product: NonNullable<Awaited<ReturnType<typeof ownedProduct>>>) {
  const variants = await db.select({ color: productVariants.color }).from(productVariants)
    .where(eq(productVariants.productId, product.id));
  const colors = [...new Set(variants.map((v) => v.color?.trim()).filter((c): c is string => !!c))];
  return {
    productId: product.id,
    productName: product.name,
    images: (product.images ?? []).filter(Boolean),
    colors,
    details: productPageDetailsOf(product),
  };
}

router.get("/:productId", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(ownerId, String(req.params.productId));
  if (!product) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await describe(product));
});

router.put("/:productId", requireRole("manager"), async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(ownerId, String(req.params.productId));
  if (!product) { res.status(404).json({ error: "Not found" }); return; }

  const parsed = parseProductPageDetails(req.body, product.images ?? []);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error, code: "VALIDATION_ERROR" }); return; }

  const [updated] = await db.update(products)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(and(eq(products.id, product.id), eq(products.ownerId, ownerId)))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    "Updated product details", "product", product.id, { fields: Object.keys(parsed.value) });

  res.json(await describe(updated));
});

export default router;
