/**
 * Plan + commit imported products. Shared by the CSV endpoints and the Etsy
 * API import so both write through one path.
 *
 * - Idempotent: product_import_mappings (owner, source, external_key) points at
 *   the product a record created; re-importing updates it (or reports
 *   "unchanged" when the content hash matches) instead of duplicating.
 * - One transaction per product, so a bad product never rolls back the rest.
 * - New products honour the plan's product limit exactly like
 *   lib/productCapacity.ts (the plan cap counts live products only).
 * - Always created as drafts (archived stays archived): publishing is the
 *   seller's decision and goes through the existing publish flow.
 */
import crypto from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, products, productVariants, productImportMappings } from "@workspace/db";
import type { ImportProduct, ImportSource, Issue } from "./types";
import { sha } from "./util";
import { countActiveProducts } from "../productCapacity";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PlanAction = "create" | "update" | "unchanged";
export type PlannedProduct = {
  product: ImportProduct;
  action: PlanAction;
  productId: string | null;
  contentHash: string;
};
export type Capacity = { limit: number | null; used: number; remaining: number | null };

export function contentHash(p: ImportProduct): string {
  return sha(JSON.stringify({
    n: p.name, d: p.description, c: p.category, t: p.tags, i: p.images,
    v: p.variants.map((v) => [v.sku, v.size, v.color, v.priceCents, v.stock, v.weightGrams]),
  }), 24);
}

/** Live products against the plan's cap. Imports land as drafts, so they never use it up. */
export async function readCapacity(ownerId: string, limit: number | null): Promise<Capacity> {
  const used = await countActiveProducts(db, ownerId);
  return { limit, used, remaining: limit === null ? null : Math.max(0, limit - used) };
}

/**
 * Decides create / update / unchanged for each product. Read-only.
 */
export async function planImport(ownerId: string, source: ImportSource, items: ImportProduct[]): Promise<PlannedProduct[]> {
  const keys = items.map((p) => p.externalKey);
  const mappings = keys.length
    ? await db.select().from(productImportMappings)
        .where(and(eq(productImportMappings.ownerId, ownerId), eq(productImportMappings.source, source), inArray(productImportMappings.externalKey, keys)))
    : [];
  const byKey = new Map(mappings.map((m) => [m.externalKey, m]));
  const liveIds = mappings.length
    ? new Set((await db.select({ id: products.id }).from(products)
        .where(and(inArray(products.id, mappings.map((m) => m.productId)), eq(products.ownerId, ownerId), isNull(products.deletedAt)))).map((r) => r.id))
    : new Set<string>();
  return items.map((product) => {
    const hash = contentHash(product);
    const mapping = byKey.get(product.externalKey);
    if (!mapping || !liveIds.has(mapping.productId)) return { product, action: "create", productId: null, contentHash: hash };
    return { product, action: mapping.contentHash === hash ? "unchanged" : "update", productId: mapping.productId, contentHash: hash };
  });
}

/** Fills blank SKUs and resolves duplicates within the file. Pure; used by preview and commit. */
export function assignSkus(ownerId: string, source: ImportSource, p: ImportProduct, claimed: Set<string>): { skus: string[]; notes: string[] } {
  const notes: string[] = [];
  const skus = p.variants.map((v, i) => {
    let sku = v.sku.trim();
    if (!sku) sku = `IMP-${sha(`${ownerId}|${source}|${p.externalKey}|${i}`, 20).toUpperCase()}`;
    let candidate = sku;
    let n = 1;
    while (claimed.has(candidate.toLowerCase())) {
      n += 1;
      candidate = `${sku}-${n}`;
    }
    if (candidate !== sku) notes.push(`SKU ${sku} appears more than once; one was saved as ${candidate}.`);
    claimed.add(candidate.toLowerCase());
    return candidate;
  });
  return { skus, notes };
}

