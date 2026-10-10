/**
 * Validation for a seller-issued refund (POST /api/orders/:id/refund).
 *
 * A seller refund returns money to the buyer without cancelling the order —
 * a partial refund for a damaged or missing item, a goodwill refund, or the
 * full remaining amount on an order that has already shipped. Cancelling an
 * unshipped order (which also restocks) keeps going through
 * PATCH /api/orders/:id/status, and returns through /api/returns.
 *
 * `requestId` is generated once per refund attempt by the client so a retry
 * (double tap, flaky network) maps onto the same refund instead of a second one.
 */

export const SELLER_REFUND_REASONS = [
  "item_damaged",
  "item_missing",
  "wrong_item",
  "shipping_delay",
  "price_adjustment",
  "goodwill",
  "other",
] as const;
export type SellerRefundReason = (typeof SELLER_REFUND_REASONS)[number];

export const SELLER_REFUND_NOTE_MAX = 500;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export type SellerRefundRequest = {
  amountCents: number;
  reason: SellerRefundReason;
  note: string | null;
  requestId: string;
};

export type SellerRefundParse =
  | { ok: true; value: SellerRefundRequest }
  | { ok: false; error: string; code: string };

export function parseSellerRefundRequest(body: unknown): SellerRefundParse {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { amountCents, reason, note, requestId } = b;

  if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, error: "amountCents must be a positive whole number of cents", code: "INVALID_REFUND_AMOUNT" };
  }
  if (typeof reason !== "string" || !(SELLER_REFUND_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: `reason must be one of: ${SELLER_REFUND_REASONS.join(", ")}`, code: "VALIDATION_ERROR" };
  }
  let cleanNote: string | null = null;
  if (note !== undefined && note !== null) {
    if (typeof note !== "string") return { ok: false, error: "note must be a string", code: "VALIDATION_ERROR" };
    if (note.length > SELLER_REFUND_NOTE_MAX) {
      return { ok: false, error: `note must be ${SELLER_REFUND_NOTE_MAX} characters or fewer`, code: "VALIDATION_ERROR" };
    }
    cleanNote = note.trim() || null;
  }
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) {
    return { ok: false, error: "requestId must be 8-64 letters, digits, - or _", code: "VALIDATION_ERROR" };
  }
  return { ok: true, value: { amountCents, reason: reason as SellerRefundReason, note: cleanNote, requestId } };
}

/** Statuses a seller refund is refused from, with the message shown to them. */
export function sellerRefundBlockedReason(order: {
  status: string;
  autoRefundedAt?: Date | string | null;
  stripePaymentIntentId?: string | null;
}): { error: string; code: string } | null {
  if (order.autoRefundedAt) {
    return { error: "This order was already refunded automatically because it wasn't delivered in time.", code: "AUTO_REFUNDED" };
  }
  if (order.status === "refund_pending") {
    return { error: "A refund is already in progress for this order.", code: "REFUND_IN_PROGRESS" };
  }
  if (!order.stripePaymentIntentId) {
    return { error: "This order has no card payment to refund.", code: "NOT_REFUNDABLE" };
  }
  return null;
}

export function formatRefundAmount(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
