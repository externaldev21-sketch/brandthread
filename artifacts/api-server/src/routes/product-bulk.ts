/**
 * Bulk product actions for the seller's "Select products" screen.
 *
 *   GET  /api/product-bulk/products  — selectable catalog (price range, status)
 *   POST /api/product-bulk/price     — set / raise / lower prices (preview or apply)
 *   POST /api/product-bulk/status    — archive / unarchive / draft / active
 *   POST /api/product-bulk/duplicate — copy products + variants as drafts
 *
 * Every write is all-or-nothing: the whole selection is validated and applied
 * inside one transaction, and any refusal (unknown id, plan limit, moderation
 * lock) leaves the catalog untouched. Status and capacity rules mirror
 * routes/products.ts; duplicate is server-side because the Products tab's own
 * duplicate only copies its on-device cache.
 */
import { Router, type Request, type Response } from "express";
import {
  db, products, productVariants, productSeo, productVariantCompareAt,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql, desc, ilike, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { getVerifiedPlanAccess, sendPlanLimitReached, sendPlanLookupUnavailable } from "../lib/planAccess";
import { hasProductCapacity } from "../lib/productCapacity";
import { notifyNewProduct } from "../lib/activityEvents";
import { notifyPriceDrop } from "../lib/stockNotifications";
import {
  isValidPriceChange, planProductPrices, uniqueCopySku,
  type CompareAtMode, type PriceChange, type PriceRounding, type ProductPricePlan,
} from "../lib/bulkPricing";

export const MAX_BULK_PRODUCTS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGET_STATUSES = new Set(["active", "draft", "archived"]);

const router = Router();
router.use(requireAuth);
router.use(teamContext());

/** Thrown inside a transaction to roll everything back and answer with `body`. */
class BulkRefusal extends Error {
  constructor(public status: number, public body: Record<string, unknown>) { super(String(body.error ?? "refused")); }
}

function ownerOf(req: Request): string { return (req as any).clerkUserId as string; }

function parseIds(body: any): { ids: string[] } | { status: number; body: Record<string, unknown> } {
  const raw = body?.productIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { status: 400, body: { error: "productIds must be a non-empty array", code: "VALIDATION_ERROR" } };
  }
  if (!raw.every((id) => typeof id === "string" && UUID_RE.test(id))) {
    return { status: 400, body: { error: "productIds must be product ids", code: "VALIDATION_ERROR" } };
  }
  const ids = [...new Set(raw.map((id: string) => id.toLowerCase()))];
  if (ids.length > MAX_BULK_PRODUCTS) {
    return { status: 400, body: { error: `Select up to ${MAX_BULK_PRODUCTS} products at a time`, code: "TOO_MANY_PRODUCTS", max: MAX_BULK_PRODUCTS } };
  }
  return { ids };
}

function parseChange(raw: any): PriceChange | null {
  if (!raw || typeof raw !== "object") return null;
  const { mode, direction, value } = raw;
  let change: PriceChange;
  if (mode === "set") change = { mode, value };
  else if ((mode === "amount" || mode === "percent") && (direction === "increase" || direction === "decrease")) {
    change = { mode, direction, value };
  } else return null;
  return isValidPriceChange(change) ? change : null;
}

function sendRefusal(res: Response, err: unknown): boolean {
  if (err instanceof BulkRefusal) { res.status(err.status).json(err.body); return true; }
  return false;
}

async function loadOwned(tx: any, ownerId: string, ids: string[], lock: boolean) {
  const query = tx
    .select({
      id: products.id, name: products.name, status: products.status, images: products.images,
      removalKind: products.removalKind,
    })
    .from(products)
    .where(and(inArray(products.id, ids), eq(products.ownerId, ownerId), isNull(products.deletedAt)));
  const rows: Array<{ id: string; name: string; status: string; images: string[]; removalKind: string | null }> =
    lock ? await query.for("update") : await query;
  const found = new Set(rows.map((r) => r.id));
  const missingIds = ids.filter((id) => !found.has(id));
  if (missingIds.length > 0) {
    throw new BulkRefusal(404, { error: "Some products were not found", code: "PRODUCT_NOT_FOUND", missingIds });
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)!);
}

const isModerationLocked = (removalKind: string | null) => !!removalKind?.startsWith("moderation_");

