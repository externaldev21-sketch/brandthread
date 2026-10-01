/**
 * One-page-checkout-specific stock *hold*, layered on top of the shared
 * atomic-decrement primitives in `lib/stockReservation.ts`.
 *
 * The shared seam (`reserveStockForOrder`/`reserveStockAtomic`) decrements
 * stock at order-creation time, inside the same transaction as the order
 * insert — that's correct for a webhook that creates the order synchronously
 * with the charge. The one-page checkout doesn't have that luxury: it must
 * take stock out *before* the buyer confirms an Apple Pay / Google Pay /
 * inline-card PaymentIntent, since that confirmation is an async, client-side
 * step that can take anywhere from seconds to (if abandoned) never. So this
 * module reserves the units up front, at "Pay" time, and tracks each
 * reservation as a `stock_reservations` row with a status:
 *
 *  - held: units are out of `product_variants.stock`, checkout is in flight;
 *  - committed: the paid webhook created the order and reused these units
 *    (see `commitStockReservation` — no second decrement needed);
 *  - released: payment failed, was cancelled, or the reservation expired
 *    (see `releaseStockReservation`). The units go back;
 *  - a payment that lands after an expiry sees "released", so the webhook
 *    falls back to the shared seam's normal reserve-at-order-creation path
 *    (and refunds if that now finds it oversold).
 *
 * Every transition is a conditional UPDATE on `status`, so each is exactly
 * once under retries and races. The actual stock arithmetic — the
 * conditional decrement and its inverse restore — is not reimplemented here;
 * it delegates to `reserveStockAtomic`/`restoreStockForOrder` in
 * `lib/stockReservation.ts`, the same primitives `reserveStockForOrder` (used
 * by the Stripe webhook and `POST /api/orders`) is built from.
 */
import { sql } from "drizzle-orm";
import type { DbExecutor } from "./ledger";
import { reserveStockAtomic, restoreStockForOrder } from "../stockReservation";
import { releaseForCheckout as releaseGiftCardsForCheckout } from "../giftCards/service";

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
    const ok = await reserveStockAtomic(tx, line.variantId, line.quantity);
    if (!ok) {
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
  // A checkout that lets go of its stock also lets go of any gift card it was holding.
  await releaseGiftCardsForCheckout(tx, checkoutSessionId);
  const released = rows<{ variant_id: string; quantity: number }>(await tx.execute(sql`
    UPDATE stock_reservations SET status = 'released', updated_at = now()
    WHERE checkout_session_id = ${checkoutSessionId}::uuid AND status = 'held'
    RETURNING variant_id, quantity
  `));
  await restoreStockForOrder(tx, released.map((line) => ({ variantId: line.variant_id, quantity: line.quantity })));
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
