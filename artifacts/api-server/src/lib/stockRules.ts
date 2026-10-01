/**
 * Shared follow-up for every stock write: applies the product's sold-out
 * behaviour and (for order paths) raises the seller low-stock / restock alerts.
 *
 *  - Seller edit paths (inventory adjust, variant PATCH, bulk update) already
 *    alert; they just call `afterStockChange(productId)`.
 *  - Order paths (`lib/stockReservation.ts`) run inside a DB transaction that
 *    has not committed yet, so they call `queueStockChanges` — it waits a beat
 *    for the commit, then re-reads the committed stock. Rolled back
 *    reservations are detected (stock still equals the previous value) and
 *    produce nothing.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, products, productVariants, productStockRules } from "@workspace/db";
import { logActivity } from "./activityLog";
import { logger } from "./logger";
import { notifyBackInStock, notifyStockLevelChanged } from "./stockNotifications";
import { decideSoldOutAction, type SoldOutAction, type SoldOutBehavior } from "./variantMatrix";

/** Applies the product's sold-out behaviour for its current total stock. Safe to call repeatedly. */
export async function afterStockChange(productId: string): Promise<SoldOutAction> {
  try {
    const [product] = await db
      .select({
        id: products.id, ownerId: products.ownerId, name: products.name, status: products.status,
        isPreOrder: products.isPreOrder, dropId: products.dropId, deletedAt: products.deletedAt,
      })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (!product || product.deletedAt) return "none";

    const [rule] = await db.select().from(productStockRules).where(eq(productStockRules.productId, productId)).limit(1);
    if (!rule) return "none";

    const [totals] = await db
      .select({
        total: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(productVariants)
      .where(eq(productVariants.productId, productId));

    const action = decideSoldOutAction({
      totalStock: totals?.total ?? 0,
      variantCount: totals?.count ?? 0,
      behavior: rule.soldOutBehavior as SoldOutBehavior,
      status: product.status,
      isPreOrder: product.isPreOrder,
      inDrop: !!product.dropId,
      autoHidden: !!rule.autoHiddenAt,
    });

    const now = new Date();
    if (action === "hide") {
      const moved = await db.update(products).set({ status: "draft", updatedAt: now })
        .where(and(eq(products.id, productId), eq(products.status, "active"))).returning({ id: products.id });
      if (moved.length > 0) {
        await db.update(productStockRules).set({ autoHiddenAt: now, updatedAt: now }).where(eq(productStockRules.productId, productId));
        void logActivity(product.ownerId, product.ownerId, "system", `${product.name} sold out and was hidden from the shop`, "product", productId, { soldOutBehavior: "hide" });
      }
    } else if (action === "archive") {
      const moved = await db.update(products).set({ status: "archived", updatedAt: now })
        .where(and(eq(products.id, productId), eq(products.status, "active"))).returning({ id: products.id });
      if (moved.length > 0) {
        await db.update(productStockRules).set({ autoArchivedAt: now, updatedAt: now }).where(eq(productStockRules.productId, productId));
        void logActivity(product.ownerId, product.ownerId, "system", `${product.name} sold out and was archived`, "product", productId, { soldOutBehavior: "archive" });
      }
    } else if (action === "restore") {
      const moved = await db.update(products).set({ status: "active", updatedAt: now })
        .where(and(eq(products.id, productId), eq(products.status, "draft"))).returning({ id: products.id });
      await db.update(productStockRules).set({ autoHiddenAt: null, updatedAt: now }).where(eq(productStockRules.productId, productId));
      if (moved.length > 0) {
        void logActivity(product.ownerId, product.ownerId, "system", `${product.name} is back in stock and visible again`, "product", productId, { soldOutBehavior: "hide" });
      }
    } else if (rule.autoHiddenAt && product.status !== "draft" && ((totals?.total ?? 0) > 0 || rule.soldOutBehavior === "show")) {
      // The seller changed the status themselves — stop owning it.
      await db.update(productStockRules).set({ autoHiddenAt: null, updatedAt: now }).where(eq(productStockRules.productId, productId));
    }
    return action;
  } catch (err) {
    logger.warn({ err, productId }, "afterStockChange failed");
    return "none";
  }
}

export interface StockChange {
  variantId: string;
  previousStock: number;
  newStock: number;
}

/** Alerts + sold-out handling for variant stock changes that are already committed. */
export async function processStockChanges(changes: StockChange[]): Promise<void> {
  try {
    const byVariant = new Map<string, StockChange>();
    for (const change of changes) {
      const existing = byVariant.get(change.variantId);
      byVariant.set(change.variantId, existing
        ? { variantId: change.variantId, previousStock: existing.previousStock, newStock: change.newStock }
        : change);
    }
    const productIds = new Set<string>();
    for (const change of byVariant.values()) {
      const [row] = await db
        .select({
          stock: productVariants.stock, threshold: productVariants.lowStockThreshold,
          productId: products.id, ownerId: products.ownerId, name: products.name,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(eq(productVariants.id, change.variantId))
        .limit(1);
      if (!row) continue;
      productIds.add(row.productId);
      // A rolled-back reservation leaves the stock where it was: nothing happened.
      if (row.stock === change.previousStock) continue;
      await notifyStockLevelChanged({
        productId: row.productId, ownerId: row.ownerId, productName: row.name,
        previousStock: change.previousStock, newStock: change.newStock, lowStockThreshold: row.threshold,
      });
      await notifyBackInStock({
        productId: row.productId, ownerId: row.ownerId, productName: row.name,
        previousStock: change.previousStock, newStock: change.newStock,
      });
    }
    for (const productId of productIds) await afterStockChange(productId);
  } catch (err) {
    logger.warn({ err }, "processStockChanges failed");
  }
}

let commitDelayMs = 1500;
const pending: StockChange[][] = [];

/** Test hook: how long order paths wait for their transaction to commit. */
export function setStockChangeDelayMs(ms: number): void {
  commitDelayMs = ms;
}

/** Runs every queued order-path change now (tests, shutdown). */
export async function flushQueuedStockChanges(): Promise<void> {
  const batches = pending.splice(0);
  for (const batch of batches) await processStockChanges(batch);
}

/** Called from inside stock reservation transactions; never throws. */
export function queueStockChanges(changes: StockChange[]): void {
  const real = changes.filter((c) => c.variantId && Number.isFinite(c.previousStock) && Number.isFinite(c.newStock) && c.previousStock !== c.newStock);
  if (real.length === 0) return;
  pending.push(real);
  const timer = setTimeout(() => {
    const index = pending.indexOf(real);
    if (index === -1) return; // already flushed
    pending.splice(index, 1);
    void processStockChanges(real);
  }, commitDelayMs);
  timer.unref?.();
}
