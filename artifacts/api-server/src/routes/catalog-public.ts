/**
 * Public, no-auth buyer view of a product's stock counter.
 *   GET /api/catalog-public/products/:id/stock-info
 * Exposes only what a buyer may see: sold-out flag, the edition size of a
 * limited product and the remaining count when the seller chose to show it.
 * Products that are not publicly visible (draft, hidden while sold out,
 * archived, deleted) return 404.
 */
import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, products, productVariants, productStockRules } from "@workspace/db";
import { setPublicCacheHeaders } from "../lib/httpCache";
import { buildStockInfo } from "../lib/variantMatrix";

const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/products/:id/stock-info", async (req, res) => {
  const id = req.params.id;
  if (!UUID.test(id)) { res.status(404).json({ error: "Product not found" }); return; }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, id), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [totals] = await db
    .select({ total: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`, count: sql<number>`count(*)::int` })
    .from(productVariants).where(eq(productVariants.productId, id));
  const [rule] = await db.select().from(productStockRules).where(eq(productStockRules.productId, id)).limit(1);

  setPublicCacheHeaders(res, { maxAgeSeconds: 10, staleWhileRevalidateSeconds: 30 });
  res.json(buildStockInfo({ totalStock: totals?.total ?? 0, variantCount: totals?.count ?? 0, rules: rule ?? null }));
});

export default router;