// ─── GET /products ───────────────────────────────────────────────────────────
router.get("/products", async (req, res) => {
  const ownerId = ownerOf(req);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const status = typeof req.query.status === "string" ? req.query.status : "all";
  if (status !== "all" && !TARGET_STATUSES.has(status)) {
    res.status(400).json({ error: "Invalid status filter", code: "VALIDATION_ERROR" }); return;
  }
  const limit = Math.min(MAX_BULK_PRODUCTS, Math.max(1, Number.parseInt(String(req.query.limit ?? MAX_BULK_PRODUCTS), 10) || MAX_BULK_PRODUCTS));
  const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? 0), 10) || 0);
  const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);

  const where = and(
    eq(products.ownerId, ownerId),
    isNull(products.deletedAt),
    status === "all" ? undefined : eq(products.status, status),
    q ? or(ilike(products.name, `%${escaped}%`), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku ilike ${`%${escaped}%`})`) : undefined,
  );

  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      status: products.status,
      images: products.images,
      removalKind: products.removalKind,
      variantCount: sql<number>`count(${productVariants.id})::int`,
      minPriceCents: sql<number | null>`min(${productVariants.priceCents})`,
      maxPriceCents: sql<number | null>`max(${productVariants.priceCents})`,
      totalStock: sql<number>`coalesce(sum(${productVariants.stock}),0)::int`,
    })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .where(where)
    .groupBy(products.id)
    .orderBy(desc(products.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);

  res.json({
    total,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      image: Array.isArray(r.images) && r.images.length > 0 ? r.images[0] : null,
      variantCount: r.variantCount,
      minPriceCents: r.minPriceCents,
      maxPriceCents: r.maxPriceCents,
      totalStock: r.totalStock,
      moderationLocked: isModerationLocked(r.removalKind),
    })),
  });
});

// ─── POST /price ─────────────────────────────────────────────────────────────
router.post("/price", requireRole("manager"), async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = parseIds(req.body);
  if ("status" in parsed) { res.status(parsed.status).json(parsed.body); return; }
  const change = parseChange(req.body?.change);
  if (!change) { res.status(400).json({ error: "Invalid price change", code: "VALIDATION_ERROR" }); return; }
  const rounding: PriceRounding = req.body?.rounding ?? "none";
  if (!["none", "end_99", "end_00"].includes(rounding)) {
    res.status(400).json({ error: "Invalid rounding", code: "VALIDATION_ERROR" }); return;
  }
  const compareAt: CompareAtMode = req.body?.compareAt ?? "none";
  if (!["none", "previous", "clear"].includes(compareAt)) {
    res.status(400).json({ error: "Invalid compareAt", code: "VALIDATION_ERROR" }); return;
  }
  const preview = req.body?.preview === true;

  try {
    const outcome = await db.transaction(async (tx) => {
      const owned = await loadOwned(tx, ownerId, parsed.ids, !preview);
      const variantRows = await tx
        .select({
          productId: productVariants.productId,
          variantId: productVariants.id,
          sku: productVariants.sku,
          priceCents: productVariants.priceCents,
          compareAtCents: productVariantCompareAt.compareAtCents,
        })
        .from(productVariants)
        .leftJoin(productVariantCompareAt, eq(productVariantCompareAt.variantId, productVariants.id))
        .where(inArray(productVariants.productId, parsed.ids))
        .orderBy(productVariants.createdAt);

      const items = owned.map((p) => {
        const rows = variantRows
          .filter((v) => v.productId === p.id)
          .map((v) => ({ variantId: v.variantId, sku: v.sku, priceCents: v.priceCents, compareAtCents: v.compareAtCents ?? null }));
        const plan: ProductPricePlan | null = planProductPrices(rows, change, rounding, compareAt);
        return { product: p, plan };
      });

      if (!preview) {
        const now = new Date();
        for (const { plan } of items) {
          if (!plan) continue;
          for (const v of plan.variants) {
            if (v.before !== v.after) {
              await tx.update(productVariants)
                .set({ priceCents: v.after, updatedAt: now })
                .where(eq(productVariants.id, v.variantId));
            }
            if (v.compareAtAfter !== v.compareAtBefore) {
              if (v.compareAtAfter === null) {
                await tx.delete(productVariantCompareAt).where(eq(productVariantCompareAt.variantId, v.variantId));
              } else {
                await tx.insert(productVariantCompareAt)
                  .values({ variantId: v.variantId, compareAtCents: v.compareAtAfter })
                  .onConflictDoUpdate({
                    target: productVariantCompareAt.variantId,
                    set: { compareAtCents: v.compareAtAfter, updatedAt: now },
                  });
              }
            }
          }
        }
      }
      return items;
    });

    const result = outcome.map(({ product, plan }) => ({
      productId: product.id,
      name: product.name,
      status: product.status,
      image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0] : null,
      skipped: plan ? null : "no_variants",
      changed: plan?.changed ?? false,
      beforeMin: plan?.beforeMin ?? null,
      beforeMax: plan?.beforeMax ?? null,
      afterMin: plan?.afterMin ?? null,
      afterMax: plan?.afterMax ?? null,
      variants: plan?.variants ?? [],
    }));
    const summary = {
      products: result.length,
      changedProducts: result.filter((r) => r.changed).length,
      skippedProducts: result.filter((r) => r.skipped).length,
      variants: result.reduce((n, r) => n + r.variants.filter((v) => v.before !== v.after).length, 0),
    };

    if (!preview) {
      const actor = reqActor(req);
      for (const { product, plan } of outcome) {
        if (!plan?.changed) continue;
        void logActivity(
          actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
          `Bulk price edit on "${product.name}" (${plan.beforeMin} → ${plan.afterMin} cents)`,
          "product", product.id, { bulk: true, change, rounding, compareAt },
        );
        if (product.status === "active" && plan.afterMin < plan.beforeMin) {
          void notifyPriceDrop({
            productId: product.id, ownerId, productName: product.name,
            previousPriceCents: plan.beforeMin, newPriceCents: plan.afterMin,
          });
        }
      }
    }

    res.json({ preview, summary, items: result });
  } catch (err) {
    if (sendRefusal(res, err)) return;
    req.log?.error({ err, ownerId }, "Bulk price edit failed");
    res.status(500).json({ error: "Bulk price edit failed" });
  }
});

// ─── POST /status ────────────────────────────────────────────────────────────
router.post("/status", requireRole("manager"), async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = parseIds(req.body);
  if ("status" in parsed) { res.status(parsed.status).json(parsed.body); return; }
  const target = req.body?.status;
  if (typeof target !== "string" || !TARGET_STATUSES.has(target)) {
    res.status(400).json({ error: "status must be active, draft or archived", code: "VALIDATION_ERROR" }); return;
  }

  let access: Awaited<ReturnType<typeof getVerifiedPlanAccess>> | null = null;
  if (target !== "archived") {
    try { access = await getVerifiedPlanAccess(ownerId); }
    catch (error) { sendPlanLookupUnavailable(req, res, error); return; }
  }

  try {
    const outcome = await db.transaction(async (tx) => {
      const owned = await loadOwned(tx, ownerId, parsed.ids, true);
      if (target !== "archived") {
        const lockedIds = owned.filter((p) => isModerationLocked(p.removalKind)).map((p) => p.id);
        if (lockedIds.length > 0) {
          throw new BulkRefusal(409, {
            error: "Some listings are locked by a platform moderation action",
            code: "PRODUCT_MODERATION_LOCKED", lockedIds,
          });
        }
        const reviving = owned.filter((p) => p.status === "archived").length;
        if (reviving > 0 && access && !await hasProductCapacity(tx, ownerId, access.limits.products, reviving)) {
          throw new BulkRefusal(403, { code: "PLAN_LIMIT_REACHED", limit: access.limits.products, limited: true });
        }
      }
      const changing = owned.filter((p) => p.status !== target);
      if (changing.length > 0) {
        await tx.update(products)
          .set({ status: target, updatedAt: new Date() })
          .where(inArray(products.id, changing.map((p) => p.id)));
      }
      return { owned, changing };
    });

    const actor = reqActor(req);
    for (const p of outcome.changing) {
      void logActivity(
        actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
        `${target === "archived" ? "Archived" : p.status === "archived" ? "Unarchived" : "Set to " + target}: product "${p.name}"`,
        "product", p.id, { bulk: true, from: p.status, to: target },
      );
      if (target === "active") void notifyNewProduct({ productId: p.id });
    }
    res.json({
      status: target,
      updated: outcome.changing.map((p) => p.id),
      unchanged: outcome.owned.filter((p) => p.status === target).map((p) => p.id),
    });
  } catch (err) {
    if (err instanceof BulkRefusal && err.body.limited && access) {
      sendPlanLimitReached(res, {
        resource: "products", currentPlan: access.planId, paid: access.paid, requiredPlan: "growth", limit: access.limits.products!,
      });
      return;
    }
    if (sendRefusal(res, err)) return;
    req.log?.error({ err, ownerId }, "Bulk status change failed");
    res.status(500).json({ error: "Bulk status change failed" });
  }
});

// ─── POST /duplicate ─────────────────────────────────────────────────────────
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

router.post("/duplicate", requireRole("manager"), async (req, res): Promise<void> => {
  const ownerId = ownerOf(req);
  const parsed = parseIds(req.body);
  if ("status" in parsed) { res.status(parsed.status).json(parsed.body); return; }
  const copyInventory = req.body?.copyInventory === true;

  let access: Awaited<ReturnType<typeof getVerifiedPlanAccess>>;
  try { access = await getVerifiedPlanAccess(ownerId); }
  catch (error) { sendPlanLookupUnavailable(req, res, error); return; }

  try {
    const created = await db.transaction(async (tx) => {
      const owned = await loadOwned(tx, ownerId, parsed.ids, true);
      if (!await hasProductCapacity(tx, ownerId, access.limits.products, owned.length)) {
        throw new BulkRefusal(403, { code: "PLAN_LIMIT_REACHED", limited: true });
      }
      const sources = await tx.select().from(products).where(inArray(products.id, parsed.ids));
      const variants = await tx.select().from(productVariants).where(inArray(productVariants.productId, parsed.ids));
      const compareAtRows = variants.length === 0 ? [] : await tx.select().from(productVariantCompareAt)
        .where(inArray(productVariantCompareAt.variantId, variants.map((v) => v.id)));
      const seoRows = await tx.select().from(productSeo).where(inArray(productSeo.productId, parsed.ids));
      const compareAtByVariant = new Map(compareAtRows.map((c) => [c.variantId, c.compareAtCents]));
      const seoByProduct = new Map(seoRows.map((s) => [s.productId, s]));

      // SKUs are globally unique: gather every SKU that could collide with a copy.
      const taken = new Set<string>();
      if (variants.length > 0) {
        const patterns = [...new Set(variants.map((v) => `${likeEscape(v.sku.toLowerCase())}-copy%`))];
        const clashes = await tx
          .select({ sku: productVariants.sku })
          .from(productVariants)
          .where(sql`lower(${productVariants.sku}) like any (array[${sql.join(patterns.map((pt) => sql`${pt}`), sql`, `)}]::text[])`);
        for (const c of clashes) taken.add(c.sku);
      }

      const out: Array<{ sourceId: string; id: string; name: string }> = [];
      for (const id of parsed.ids) {
        const src = sources.find((s) => s.id === id)!;
        const [copy] = await tx.insert(products).values({
          ownerId,
          name: `${src.name} (Copy)`,
          description: src.description,
          category: src.category,
          status: "draft",
          images: src.images,
          tags: src.tags,
          styleTags: src.styleTags,
          isPreOrder: src.isPreOrder,
          preOrderClosingDate: src.preOrderClosingDate,
          preOrderEstShipDate: src.preOrderEstShipDate,
          sizeChart: src.sizeChart,
          sizeChartImageUrl: src.sizeChartImageUrl,
          // dropId intentionally not copied: a copy is not part of the drop.
        }).returning();

        const srcVariants = variants.filter((v) => v.productId === id);
        for (const v of srcVariants) {
          const [nv] = await tx.insert(productVariants).values({
            productId: copy.id,
            size: v.size,
            color: v.color,
            sku: uniqueCopySku(v.sku, taken),
            priceCents: v.priceCents,
            stock: copyInventory ? v.stock : 0,
            lowStockThreshold: v.lowStockThreshold,
            weightGrams: v.weightGrams,
          }).returning({ id: productVariants.id });
          const cmp = compareAtByVariant.get(v.id);
          if (cmp !== undefined) await tx.insert(productVariantCompareAt).values({ variantId: nv.id, compareAtCents: cmp });
        }

        const seo = seoByProduct.get(id);
        if (seo) {
          // The URL handle is unique per seller, so the copy starts without one.
          await tx.insert(productSeo).values({
            productId: copy.id, ownerId,
            seoTitle: seo.seoTitle, seoDescription: seo.seoDescription,
            noIndex: seo.noIndex, socialImageUrl: seo.socialImageUrl, urlHandle: null,
          });
        }
        out.push({ sourceId: id, id: copy.id, name: copy.name });
      }
      return out;
    });

    const actor = reqActor(req);
    for (const c of created) {
      void logActivity(
        actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
        `Duplicated product as "${c.name}"`, "product", c.id, { bulk: true, sourceId: c.sourceId },
      );
    }
    res.status(201).json({ created });
  } catch (err) {
    if (err instanceof BulkRefusal && err.body.limited) {
      sendPlanLimitReached(res, {
        resource: "products", currentPlan: access.planId, paid: access.paid, requiredPlan: "growth", limit: access.limits.products!,
      });
      return;
    }
    if (sendRefusal(res, err)) return;
    req.log?.error({ err, ownerId }, "Bulk duplicate failed");
    res.status(500).json({ error: "Bulk duplicate failed" });
  }
});

export default router;
