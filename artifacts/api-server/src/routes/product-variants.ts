/**
 * Variant option axes, matrix generation, bulk variant edits and stock rules.
 *
 *   GET  /api/product-variants/:productId                    axes + variants (with options) + stock rules
 *   PUT  /api/product-variants/:productId/axes               replace the ordered option axes
 *   POST /api/product-variants/:productId/generate           create the missing size × colour × fit (× custom) variants
 *   PATCH /api/product-variants/:productId/variants/bulk     transactional price / stock / SKU / low-stock edit
 *   GET/PUT /api/product-variants/:productId/stock-rules     sold-out behaviour, low-stock default, limited quantity + counter
 *
 * Size and colour stay on the existing variant columns; fit + custom axes are
 * stored in `product_variant_options`. All routes are owner-scoped (team aware).
 */
import { Router } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, products, productVariants, productOptionAxes, productVariantOptions, productStockRules,
} from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { bodyObject, idParams, validateInput } from "../lib/commerceValidation";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { isUniqueViolation } from "../lib/dbErrors";
import { afterStockChange } from "../lib/stockRules";
import { notifyBackInStock, notifyPriceDrop, notifyStockLevelChanged } from "../lib/stockNotifications";
import {
  MAX_MATRIX_VARIANTS, MAX_PRICE_CENTS, MAX_STOCK, baseSkuFromName, buildSku, columnAxisFor, comboKey,
  generateCombos, matrixSize, normalizeAxes, uniqueSku, validateBulkUpdates, validateStockRules,
} from "../lib/variantMatrix";

// ── Request schemas ──────────────────────────────────────────────────────────
// Shape/size guards only; lib/variantMatrix keeps the business validation and
// its seller-facing messages. Unknown keys pass through untouched.
const productParams = idParams("productId");
const anyNumber = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const axesBody = bodyObject({
  axes: z.array(z.object({
    name: z.union([z.string().max(200), z.number()]).nullish(),
    values: z.array(z.union([z.string().max(200), z.number()]).nullable()).max(500).optional(),
  }).passthrough()).max(50),
});
const generateBody = bodyObject({
  priceCents: anyNumber.optional(),
  stock: anyNumber.optional(),
  lowStockThreshold: anyNumber.optional(),
  baseSku: z.string().max(200).optional(),
});
const bulkBody = bodyObject({
  updates: z.array(z.object({
    variantId: z.string().max(160).optional(),
    priceCents: anyNumber.optional(),
    stock: anyNumber.optional(),
    lowStockThreshold: anyNumber.optional(),
    sku: z.string().max(200).nullish(),
  }).passthrough()).max(2_000),
});
const nullableInt = z.union([anyNumber, z.literal("")]).nullish();
const stockRulesBody = bodyObject({
  soldOutBehavior: z.string().max(40).nullish(),
  lowStockThresholdDefault: nullableInt,
  limitedQuantityEnabled: z.boolean().nullish(),
  limitedQuantityTotal: nullableInt,
  showRemainingCounter: z.boolean().nullish(),
  counterThreshold: nullableInt,
  applyLowStockToVariants: z.boolean().nullish(),
});

const router = Router();
router.use(requireAuth);
router.use(teamContext());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ownedProduct(productId: string, ownerId: string) {
  if (!UUID.test(productId)) return null;
  const [product] = await db
    .select({ id: products.id, name: products.name, status: products.status, isPreOrder: products.isPreOrder, dropId: products.dropId })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId)))
    .limit(1);
  return product ?? null;
}