/** SKUs are unique across the platform; report which already belong to some other product. */
export async function skusTakenElsewhere(skus: string[], exceptProductId: string | null): Promise<Set<string>> {
  if (!skus.length) return new Set();
  const rows = await db.select({ sku: productVariants.sku }).from(productVariants)
    .where(and(inArray(productVariants.sku, skus), exceptProductId ? ne(productVariants.productId, exceptProductId) : undefined));
  return new Set(rows.map((r) => r.sku));
}

function disambiguate(ownerId: string, source: ImportSource, key: string, sku: string): string {
  return `${sku}-${sha(`${ownerId}|${source}|${key}|${sku}`, 6).toUpperCase()}`;
}

export type ProductResult = {
  name: string;
  externalKey: string;
  action: "created" | "updated" | "unchanged" | "failed" | "skipped";
  productId?: string;
  reason?: string;
  notes?: string[];
};

export type CommitSummary = {
  runCounts: { created: number; updated: number; unchanged: number; failed: number; skipped: number };
  results: ProductResult[];
  planLimitReached: boolean;
};

type Saved = { kind: "created" | "updated" | "unchanged"; productId: string; notes: string[] } | { kind: "plan_limit" } | { kind: "deleted" };

async function saveOne(
  ownerId: string, source: ImportSource, planned: PlannedProduct, planLimit: number | null,
  claimed: Set<string>, runId: string,
): Promise<Saved> {
  const p = planned.product;
  return db.transaction(async (tx) => {
    // Serialise concurrent imports of the same record (double taps, retries).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`product-import:${ownerId}|${source}|${p.externalKey}`}))`);
    const [mapping] = await tx.select().from(productImportMappings).where(and(
      eq(productImportMappings.ownerId, ownerId), eq(productImportMappings.source, source),
      eq(productImportMappings.externalKey, p.externalKey))).limit(1);

    let productId: string | null = null;
    if (mapping) {
      const [existing] = await tx.select({ id: products.id, deletedAt: products.deletedAt }).from(products)
        .where(and(eq(products.id, mapping.productId), eq(products.ownerId, ownerId))).limit(1);
      if (existing?.deletedAt) return { kind: "deleted" } as Saved;
      if (existing) productId = existing.id;
    }

    const hash = planned.contentHash;
    if (productId && mapping && mapping.contentHash === hash) {
      await tx.update(productImportMappings).set({ lastImportedAt: new Date(), lastRunId: runId }).where(eq(productImportMappings.id, mapping.id));
      return { kind: "unchanged", productId, notes: [] } as Saved;
    }

    const notes: string[] = [];
    const { skus: wanted, notes: dupNotes } = assignSkus(ownerId, source, p, claimed);
    notes.push(...dupNotes);

    // Resolve against the database (SKUs are globally unique).
    const taken = new Set((await tx.select({ sku: productVariants.sku }).from(productVariants)
      .where(and(inArray(productVariants.sku, wanted), productId ? ne(productVariants.productId, productId) : undefined))).map((r) => r.sku));
    const finalSkus = wanted.map((sku) => {
      if (!taken.has(sku)) return sku;
      const alt = disambiguate(ownerId, source, p.externalKey, sku);
      notes.push(`SKU ${sku} is already used by another product; saved as ${alt}.`);
      return alt;
    });

    if (!productId) {
      const archived = p.sourceStatus === "archived";
      // Imported products are saved as drafts: the plan cap only limits publishing.
      const [created] = await tx.insert(products).values({
        id: crypto.randomUUID(), ownerId, name: p.name, description: p.description, category: p.category,
        status: archived ? "archived" : "draft", images: p.images, tags: p.tags,
      }).returning({ id: products.id });
      productId = created.id;
      await tx.insert(productVariants).values(p.variants.map((v, i) => ({
        productId: created.id, size: v.size, color: v.color, sku: finalSkus[i], priceCents: v.priceCents,
        stock: v.stock, lowStockThreshold: 5, weightGrams: v.weightGrams ?? 0,
      })));
      await tx.insert(productImportMappings).values({
        ownerId, source, externalKey: p.externalKey, productId, contentHash: hash, lastRunId: runId,
      }).onConflictDoUpdate({
        target: [productImportMappings.ownerId, productImportMappings.source, productImportMappings.externalKey],
        set: { productId, contentHash: hash, lastRunId: runId, lastImportedAt: new Date() },
      });
      return { kind: "created", productId, notes } as Saved;
    }

    // Update in place: fields from the file win; variants match by SKU.
    await tx.update(products).set({
      name: p.name, description: p.description, category: p.category, images: p.images, tags: p.tags, updatedAt: new Date(),
    }).where(and(eq(products.id, productId), eq(products.ownerId, ownerId)));
    const current = await tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants)
      .where(eq(productVariants.productId, productId));
    const idBySku = new Map(current.map((v) => [v.sku, v.id]));
    for (let i = 0; i < p.variants.length; i++) {
      const v = p.variants[i];
      const existingId = idBySku.get(finalSkus[i]);
      if (existingId) {
        await tx.update(productVariants).set({
          size: v.size, color: v.color, priceCents: v.priceCents, stock: v.stock,
          ...(v.weightGrams != null ? { weightGrams: v.weightGrams } : {}), updatedAt: new Date(),
        }).where(eq(productVariants.id, existingId));
      } else {
        await tx.insert(productVariants).values({
          productId, size: v.size, color: v.color, sku: finalSkus[i], priceCents: v.priceCents,
          stock: v.stock, lowStockThreshold: 5, weightGrams: v.weightGrams ?? 0,
        });
      }
    }
    if (mapping) {
      await tx.update(productImportMappings).set({ contentHash: hash, lastRunId: runId, lastImportedAt: new Date(), productId })
        .where(eq(productImportMappings.id, mapping.id));
    } else {
      await tx.insert(productImportMappings).values({ ownerId, source, externalKey: p.externalKey, productId, contentHash: hash, lastRunId: runId });
    }
    return { kind: "updated", productId, notes } as Saved;
  });
}

