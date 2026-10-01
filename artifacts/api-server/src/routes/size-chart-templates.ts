/**
 * Reusable size chart templates.
 *
 *   GET    /api/size-chart-templates               — own templates + starter presets
 *   POST   /api/size-chart-templates               — create ({ name, chart } or { name, fromProductId })
 *   GET    /api/size-chart-templates/:id
 *   PUT    /api/size-chart-templates/:id           — rename / edit chart
 *   DELETE /api/size-chart-templates/:id           — products keep their copied chart
 *   POST   /api/size-chart-templates/:id/apply     — { productIds } copy the chart onto products
 *   POST   /api/size-chart-templates/:id/sync      — re-copy the chart onto every linked product
 *
 * Applying copies the chart into products.size_chart, which is what buyers
 * already read, so the storefront needs no change.
 */
import { Router } from "express";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, products, sizeChartTemplates, productSizeChartLinks } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { SIZE_CHART_PRESETS, convertSizeChartUnit, normalizeSizeChart } from "../lib/sizeChart";

const router = Router();
router.use(requireAuth);
router.use(teamContext());

const MAX_APPLY = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Returns the trimmed name, or null when it is missing / not 1-60 characters. */
function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= 60 ? t : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string; cause?: { code?: string } })?.code === "23505"
    || (err as { cause?: { code?: string } })?.cause?.code === "23505";
}

async function ownedTemplate(ownerId: string, id: string) {
  const [row] = await db.select().from(sizeChartTemplates)
    .where(and(eq(sizeChartTemplates.id, id), eq(sizeChartTemplates.ownerId, ownerId))).limit(1);
  return row ?? null;
}

router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      id: sizeChartTemplates.id,
      name: sizeChartTemplates.name,
      chart: sizeChartTemplates.chart,
      updatedAt: sizeChartTemplates.updatedAt,
      productCount: sql<number>`count(${productSizeChartLinks.productId})::int`,
    })
    .from(sizeChartTemplates)
    .leftJoin(productSizeChartLinks, eq(productSizeChartLinks.templateId, sizeChartTemplates.id))
    .where(eq(sizeChartTemplates.ownerId, ownerId))
    .groupBy(sizeChartTemplates.id)
    .orderBy(asc(sizeChartTemplates.name));
  res.json({ templates: rows, presets: SIZE_CHART_PRESETS });
});

router.post("/", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { name: rawName, chart: rawChart, fromProductId } = (req.body ?? {}) as Record<string, unknown>;
  const name = parseName(rawName);
  if (!name) { res.status(400).json({ error: "A template name (1-60 characters) is required" }); return; }
  if (fromProductId !== undefined && !isUuid(fromProductId)) { res.status(400).json({ error: "Invalid product" }); return; }

  let source: unknown = rawChart;
  if (fromProductId) {
    const [p] = await db.select({ sizeChart: products.sizeChart }).from(products)
      .where(and(eq(products.id, fromProductId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
      .limit(1);
    if (!p) { res.status(404).json({ error: "Product not found" }); return; }
    source = p.sizeChart;
  }
  const normalized = normalizeSizeChart(source);
  if (!normalized.ok) { res.status(400).json({ error: normalized.error }); return; }

  try {
    const [row] = await db.insert(sizeChartTemplates)
      .values({ ownerId, name, chart: normalized.chart }).returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) { res.status(409).json({ error: "You already have a template with that name" }); return; }
    throw err;
  }
});

router.get("/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const row = await ownedTemplate(ownerId, req.params.id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const linked = await db.select({ id: products.id, name: products.name, images: products.images })
    .from(productSizeChartLinks)
    .innerJoin(products, eq(products.id, productSizeChartLinks.productId))
    .where(and(eq(productSizeChartLinks.templateId, row.id), isNull(products.deletedAt)));
  res.json({ ...row, products: linked });
});

router.put("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const { name: rawName, chart: rawChart, convertTo } = (req.body ?? {}) as Record<string, unknown>;
  const name = rawName === undefined ? undefined : parseName(rawName);
  if (name === null) { res.status(400).json({ error: "A template name (1-60 characters) is required" }); return; }
  if (convertTo !== undefined && convertTo !== "inches" && convertTo !== "cm") {
    res.status(400).json({ error: "convertTo must be inches or cm" }); return;
  }
  const existing = await ownedTemplate(ownerId, req.params.id);
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  let chart = existing.chart;
  if (rawChart !== undefined) {
    const n = normalizeSizeChart(rawChart);
    if (!n.ok) { res.status(400).json({ error: n.error }); return; }
    chart = n.chart;
  }
  if (convertTo) chart = convertSizeChartUnit(chart, convertTo);

  try {
    const [row] = await db.update(sizeChartTemplates)
      .set({ name: name ?? existing.name, chart, updatedAt: new Date() })
      .where(eq(sizeChartTemplates.id, existing.id)).returning();
    res.json(row);
  } catch (err) {
    if (isUniqueViolation(err)) { res.status(409).json({ error: "You already have a template with that name" }); return; }
    throw err;
  }
});

router.delete("/:id", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const deleted = await db.delete(sizeChartTemplates)
    .where(and(eq(sizeChartTemplates.id, req.params.id), eq(sizeChartTemplates.ownerId, ownerId)))
    .returning({ id: sizeChartTemplates.id });
  if (deleted.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

async function copyToProducts(templateId: string, chart: unknown, productIds: string[]) {
  await db.transaction(async (tx) => {
    await tx.update(products).set({ sizeChart: chart as Record<string, unknown>, updatedAt: new Date() })
      .where(inArray(products.id, productIds));
    await tx.insert(productSizeChartLinks)
      .values(productIds.map((productId) => ({ productId, templateId })))
      .onConflictDoUpdate({
        target: productSizeChartLinks.productId,
        set: { templateId, appliedAt: new Date() },
      });
  });
}

router.post("/:id/apply", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const ids = (req.body as { productIds?: unknown } | undefined)?.productIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_APPLY || !ids.every(isUuid)) {
    res.status(400).json({ error: `Choose between 1 and ${MAX_APPLY} products` }); return;
  }
  const template = await ownedTemplate(ownerId, req.params.id);
  if (!template) { res.status(404).json({ error: "Not found" }); return; }

  const productIds = [...new Set(ids as string[])];
  const owned = await db.select({ id: products.id }).from(products)
    .where(and(inArray(products.id, productIds), eq(products.ownerId, ownerId), isNull(products.deletedAt)));
  if (owned.length !== productIds.length) { res.status(404).json({ error: "One or more products were not found" }); return; }

  await copyToProducts(template.id, template.chart, productIds);
  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Applied size chart "${template.name}" to ${productIds.length} product${productIds.length === 1 ? "" : "s"}`,
    "product", undefined, { templateId: template.id });
  res.json({ applied: productIds.length });
});

router.post("/:id/sync", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.id)) { res.status(404).json({ error: "Not found" }); return; }
  const template = await ownedTemplate(ownerId, req.params.id);
  if (!template) { res.status(404).json({ error: "Not found" }); return; }
  const linked = await db.select({ id: products.id }).from(productSizeChartLinks)
    .innerJoin(products, eq(products.id, productSizeChartLinks.productId))
    .where(and(eq(productSizeChartLinks.templateId, template.id), eq(products.ownerId, ownerId), isNull(products.deletedAt)));
  if (linked.length > 0) await copyToProducts(template.id, template.chart, linked.map((p) => p.id));
  res.json({ synced: linked.length });
});

export default router;