async function loadState(productId: string) {
  const axes = await db.select().from(productOptionAxes)
    .where(eq(productOptionAxes.productId, productId)).orderBy(asc(productOptionAxes.position));
  const variantRows = await db
    .select({
      id: productVariants.id, sku: productVariants.sku, size: productVariants.size, color: productVariants.color,
      priceCents: productVariants.priceCents, stock: productVariants.stock, lowStockThreshold: productVariants.lowStockThreshold,
      options: productVariantOptions.options,
    })
    .from(productVariants)
    .leftJoin(productVariantOptions, eq(productVariantOptions.variantId, productVariants.id))
    .where(eq(productVariants.productId, productId))
    .orderBy(asc(productVariants.createdAt), asc(productVariants.sku));
  const [rules] = await db.select().from(productStockRules).where(eq(productStockRules.productId, productId)).limit(1);
  return {
    axes: axes.map((a) => ({ name: a.name, values: a.values })),
    variants: variantRows.map((v) => ({ ...v, options: v.options ?? {} })),
    stockRules: rulesPayload(rules),
  };
}

function rulesPayload(rule?: typeof productStockRules.$inferSelect) {
  return {
    lowStockThresholdDefault: rule?.lowStockThresholdDefault ?? null,
    soldOutBehavior: (rule?.soldOutBehavior ?? "show") as "show" | "hide" | "archive",
    limitedQuantityEnabled: rule?.limitedQuantityEnabled ?? false,
    limitedQuantityTotal: rule?.limitedQuantityTotal ?? null,
    showRemainingCounter: rule?.showRemainingCounter ?? false,
    counterThreshold: rule?.counterThreshold ?? null,
  };
}

router.get("/:productId", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({ product, ...(await loadState(product.id)), maxVariants: MAX_MATRIX_VARIANTS });
});

router.put("/:productId/axes", requireRole("manager"), validateInput({ params: productParams, body: axesBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const parsed = normalizeAxes(req.body?.axes);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const size = matrixSize(parsed.axes);
  if (size > MAX_MATRIX_VARIANTS) {
    res.status(422).json({ error: `These options make ${size} variants. The limit is ${MAX_MATRIX_VARIANTS}.`, matrixSize: size, max: MAX_MATRIX_VARIANTS });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(productOptionAxes).where(eq(productOptionAxes.productId, product.id));
    if (parsed.axes.length > 0) {
      await tx.insert(productOptionAxes).values(parsed.axes.map((axis, position) => ({
        productId: product.id, name: axis.name, position, values: axis.values,
      })));
    }
  });
  res.json({ axes: parsed.axes, matrixSize: size, max: MAX_MATRIX_VARIANTS });
});

