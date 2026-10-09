/**
 * Seller automatic sales (mounted at /api/sales, same team-context + "marketing"
 * permission model as /api/discount-codes). Pricing rules: lib/pricing/sales.ts.
 */
import { Router } from "express";
import { db, sales, productSales, products } from "@workspace/db";
import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { finishListPage, parseListPage } from "../lib/pagination";
import { requireAuth } from "../middlewares/requireAuth";
import { requirePermission } from "../middlewares/requireRole";
import { clearSalesCache } from "../lib/pricing/salesRuntime";

const router = Router();
router.use(requireAuth);

const TYPES = ["percent", "fixed"] as const;
const SCOPES = ["store", "products", "collection"] as const;

function statusOf(row: typeof sales.$inferSelect, now = new Date()): "paused" | "scheduled" | "ended" | "live" {
  if (!row.active) return "paused";
  if (row.startsAt.getTime() > now.getTime()) return "scheduled";
  if (row.endsAt && row.endsAt.getTime() <= now.getTime()) return "ended";
  return "live";
}

async function withProducts(rows: Array<typeof sales.$inferSelect>) {
  const ids = rows.map((r) => r.id);
  const links = ids.length ? await db.select().from(productSales).where(inArray(productSales.saleId, ids)) : [];
  return rows.map((r) => ({
    ...r,
    status: statusOf(r),
    productIds: links.filter((l) => l.saleId === r.id).map((l) => l.productId),
  }));
}

type Body = {
  name?: string; discountType?: string; value?: number; scope?: string;
  productIds?: string[]; collection?: string | null;
  startsAt?: string | null; endsAt?: string | null; active?: boolean;
};

/** Validates fields present in `b`; returns an error message or null. */
function validate(b: Body, full: boolean): string | null {
  if ((full || b.name !== undefined) && !(typeof b.name === "string" && b.name.trim().length > 0 && b.name.length <= 80)) return "name is required (max 80 characters)";
  if ((full || b.discountType !== undefined) && !TYPES.includes(b.discountType as any)) return `discountType must be one of: ${TYPES.join(", ")}`;
  if (full || b.value !== undefined) {
    const v = Number(b.value);
    if (!Number.isInteger(v) || v < 1) return "value must be a positive whole number";
    if (b.discountType === "percent" && v > 90) return "percent off must be between 1 and 90";
  }
  if ((full || b.scope !== undefined) && !SCOPES.includes(b.scope as any)) return `scope must be one of: ${SCOPES.join(", ")}`;
  if (b.scope === "collection" && !(typeof b.collection === "string" && b.collection.trim())) return "collection is required for a collection sale";
  if (b.scope === "products" && (!Array.isArray(b.productIds) || b.productIds.length === 0)) return "productIds must be a non-empty array for a products sale";
  const s = b.startsAt ? new Date(b.startsAt) : null;
  const e = b.endsAt ? new Date(b.endsAt) : null;
  if ((s && isNaN(s.getTime())) || (e && isNaN(e.getTime()))) return "startsAt / endsAt must be valid dates";
  if (s && e && e.getTime() <= s.getTime()) return "endsAt must be after startsAt";
  return null;
}

async function ownsAll(sellerId: string, productIds: string[]): Promise<boolean> {
  if (productIds.length === 0) return true;
  const owned = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.ownerId, sellerId), inArray(products.id, productIds), isNull(products.deletedAt)));
  return owned.length === new Set(productIds).size;
}

