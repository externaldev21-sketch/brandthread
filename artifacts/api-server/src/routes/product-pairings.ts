/**
 * "Complete the fit" — seller-curated products shown under a product page.
 *
 * Public (no auth):
 *   GET /api/product-pairings/public/:productId
 *       → active, non-deleted paired products only, in the seller's order.
 *
 * Seller (auth; writes need the manager role, scoped to the team store owner):
 *   GET /api/product-pairings/:productId   → current pairings (incl. hidden ones, flagged)
 *   PUT /api/product-pairings/:productId   → { pairedProductIds: string[] } full ordered replace
 *
 * Rules: same owner only, no self-pair, each new pairing must be an active
 * non-deleted product, at most MAX_PRODUCT_PAIRINGS. A pairing that was valid
 * when added but has since been archived/deleted is kept (and hidden from
 * buyers) until the seller removes it.
 */
import { Router } from "express";
import { db, products, productVariants, productPairings, users } from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { toPublicVariant } from "../lib/publicProfile";
import { isAvailable, isUuid, lowestPriceCents, parsePairingInput } from "../lib/productPairings";

const router = Router();

// ── Public ───────────────────────────────────────────────────────────────────

router.get("/public/:productId", async (req, res) => {
  const { productId } = req.params;
  if (!isUuid(productId)) { res.json([]); return; }
  try {
    setPublicCacheHeaders(res);
    const [current] = await db.select({ id: products.id, ownerId: products.ownerId })
      .from(products)
      .where(and(eq(products.id, productId), eq(products.status, "active"), isNull(products.deletedAt)))
      .limit(1);
    if (!current) { res.json([]); return; }

    const rows = await db
      .select({
        id: products.id,
        ownerId: products.ownerId,
        name: products.name,
        images: products.images,
        isPreOrder: products.isPreOrder,
        position: productPairings.position,
      })
      .from(productPairings)
      .innerJoin(products, eq(products.id, productPairings.pairedProductId))
      .where(and(
        eq(productPairings.productId, current.id),
        eq(products.ownerId, current.ownerId),
        eq(products.status, "active"),
        isNull(products.deletedAt),
      ))
      .orderBy(asc(productPairings.position), asc(productPairings.createdAt));
    if (rows.length === 0) { res.json([]); return; }

    const [variants, [seller]] = await Promise.all([
      db.select().from(productVariants).where(inArray(productVariants.productId, rows.map((r) => r.id))),
      db.select({ displayName: users.displayName }).from(users).where(eq(users.clerkId, current.ownerId)).limit(1),
    ]);
    const byProduct = new Map<string, typeof variants>();
    for (const v of variants) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v]);

    res.json(rows.map((row) => {
      const vs = byProduct.get(row.id) ?? [];
      return {
        id: row.id,
        sellerId: row.ownerId,
        sellerName: seller?.displayName ?? null,
        name: row.name,
        image: row.images?.[0] ?? null,
        images: row.images ?? [],
        priceCents: lowestPriceCents(vs),
        isPreOrder: row.isPreOrder,
        available: isAvailable(vs, row.isPreOrder),
        variants: vs.map(toPublicVariant),
      };
    }));
  } catch (err) {
    req.log.error({ err, productId }, "Failed to fetch product pairings");
    res.status(500).json({ error: "Failed to fetch pairings" });
  }
});

// ── Seller ───────────────────────────────────────────────────────────────────

router.use(requireAuth);
router.use(teamContext());

async function ownProduct(ownerId: string, productId: string) {
  if (!isUuid(productId)) return null;
  const [product] = await db.select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  return product ?? null;
}

async function listPairings(productId: string) {
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      images: products.images,
      status: products.status,
      deletedAt: products.deletedAt,
      position: productPairings.position,
    })
    .from(productPairings)
    .innerJoin(products, eq(products.id, productPairings.pairedProductId))
    .where(eq(productPairings.productId, productId))
    .orderBy(asc(productPairings.position), asc(productPairings.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    image: r.images?.[0] ?? null,
    active: r.status === "active" && !r.deletedAt,
    position: r.position,
  }));
}

router.get("/:productId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownProduct(ownerId, req.params.productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ pairings: await listPairings(product.id) });
});

router.put("/:productId", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownProduct(ownerId, req.params.productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const parsed = parsePairingInput(product.id, (req.body as any)?.pairedProductIds);
  if (!parsed.ok) { res.status(parsed.status).json({ error: parsed.error, code: parsed.code }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx.select({ pairedProductId: productPairings.pairedProductId })
        .from(productPairings).where(eq(productPairings.productId, product.id));
      const kept = new Set(existing.map((e) => e.pairedProductId));

      if (parsed.ids.length > 0) {
        const found = await tx.select({
          id: products.id, ownerId: products.ownerId, status: products.status, deletedAt: products.deletedAt,
        }).from(products).where(inArray(products.id, parsed.ids));
        const byId = new Map(found.map((p) => [p.id, p]));
        for (const id of parsed.ids) {
          const p = byId.get(id);
          // Same-owner only; another seller's product is reported as not found.
          if (!p || p.ownerId !== ownerId) return { error: "Product not found", code: "pairing_not_found" };
          if (!kept.has(id) && (p.status !== "active" || p.deletedAt)) {
            return { error: "Only active products can be paired", code: "pairing_inactive" };
          }
        }
      }

      await tx.delete(productPairings).where(eq(productPairings.productId, product.id));
      if (parsed.ids.length > 0) {
        await tx.insert(productPairings).values(
          parsed.ids.map((pairedProductId, position) => ({ productId: product.id, pairedProductId, position })),
        );
      }
      return null;
    });
    if (result) { res.status(result.code === "pairing_not_found" ? 404 : 400).json(result); return; }
    res.json({ pairings: await listPairings(product.id) });
  } catch (err) {
    req.log.error({ err, productId: product.id }, "Failed to save product pairings");
    res.status(500).json({ error: "Could not save pairings" });
  }
});

export default router;
