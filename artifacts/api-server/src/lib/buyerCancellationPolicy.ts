export const BUYER_CANCELLATION_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;
export const BUYER_CANCELLABLE_ORDER_STATUSES = ["pending", "processing", "fulfilled"] as const;

export function buyerCancellationEligibility(status: string, createdAt: Date | string, nowMs = Date.now()) {
  if (!(BUYER_CANCELLABLE_ORDER_STATUSES as readonly string[]).includes(status)) {
    return { eligible: false, reason: "shipped_or_ineligible" } as const;
  }
  const ageMs = nowMs - new Date(createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > BUYER_CANCELLATION_WINDOW_MS) {
    return { eligible: false, reason: "window_expired" } as const;
  }
  return { eligible: true, reason: null } as const;
}