// GET / — the seller's sales
router.get("/", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    // Opt-in ?limit=&offset=; no params = same bare array, capped generously.
    const page = parseListPage(req.query, { defaultLimit: 200, maxLimit: 200 });
    const fetched = await db.select().from(sales).where(eq(sales.sellerId, sellerId))
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(page.limit + 1)
      .offset(page.offset);
    res.json(await withProducts(finishListPage(res, page, fetched)));
  } catch (err) {
    req.log.error({ err }, "Failed to list sales");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /collections — names a collection sale can target (product categories + tags)
router.get("/collections", async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const rows = await db.select({ category: products.category, tags: products.tags }).from(products)
      .where(and(eq(products.ownerId, sellerId), isNull(products.deletedAt)));
    const names = new Set<string>();
    for (const r of rows) {
      if (r.category) names.add(r.category);
      for (const t of Array.isArray(r.tags) ? r.tags : []) if (typeof t === "string" && t.trim()) names.add(t.trim());
    }
    res.json([...names].sort((a, b) => a.localeCompare(b)));
  } catch (err) {
    req.log.error({ err }, "Failed to list sale collections");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST / — create
router.post("/", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const b = req.body as Body;
    const err = validate(b, true);
    if (err) { res.status(400).json({ error: err }); return; }
    const productIds = b.scope === "products" ? [...new Set(b.productIds as string[])] : [];
    if (!(await ownsAll(sellerId, productIds))) {
      res.status(400).json({ error: "One or more productIds don't belong to this store" }); return;
    }
    const created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(sales).values({
        sellerId, name: b.name!.trim(), discountType: b.discountType!, value: Number(b.value),
        scope: b.scope!, collection: b.scope === "collection" ? b.collection!.trim() : null,
        startsAt: b.startsAt ? new Date(b.startsAt) : new Date(),
        endsAt: b.endsAt ? new Date(b.endsAt) : null,
        active: b.active ?? true,
      }).returning();
      if (productIds.length) await tx.insert(productSales).values(productIds.map((productId) => ({ saleId: row.id, productId })));
      return row;
    });
    clearSalesCache();
    res.status(201).json((await withProducts([created]))[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to create sale");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /:id — edit, pause / resume (`active`)
router.patch("/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const b = req.body as Body;
    const [existing] = await db.select().from(sales)
      .where(and(eq(sales.id, req.params.id), eq(sales.sellerId, sellerId))).limit(1);
    if (!existing) { res.status(404).json({ error: "Sale not found" }); return; }
    const merged: Body = {
      discountType: existing.discountType, scope: existing.scope, collection: existing.collection,
      value: existing.value, startsAt: existing.startsAt.toISOString(), endsAt: existing.endsAt?.toISOString() ?? null,
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)),
    };
    // Existing product links stay valid unless the body replaces them.
    const keepsLinks = existing.scope === "products" && b.productIds === undefined;
    const err = validate({ ...merged, name: merged.name ?? existing.name, ...(keepsLinks && { productIds: ["existing"] }) }, false);
    if (err) { res.status(400).json({ error: err }); return; }
    const productIds = b.productIds ? [...new Set(b.productIds)] : null;
    if (productIds && !(await ownsAll(sellerId, productIds))) {
      res.status(400).json({ error: "One or more productIds don't belong to this store" }); return;
    }
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx.update(sales).set({
        ...(b.name !== undefined && { name: b.name.trim() }),
        ...(b.discountType !== undefined && { discountType: b.discountType }),
        ...(b.value !== undefined && { value: Number(b.value) }),
        ...(b.scope !== undefined && { scope: b.scope }),
        ...((b.collection !== undefined || b.scope !== undefined) && { collection: merged.scope === "collection" ? (merged.collection ?? null) : null }),
        ...(b.startsAt !== undefined && { startsAt: b.startsAt ? new Date(b.startsAt) : existing.startsAt }),
        ...(b.endsAt !== undefined && { endsAt: b.endsAt ? new Date(b.endsAt) : null }),
        ...(b.active !== undefined && { active: !!b.active }),
        updatedAt: new Date(),
      }).where(eq(sales.id, existing.id)).returning();
      if (productIds || merged.scope !== "products") {
        await tx.delete(productSales).where(eq(productSales.saleId, existing.id));
        if (merged.scope === "products" && productIds?.length) {
          await tx.insert(productSales).values(productIds.map((productId) => ({ saleId: existing.id, productId })));
        }
      }
      return row;
    });
    clearSalesCache();
    res.json((await withProducts([updated]))[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update sale");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /:id
router.delete("/:id", requirePermission("marketing"), async (req, res) => {
  try {
    const sellerId = (req as any).clerkUserId as string;
    const deleted = await db.delete(sales)
      .where(and(eq(sales.id, req.params.id), eq(sales.sellerId, sellerId))).returning({ id: sales.id });
    if (deleted.length === 0) { res.status(404).json({ error: "Sale not found" }); return; }
    clearSalesCache();
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete sale");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
