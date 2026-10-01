/**
 * Server-authoritative, atomic per-variant stock reservation.
 *
 * This is the single seam every order-creation path should call to decide
 * and apply a stock decrement — instead of each route re-implementing its
 * own lock/check/decrement dance (which is how `POST /api/orders` ended up
 * with a plain read-then-write race before this module existed). Current
 * callers:
 *   - routes/webhooks.ts        `handleCheckoutPaid` (Stripe checkout webhook)
 *   - routes/orders.ts          `POST /api/orders` (seller-created manual order)
 *
 * A future one-page/buyer checkout order-creation path should call
 * `reserveStockForOrder` the same way rather than writing its own SQL — pass
 * it the order's line items inside the same `db.transaction` that inserts
 * the order row, exactly as the two callers above do.
 */
import { sql, type SQLWrapper } from "drizzle-orm";

export interface StockLineItem {
  variantId: string;
  quantity: number;
}

export interface ReserveStockResult {
  ok: boolean;
  /** Distinct variantIds that did not have enough stock at reservation time.
   *  Empty when `ok` is true. Nothing is decremented when this is non-empty
   *  — the reservation is all-or-nothing. */
  oversoldVariantIds: string[];
}

/** Minimal shape needed from a drizzle transaction/db handle — avoids a hard
 *  dependency on a specific driver's transaction type so this stays callable
 *  from any route file already holding a `tx`. */
export interface SqlExecutor {
  execute: (query: string | SQLWrapper) => Promise<unknown>;
}

/**
 * Hands committed-later stock changes to the shared follow-up (seller alerts +
 * per-product sold-out behaviour, see lib/stockRules.ts). Loaded lazily and
 * fully guarded: it can never affect the reservation itself.
 */
function notifyStockChanged(changes: Array<{ variantId: string; previousStock: number; newStock: number }>): void {
  if (changes.length === 0) return;
  void import("./stockRules").then((m) => m.queueStockChanges(changes)).catch(() => undefined);
}

function rowsOf(result: unknown): any[] {
  return (result as any)?.rows ?? [];
}

function aggregateByVariant(lineItems: StockLineItem[]): Map<string, number> {
  const aggregated = new Map<string, number>();
  for (const item of lineItems) {
    if (!item.variantId || !Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    aggregated.set(item.variantId, (aggregated.get(item.variantId) ?? 0) + item.quantity);
  }
  return aggregated;
}

/**
 * Atomically reserves (decrements) stock for every line item of one order,
 * all-or-nothing, inside the caller's transaction.
 *
 * Must be called with `tx` from an open `db.transaction(async (tx) => ...)`
 * — reservation and the rest of that transaction (the order insert, order
 * items, ledger writes, …) commit or roll back together.
 *
 * Correctness under concurrency:
 *   1. Duplicate lines for the same variant are aggregated first, so two
 *      lines of the same SKU can't each pass an individual stock check that
 *      the combined quantity would fail.
 *   2. Every distinct variant row is locked with `SELECT ... FOR UPDATE`, in
 *      deterministic (sorted) variantId order, before any check runs — this
 *      is what makes two concurrent orders for the same SKU serialize
 *      instead of racing, and the sort order is what prevents a deadlock
 *      when two orders share more than one SKU in different orders.
 *   3. Every aggregated line is checked against its locked stock value.
 *      Any shortfall aborts the whole reservation (returns `ok: false`,
 *      nothing decremented) — this order can never partially claim stock.
 *   4. Only if every line passes does the function decrement, still holding
 *      the same row locks, so no other transaction can have changed the
 *      stock value between the check and the decrement.
 */
export async function reserveStockForOrder(
  tx: SqlExecutor,
  lineItems: StockLineItem[],
): Promise<ReserveStockResult> {
  const aggregated = aggregateByVariant(lineItems);
  if (aggregated.size === 0) return { ok: true, oversoldVariantIds: [] };

  const sortedVariantIds = [...aggregated.keys()].sort();

  const stockMap = new Map<string, number>();
  for (const variantId of sortedVariantIds) {
    const result = await tx.execute(
      sql`SELECT stock FROM product_variants WHERE id = ${variantId}::uuid FOR UPDATE`,
    );
    stockMap.set(variantId, rowsOf(result)[0]?.stock ?? 0);
  }

  const oversoldVariantIds: string[] = [];
  for (const [variantId, quantity] of aggregated) {
    if ((stockMap.get(variantId) ?? 0) < quantity) oversoldVariantIds.push(variantId);
  }
  if (oversoldVariantIds.length > 0) {
    return { ok: false, oversoldVariantIds };
  }

  for (const [variantId, quantity] of aggregated) {
    await tx.execute(
      sql`UPDATE product_variants SET stock = stock - ${quantity} WHERE id = ${variantId}::uuid`,
    );
  }
  notifyStockChanged([...aggregated].map(([variantId, quantity]) => {
    const previousStock = stockMap.get(variantId) ?? 0;
    return { variantId, previousStock, newStock: previousStock - quantity };
  }));
  return { ok: true, oversoldVariantIds: [] };
}

/**
 * Single-variant conditional decrement — `UPDATE ... SET stock = stock - n
 * WHERE stock >= n`. Equivalent to `reserveStockForOrder` for exactly one
 * line item, without the `FOR UPDATE` round trip; the `WHERE stock >= n`
 * guard makes it just as safe against a concurrent reservation on the same
 * row (whichever statement commits first wins; the loser's `rowCount` is 0).
 * Prefer `reserveStockForOrder` for anything with more than one line item so
 * multi-line orders stay all-or-nothing.
 */
export async function reserveStockAtomic(
  tx: SqlExecutor,
  variantId: string,
  quantity: number,
): Promise<boolean> {
  if (!variantId || !Number.isFinite(quantity) || quantity <= 0) return true;
  const result = await tx.execute(
    sql`UPDATE product_variants SET stock = stock - ${quantity} WHERE id = ${variantId}::uuid AND stock >= ${quantity} RETURNING stock`,
  );
  const ok = ((result as any)?.rowCount ?? 0) > 0;
  const newStock = rowsOf(result)[0]?.stock;
  if (ok && typeof newStock === "number") notifyStockChanged([{ variantId, previousStock: newStock + quantity, newStock }]);
  return ok;
}

/**
 * Restores stock for an order's line items — the inverse of a successful
 * `reserveStockForOrder`/`reserveStockAtomic` call. Used on refund, return,
 * or cancellation (see lib/money/refunds.ts's `cancelOrder.restock`).
 * Additive and order-independent, so it needs no locking of its own beyond
 * running inside the caller's transaction alongside the rest of that
 * refund/cancellation's state change.
 */
export async function restoreStockForOrder(tx: SqlExecutor, lineItems: StockLineItem[]): Promise<void> {
  const aggregated = aggregateByVariant(lineItems);
  const changes: Array<{ variantId: string; previousStock: number; newStock: number }> = [];
  for (const [variantId, quantity] of aggregated) {
    const result = await tx.execute(
      sql`UPDATE product_variants SET stock = stock + ${quantity} WHERE id = ${variantId}::uuid RETURNING stock`,
    );
    const newStock = rowsOf(result)[0]?.stock;
    if (typeof newStock === "number") changes.push({ variantId, previousStock: newStock - quantity, newStock });
  }
  notifyStockChanged(changes);
}