router.post("/:productId/generate", requireRole("manager"), validateInput({ params: productParams, body: generateBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const stockInput = body.stock ?? 0;
  if (!Number.isInteger(stockInput) || (stockInput as number) < 0 || (stockInput as number) > MAX_STOCK) {
    res.status(400).json({ error: "stock must be a whole number of 0 or more" }); return;
  }
  const defaultStock = stockInput as number;

  const axisRows = await db.select().from(productOptionAxes)
    .where(eq(productOptionAxes.productId, product.id)).orderBy(asc(productOptionAxes.position));
  const axes = axisRows.map((a) => ({ name: a.name, values: a.values })).filter((a) => a.values.length > 0);
  if (axes.length === 0) { res.status(400).json({ error: "Add at least one option with values first" }); return; }
  const size = matrixSize(axes);
  if (size > MAX_MATRIX_VARIANTS) {
    res.status(422).json({ error: `These options make ${size} variants. The limit is ${MAX_MATRIX_VARIANTS}.`, matrixSize: size, max: MAX_MATRIX_VARIANTS });
    return;
  }

  const [rule] = await db.select().from(productStockRules).where(eq(productStockRules.productId, product.id)).limit(1);
  const lowStockThreshold = body.lowStockThreshold !== undefined ? body.lowStockThreshold : (rule?.lowStockThresholdDefault ?? 10);
  if (!Number.isInteger(lowStockThreshold) || (lowStockThreshold as number) < 0 || (lowStockThreshold as number) > MAX_STOCK) {
    res.status(400).json({ error: "lowStockThreshold must be a whole number of 0 or more" }); return;
  }

  const existing = await loadState(product.id);
  let priceCents = body.priceCents;
  if (priceCents === undefined) priceCents = existing.variants.length ? Math.min(...existing.variants.map((v) => v.priceCents)) : undefined;
  if (!Number.isInteger(priceCents) || (priceCents as number) <= 0 || (priceCents as number) > MAX_PRICE_CENTS) {
    res.status(400).json({ error: "A positive price is required to generate variants" }); return;
  }

  const baseInput = typeof body.baseSku === "string" ? body.baseSku.trim() : "";
  if (baseInput && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,30}$/.test(baseInput)) {
    res.status(400).json({ error: "Base SKU can use letters, numbers, . _ - /" }); return;
  }
  const baseSku = baseInput || baseSkuFromName(product.name);

  const have = new Set(existing.variants.map((v) => comboKey(axes, (name) => {
    const col = columnAxisFor(name);
    if (col === "size") return v.size;
    if (col === "color") return v.color;
    return (v.options as Record<string, string>)[name];
  })));
  const missing = generateCombos(axes).filter((combo) => !have.has(comboKey(axes, (name) => combo.values[axes.findIndex((a) => a.name === name)])));

  let created: Array<{ id: string; sku: string }> = [];
  if (missing.length > 0) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        created = await db.transaction(async (tx) => {
          const candidates = missing.map((combo) => buildSku(baseSku, combo));
          const taken = new Set<string>();
          // Everything that could collide on the global unique sku: the exact candidates plus suffixed forms.
          const clashing = await tx.select({ sku: productVariants.sku }).from(productVariants)
            .where(sql`${productVariants.sku} ~* ${"^(" + candidates.map((c) => c.replace(/[^A-Za-z0-9]/g, (ch) => "\\" + ch)).join("|") + ")(-[0-9]+)?$"}`);
          for (const row of clashing) taken.add(row.sku.toLowerCase());
          const rows = missing.map((combo, i) => ({
            productId: product.id, size: combo.size, color: combo.color,
            sku: uniqueSku(candidates[i], taken), priceCents: priceCents as number,
            stock: defaultStock, lowStockThreshold: lowStockThreshold as number,
          }));
          const inserted = await tx.insert(productVariants).values(rows).returning({ id: productVariants.id, sku: productVariants.sku });
          const withOptions = inserted
            .map((row, i) => ({ variantId: row.id, options: missing[i].options }))
            .filter((row) => Object.keys(row.options).length > 0);
          if (withOptions.length > 0) await tx.insert(productVariantOptions).values(withOptions);
          return inserted;
        });
        break;
      } catch (err) {
        if (!isUniqueViolation(err) || attempt === 3) throw err;
      }
    }
    const actor = reqActor(req);
    void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Generated ${created.length} variant${created.length === 1 ? "" : "s"} for ${product.name}`,
      "product", product.id, { created: created.length });
    if (defaultStock > 0) void afterStockChange(product.id);
  }

  res.status(created.length > 0 ? 201 : 200).json({ created: created.length, skipped: size - missing.length, ...(await loadState(product.id)) });
});

router.patch("/:productId/variants/bulk", requireRole("manager"), validateInput({ params: productParams, body: bulkBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const parsed = validateBulkUpdates(req.body?.updates);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error, variantId: parsed.variantId }); return; }

  type Outcome = { variantId: string; previousStock: number; newStock: number; threshold: number; previousPrice: number; newPrice: number };
  let outcomes: Outcome[];
  try {
    outcomes = await db.transaction(async (tx) => {
      const ids = parsed.updates.map((u) => u.variantId);
      const rows = await tx.select().from(productVariants)
        .where(and(eq(productVariants.productId, product.id), inArray(productVariants.id, ids)))
        .for("update");
      if (rows.length !== ids.length) throw new HttpFail(404, "One of the variants was not found on this product");
      const byId = new Map(rows.map((r) => [r.id, r]));

      const skus = parsed.updates.filter((u) => u.sku !== undefined).map((u) => u.sku as string);
      if (skus.length > 0) {
        const owners = await tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants)
          .where(inArray(productVariants.sku, skus));
        const ownerBySku = new Map(owners.map((o) => [o.sku, o.id]));
        for (const u of parsed.updates) {
          const holder = u.sku !== undefined ? ownerBySku.get(u.sku) : undefined;
          if (holder && holder !== u.variantId) throw new HttpFail(409, `SKU ${u.sku} is already in use`, u.variantId);
        }
      }

      const result: Outcome[] = [];
      for (const u of parsed.updates) {
        const before = byId.get(u.variantId)!;
        const [after] = await tx.update(productVariants).set({
          ...(u.priceCents !== undefined && { priceCents: u.priceCents }),
          ...(u.stock !== undefined && { stock: u.stock }),
          ...(u.sku !== undefined && { sku: u.sku }),
          ...(u.lowStockThreshold !== undefined && { lowStockThreshold: u.lowStockThreshold }),
          updatedAt: new Date(),
        }).where(eq(productVariants.id, u.variantId)).returning();
        result.push({
          variantId: u.variantId, previousStock: before.stock, newStock: after.stock, threshold: after.lowStockThreshold,
          previousPrice: before.priceCents, newPrice: after.priceCents,
        });
      }
      return result;
    });
  } catch (err) {
    if (err instanceof HttpFail) { res.status(err.status).json({ error: err.message, variantId: err.variantId }); return; }
    if (isUniqueViolation(err)) { res.status(409).json({ error: "A SKU is already in use" }); return; }
    throw err;
  }

  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Updated ${outcomes.length} variant${outcomes.length === 1 ? "" : "s"} of ${product.name}`,
    "product", product.id, { variants: outcomes.length });
  for (const o of outcomes) {
    void notifyStockLevelChanged({ productId: product.id, ownerId, productName: product.name, previousStock: o.previousStock, newStock: o.newStock, lowStockThreshold: o.threshold });
    void notifyBackInStock({ productId: product.id, ownerId, productName: product.name, previousStock: o.previousStock, newStock: o.newStock });
    void notifyPriceDrop({ productId: product.id, ownerId, productName: product.name, previousPriceCents: o.previousPrice, newPriceCents: o.newPrice });
  }
  await afterStockChange(product.id);

  res.json({ updated: outcomes.length, ...(await loadState(product.id)), product: (await ownedProduct(product.id, ownerId)) });
});

