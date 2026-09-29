/**
 * Server-authoritative stock reservation for the one-page checkout.
 *
 * `reserveStock` takes stock out of `product_variants` at pay time with one
 * conditional UPDATE per variant:
 *
 *   UPDATE product_variants SET stock = stock - n WHERE id = $v AND stock >= n
 *
 * It runs inside the caller's transaction, all or nothing: if any line can't
 * be covered, it throws and the caller's rollback puts back every line
 * already taken. Variants are locked in a fixed order, so two carts sharing
 * variants can't deadlock.
 *
 * A reservation then ends one of three ways:
 *  - committed: the paid webhook creates the order and skips its own stock
 *    decrement (the units were already taken here);
 *  - released: payment failed, was cancelled, or the reservation expired.
 *    The units go back;
 *  - a payment that lands after an expiry sees "released", so the webhook
 *    falls back to its normal stock check (and refunds if it's now oversold).
 *
 * Every transition is a conditional UPDATE on `status`, so each is exactly
 * once under retries and races.
 *
 * This is the primitive the products/inventory work (Workstream C) was also
 * asked to expose. Whichever of the two merges second should call the other's
 * function rather than keep two.
 */
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./ledger";

/** How long a checkout may sit between "Pay" and Stripe's answer before its units go back. */
export const STOCK_RESERVATION_TTL_MS = 30 * 60_000;

export class StockReservationError extends Error {
  constructor(message: string, readonly variantId: string, readonly productName: string | null) {
    super(message);
    this.name = "StockReservationError";
  }
}

export type ReservationLine = { variantId: string; quantity: number; productName?: string | null };

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []);
}

/**
 * Reserves every line for one checkout (one seller group). Call inside a
 * transaction. Duplicate variants are merged first.
 */
export async function reserveStock(
  tx: DbExecutor,
  checkoutSessionId: string,
  lines: ReservationLine[],
  options: { paymentIntentId?: string | null; now?: Date; ttlMs?: number } = {},
): Promise<void> {
  const merged = new Map<string, ReservationLine>();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new StockReservationError("Invalid quantity", line.variantId, line.productName ?? null);
    }
    const existing = merged.get(line.variantId);
    merged.set(line.variantId, existing ? { ...existing, quantity: existing.quantity + line.quantity } : { ...line });
  }
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.valueOf() + (options.ttlMs ?? STOCK_RESERVATION_TTL_MS));
  for (const line of [...merged.values()].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
    const taken = rows<{ id: string }>(await tx.execute(sql`
      UPDATE product_variants SET stock = stock - ${line.quantity}
      WHERE id = ${line.variantId}::uuid AND stock >= ${line.quantity}
      RETURNING id
    `));
    if (taken.length === 0) {
      throw new StockReservationError(
        `${line.productName ?? "An item"} doesn't have enough stock left`,
        line.variantId,
        line.productName ?? null,
      );
    }
    await tx.execute(sql`
      INSERT INTO stock_reservations (checkout_session_id, variant_id, quantity, status, stripe_payment_intent_id, expires_at)
      VALUES (${checkoutSessionId}::uuid, ${line.variantId}::uuid, ${line.quantity}, 'held', ${options.paymentIntentId ?? null}, ${expiresAt})
    `);
  }
}

/** Marks this checkout's reservation as turned into an order. Returns how many lines it held (0 = none held). */
export async function commitStockReservation(tx: DbExecutor, checkoutSessionId: string): Promise<number> {
  const committed = rows<{ id: string }>(await tx.execute(sql`
    UPDATE stock_reservations SET status = 'committed', updated_at = now()
    WHERE checkout_session_id = ${checkoutSessionId}::uuid AND status = 'held'
    RETURNING id
  `));
  return committed.length;
}

/** Puts this checkout's held units back. Idempotent. Returns how many lines went back. */
export async function releaseStockReservation(tx: DbExecutor, checkoutSessionId: string): Promise<number> {
  const released = rows<{ variant_id: string; quantity: number }>(await tx.execute(sql`
    UPDATE stock_reservations SET status = 'released', updated_at = now()
    WHERE checkout_session_id = ${checkoutSessionId}::uuid AND status = 'held'
    RETURNING variant_id, quantity
  `));
  for (const line of released.sort((a, b) => a.variant_id.localeCompare(b.variant_id))) {
    await tx.execute(sql`
      UPDATE product_variants SET stock = stock + ${line.quantity} WHERE id = ${line.variant_id}::uuid
    `);
  }
  return released.length;
}

/** Checkouts with held units past their expiry. */
export async function expiredReservationCheckouts(
  executor: DbExecutor,
  now = new Date(),
  limit = 100,
): Promise<Array<{ checkoutSessionId: string; paymentIntentId: string | null }>> {
  return rows<{ checkout_session_id: string; stripe_payment_intent_id: string | null }>(await executor.execute(sql`
    SELECT checkout_session_id, MAX(stripe_payment_intent_id) AS stripe_payment_intent_id
    FROM stock_reservations
    WHERE status = 'held' AND expires_at <= ${now}
    GROUP BY checkout_session_id
    LIMIT ${limit}
  `)).map((row) => ({ checkoutSessionId: row.checkout_session_id, paymentIntentId: row.stripe_payment_intent_id }));
}