export async function commitProducts(params: {
  ownerId: string;
  source: ImportSource;
  items: ImportProduct[];
  planLimit: number | null;
  runId: string;
  log?: { error: (obj: unknown, msg?: string) => void };
}): Promise<CommitSummary> {
  const { ownerId, source, items, planLimit, runId, log } = params;
  const plan = await planImport(ownerId, source, items);
  const summary: CommitSummary = {
    runCounts: { created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0 }, results: [], planLimitReached: false,
  };
  const claimed = new Set<string>();
  for (const planned of plan) {
    const base = { name: planned.product.name, externalKey: planned.product.externalKey };
    try {
      const saved = await saveOne(ownerId, source, planned, planLimit, claimed, runId);
      if (saved.kind === "plan_limit") {
        summary.planLimitReached = true;
        summary.runCounts.skipped++;
        summary.results.push({ ...base, action: "skipped", reason: "Your plan's product limit was reached." });
      } else if (saved.kind === "deleted") {
        summary.runCounts.skipped++;
        summary.results.push({ ...base, action: "skipped", reason: "This product was deleted. Restore it from Recently deleted to update it." });
      } else {
        summary.runCounts[saved.kind]++;
        summary.results.push({ ...base, action: saved.kind, productId: saved.productId, ...(saved.notes.length ? { notes: saved.notes } : {}) });
      }
    } catch (error) {
      log?.error({ err: error, externalKey: planned.product.externalKey }, "Product import row failed");
      summary.runCounts.failed++;
      summary.results.push({ ...base, action: "failed", reason: "Couldn't save this product." });
    }
  }
  return summary;
}

export function toPreviewIssue(p: ImportProduct, message: string): Issue {
  return { severity: "warning", line: p.lines[0] ?? 0, product: p.name, field: "sku", message };
}
