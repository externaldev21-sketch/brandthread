export const BUYER_CANCELLATION_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const BUYER_CANCELLABLE_ORDER_STATUSES = ["pending", "processing", "fulfilled"] as const;

/**
 * Windows a seller can pick (users.buyer_cancel_window_hours, migration 272).
 * null means "until shipped": the platform default above. Every option is
 * shorter than the default, so a seller can only narrow it.
 */
export const SELLER_CANCEL_WINDOW_HOURS = [1, 12, 24, 72] as const;
export type SellerCancelWindowHours = (typeof SELLER_CANCEL_WINDOW_HOURS)[number];

const HOUR_MS = 60 * 60 * 1000;

/** Validates a seller's choice. Returns `{ ok: false }` for anything not in the list. */
export function parseSellerCancelWindowHours(value: unknown):
  | { ok: true; hours: SellerCancelWindowHours | null }
  | { ok: false } {
  if (value === null) return { ok: true, hours: null };
  if (typeof value === "number" && (SELLER_CANCEL_WINDOW_HOURS as readonly number[]).includes(value)) {
    return { ok: true, hours: value as SellerCancelWindowHours };
  }
  return { ok: false };
}

/** The window in ms for a seller's stored value; unknown or null values use the default. */
export function buyerCancellationWindowMs(sellerWindowHours?: number | null): number {
  const parsed = parseSellerCancelWindowHours(sellerWindowHours ?? null);
  return parsed.ok && parsed.hours !== null ? parsed.hours * HOUR_MS : BUYER_CANCELLATION_WINDOW_MS;
}

/** When the buyer's self-cancel closes, or null when the order can no longer be cancelled by status. */
export function buyerCancelDeadline(status: string, createdAt: Date | string, sellerWindowHours?: number | null): string | null {
  if (!(BUYER_CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(status)) return null;
  const placed = new Date(createdAt).getTime();
  if (!Number.isFinite(placed)) return null;
  return new Date(placed + buyerCancellationWindowMs(sellerWindowHours)).toISOString();
}

export function buyerCancellationEligibility(
  status: string,
  createdAt: Date | string,
  nowMs = Date.now(),
  sellerWindowHours?: number | null,
) {
  if (!(BUYER_CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(status)) {
    return { eligible: false, reason: "shipped_or_ineligible" } as const;
  }
  const ageMs = nowMs - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > buyerCancellationWindowMs(sellerWindowHours)) {
    return { eligible: false, reason: "window_expired" } as const;
  }
  return { eligible: true, reason: null } as const;
}
