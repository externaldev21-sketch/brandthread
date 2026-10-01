/**
 * Glue between Stripe Radar data and the orders table, with injected
 * dependencies so it is testable without a database. Everything here is
 * best effort: a risk failure must never fail order creation or a webhook.
 */
import {
  applyReviewEvent, computeOrderRisk, isRiskLevel,
  type CardChecksInput, type ChargeOutcomeInput, type OrderRisk, type ReviewInput, type RiskFlag,
} from "./orderRisk";

/** What fetchChargeDetails reads off the charge for Radar. */
export type RadarChargeData = {
  outcome: ChargeOutcomeInput;
  cardChecks: CardChecksInput;
  billingCountry: string | null;
};

export type EnrichDeps = {
  /** Orders this buyer (or guest email) already has, excluding `excludeOrderId`. */
  countPriorOrders(input: { buyerId: string | null; guestEmail: string | null; excludeOrderId: string }): Promise<number>;
  saveRisk(orderId: string, risk: OrderRisk): Promise<void>;
  onError?(err: unknown, orderId: string): void;
};

export type EnrichInput = {
  orderId: string;
  buyerId: string | null;
  guestEmail: string | null;
  totalCents: number | null;
  shippingCountry: string | null;
  radar: RadarChargeData | null | undefined;
};

/** Computes and stores the order's risk. Never throws; returns null when skipped or failed. */
export async function enrichOrderRisk(deps: EnrichDeps, input: EnrichInput): Promise<OrderRisk | null> {
  try {
    let isFirstOrder: boolean | null = null;
    if (input.buyerId || input.guestEmail) {
      try {
        isFirstOrder = (await deps.countPriorOrders({
          buyerId: input.buyerId,
          guestEmail: input.guestEmail,
          excludeOrderId: input.orderId,
        })) === 0;
      } catch {
        isFirstOrder = null;
      }
    }
    const risk = computeOrderRisk({
      outcome: input.radar?.outcome ?? null,
      cardChecks: input.radar?.cardChecks ?? null,
      billingCountry: input.radar?.billingCountry ?? null,
      shippingCountry: input.shippingCountry,
      totalCents: input.totalCents,
      isFirstOrder,
    });
    await deps.saveRisk(input.orderId, risk);
    return risk;
  } catch (err) {
    try { deps.onError?.(err, input.orderId); } catch { /* ignore */ }
    return null;
  }
}

export type StoredOrderRiskRow = {
  id: string;
  riskLevel: string | null;
  riskFlags: unknown;
  riskReviewed: boolean | null;
};

export type ReviewDeps = {
  findOrders(ref: { paymentIntentId: string | null; chargeId: string | null }): Promise<StoredOrderRiskRow[]>;
  updateRisk(orderId: string, patch: { riskLevel: string; riskFlags: RiskFlag[]; riskReviewed: boolean }): Promise<void>;
};

function refId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/** Applies review.opened / review.closed to every order paid by the review's charge/PaymentIntent. Returns orders updated. */
export async function applyReviewToOrders(
  deps: ReviewDeps,
  event: "opened" | "closed",
  review: ReviewInput & { payment_intent?: unknown; charge?: unknown },
): Promise<number> {
  const paymentIntentId = refId(review.payment_intent);
  const chargeId = refId(review.charge);
  if (!paymentIntentId && !chargeId) return 0;
  const rows = await deps.findOrders({ paymentIntentId, chargeId });
  for (const row of rows) {
    const flags = Array.isArray(row.riskFlags) ? (row.riskFlags as RiskFlag[]) : [];
    const next = applyReviewEvent(
      { level: isRiskLevel(row.riskLevel) ? row.riskLevel : null, flags, reviewed: row.riskReviewed },
      event,
      review,
    );
    await deps.updateRisk(row.id, {
      riskLevel: next.level ?? "normal",
      riskFlags: next.flags,
      riskReviewed: next.reviewed === true,
    });
  }
  return rows.length;
}
