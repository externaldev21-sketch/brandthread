/**
 * Product-level variant edits for PUT /api/products/:id — the seller's
 * product editor saving prices (and optionally stock) for the product's
 * existing variants in one request.
 *
 * Only EXISTING variants of this product are touched, matched by `id` or
 * exact `sku`; unmatched entries are ignored (never inserted, never deleted),
 * so a stale editor can't create duplicate SKUs or drop variants. Runs under
 * a row lock so a concurrent sale's `stock = stock - qty` isn't overwritten
 * by a read-modify-write here. Saved-product alerts (back in stock / price
 * drop) are judged on the product-level before/after snapshot.
 */
import { and, eq } from "drizzle-orm";
import { db, productVariants } from "@workspace/db";
import { onProductStockPriceChanged, snapshotProduct } from "./savedProductAlerts";
import { notifyStockLevelChanged } from "./stockNotifications";

export interface ProductLevelVariantEdit {
  id?: string;
  sku?: string;
  priceCents?: number;
  stock?: number;
}

/** Validates the `variants` body field. Returns an error message, or the parsed list. */
export function parseProductLevelVariantEdits(raw: unknown): { error: string } | { edits: ProductLevelVariantEdit[] } {
  if (raw === undefined) return { edits: [] };
  if (!Array.isArray(raw)) return { error: "variants must be an array" };
  if (raw.length > 250) return { error: "Too many variants" };
  const edits: ProductLevelVariantEdit[] = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i] as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return { error: `variants[${i}] must be an object` };
    const id = typeof v.id === "string" && v.id ? v.id : undefined;
    const sku = typeof v.sku === "string" && v.sku.trim() ? v.sku.trim() : undefined;
    if (!id && !sku) return { error: `variants[${i}]: id or sku is required` };
    if (v.priceCents !== undefined && (!Number.isInteger(v.priceCents) || (v.priceCents as number) <= 0)) {
      return { error: `variants[${i}]: priceCents must be a positive integer` };
    }
    if (v.stock !== undefined && (!Number.isInteger(v.stock) || (v.stock as number) < 0)) {
      return { error: `variants[${i}]: stock must be a non-negative integer` };
    }
    edits.push({ id, sku, priceCents: v.priceCents as number | undefined, stock: v.stock as number | undefined });
  }
  return { edits };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Applies the edits; returns how many variants changed. Alerts are scheduled after commit. */
export async function applyProductLevelVariantEdits(input: {
  productId: string;
  ownerId: string;
  productName: string;
  edits: ProductLevelVariantEdit[];
}): Promise<number> {
  const edits = input.edits.filter((e) => e.priceCents !== undefined || e.stock !== undefined);
  if (edits.length === 0) return 0;

  const outcome = await db.transaction(async (tx) => {
    const current = await tx.select().from(productVariants)
      .where(eq(productVariants.productId, input.productId))
      .for("update");
    const before = await snapshotProduct(input.productId, tx);
    const byId = new Map(current.map((v) => [v.id, v]));
    const bySku = new Map(current.map((v) => [v.sku, v]));
    const stockChanges: Array<{ previousStock: number; newStock: number; lowStockThreshold: number }> = [];
    let changed = 0;
    for (const edit of edits) {
      const variant = (edit.id && UUID_RE.test(edit.id) ? byId.get(edit.id) : undefined)
        ?? (edit.sku ? bySku.get(edit.sku) : undefined);
      if (!variant) continue;
      const set: Partial<typeof productVariants.$inferInsert> = {};
      if (edit.priceCents !== undefined && edit.priceCents !== variant.priceCents) set.priceCents = edit.priceCents;
      if (edit.stock !== undefined && edit.stock !== variant.stock) set.stock = edit.stock;
      if (Object.keys(set).length === 0) continue;
      await tx.update(productVariants).set({ ...set, updatedAt: new Date() })
        .where(and(eq(productVariants.id, variant.id), eq(productVariants.productId, input.productId)));
      if (set.stock !== undefined) {
        stockChanges.push({ previousStock: variant.stock, newStock: set.stock, lowStockThreshold: variant.lowStockThreshold });
      }
      changed += 1;
    }
    const after = changed > 0 ? await snapshotProduct(input.productId, tx) : before;
    return { before, after, changed, stockChanges };
  });

  if (outcome.changed > 0) {
    onProductStockPriceChanged(input.productId, outcome.before, outcome.after);
    for (const change of outcome.stockChanges) {
      void notifyStockLevelChanged({
        productId: input.productId, ownerId: input.ownerId, productName: input.productName, ...change,
      });
    }
  }
  return outcome.changed;
}