router.get("/:productId/stock-rules", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const [rule] = await db.select().from(productStockRules).where(eq(productStockRules.productId, product.id)).limit(1);
  res.json(rulesPayload(rule));
});

router.put("/:productId/stock-rules", requireRole("manager"), validateInput({ params: productParams, body: stockRulesBody }), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const product = await ownedProduct(req.params.productId, ownerId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const parsed = validateStockRules(req.body);
  if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
  const r = parsed.rules;
  const values = {
    lowStockThresholdDefault: r.lowStockThresholdDefault, soldOutBehavior: r.soldOutBehavior,
    limitedQuantityEnabled: r.limitedQuantityEnabled, limitedQuantityTotal: r.limitedQuantityTotal,
    showRemainingCounter: r.showRemainingCounter, counterThreshold: r.counterThreshold,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    await tx.insert(productStockRules).values({ productId: product.id, ...values })
      .onConflictDoUpdate({ target: productStockRules.productId, set: values });
    if (req.body?.applyLowStockToVariants === true && r.lowStockThresholdDefault !== null) {
      await tx.update(productVariants).set({ lowStockThreshold: r.lowStockThresholdDefault, updatedAt: new Date() })
        .where(eq(productVariants.productId, product.id));
    }
  });
  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Updated stock rules for ${product.name}`, "product", product.id, { soldOutBehavior: r.soldOutBehavior });
  // Switching to hide/archive on an already sold-out product applies right away.
  await afterStockChange(product.id);
  res.json(rulesPayload((await db.select().from(productStockRules).where(eq(productStockRules.productId, product.id)).limit(1))[0]));
});

class HttpFail extends Error {
  constructor(public status: number, message: string, public variantId?: string) { super(message); }
}

export default router;
