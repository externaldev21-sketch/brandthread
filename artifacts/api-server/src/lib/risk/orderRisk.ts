/**
 * Normalises Stripe Radar signals into the seller-facing risk flags shown on
 * an order. Pure: no I/O, so it is unit-testable without Stripe or a database.
 * Risk data is seller-only and must never be returned to buyers.
 */

export type RiskLevel = "normal" | "elevated" | "highest";
export type RiskSeverity = "info" | "medium" | "high";
export type RiskFlag = { code: string; label: string; severity: RiskSeverity };

/** Subset of Stripe's charge.outcome we read. */
export type ChargeOutcomeInput = {
  risk_level?: string | null;
  risk_score?: number | null;
  seller_message?: string | null;
  type?: string | null;
} | null;

/** Subset of payment_method_details.card.checks. Values: pass | fail | unavailable | unchecked. */
export type CardChecksInput = {
  cvc_check?: string | null;
  address_line1_check?: string | null;
  address_postal_code_check?: string | null;
} | null;

export type RiskSignals = {
  outcome?: ChargeOutcomeInput;
  cardChecks?: CardChecksInput;
  billingCountry?: string | null;
  shippingCountry?: string | null;
  totalCents?: number | null;
  /** True when the buyer has no earlier order. Undefined/null = unknown (no flag). */
  isFirstOrder?: boolean | null;
  highValueCents?: number;
};

export type OrderRisk = {
  level: RiskLevel;
  score: number | null;
  flags: RiskFlag[];
};

/** Orders at or above this amount (cents) are "high value". Tunable by Dev. */
export const HIGH_VALUE_THRESHOLD_CENTS = 30_000;

const LEVEL_RANK: Record<RiskLevel, number> = { normal: 0, elevated: 1, highest: 2 };

export function maxRiskLevel(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "normal" || value === "elevated" || value === "highest";
}

function normCountry(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toUpperCase();
  return v.length === 2 ? v : null;
}

export function computeOrderRisk(signals: RiskSignals): OrderRisk {
  const flags: RiskFlag[] = [];
  const outcome = signals.outcome ?? null;
  const checks = signals.cardChecks ?? null;

  let level: RiskLevel = "normal";
  if (outcome?.risk_level === "highest") {
    level = "highest";
    flags.push({ code: "radar_highest", label: "Stripe rated this payment highest risk", severity: "high" });
  } else if (outcome?.risk_level === "elevated") {
    level = "elevated";
    flags.push({ code: "radar_elevated", label: "Stripe rated this payment elevated risk", severity: "medium" });
  }
  if (outcome?.type === "manual_review") {
    flags.push({ code: "radar_manual_review", label: "Stripe sent this payment to review", severity: "medium" });
  } else if (outcome?.type === "blocked") {
    flags.push({ code: "radar_blocked", label: "Stripe flagged this payment as blocked", severity: "high" });
  }

  if (checks?.cvc_check === "fail") {
    flags.push({ code: "cvc_failed", label: "Card security code did not match", severity: "medium" });
  }
  if (checks?.address_line1_check === "fail") {
    flags.push({ code: "address_line1_failed", label: "Billing street address did not match the card", severity: "medium" });
  }
  if (checks?.address_postal_code_check === "fail") {
    flags.push({ code: "postal_code_failed", label: "Billing postal code did not match the card", severity: "medium" });
  }

  const billing = normCountry(signals.billingCountry);
  const shipping = normCountry(signals.shippingCountry);
  if (billing && shipping && billing !== shipping) {
    flags.push({ code: "country_mismatch", label: `Billing country (${billing}) differs from shipping country (${shipping})`, severity: "medium" });
  }

  const threshold = signals.highValueCents ?? HIGH_VALUE_THRESHOLD_CENTS;
  const highValue = typeof signals.totalCents === "number" && signals.totalCents >= threshold;
  if (highValue) {
    flags.push({ code: "high_value", label: "High-value order", severity: "info" });
  }
  const firstOrder = signals.isFirstOrder === true;
  if (firstOrder) {
    flags.push({ code: "first_time_buyer", label: "First order from this buyer", severity: "info" });
  }

  // Derived level: any medium/high flag elevates; info-only flags elevate
  // only together (a high-value first order).
  if (flags.some((f) => f.severity === "high" || f.severity === "medium")) level = maxRiskLevel(level, "elevated");
  if (highValue && firstOrder) level = maxRiskLevel(level, "elevated");

  const score = typeof outcome?.risk_score === "number" && Number.isFinite(outcome.risk_score)
    ? Math.round(outcome.risk_score)
    : null;
  return { level, score, flags };
}

/** Stripe review.opened / review.closed payload subset. */
export type ReviewInput = { open?: boolean | null; reason?: string | null };

export type StoredRisk = {
  level: RiskLevel | null;
  flags: RiskFlag[];
  reviewed: boolean | null;
};

const REVIEW_OPEN = "stripe_review_open";

/** Applies a Stripe review event to an order's stored risk. Pure. */
export function applyReviewEvent(current: StoredRisk, event: "opened" | "closed", review: ReviewInput): StoredRisk {
  const flags = current.flags.filter((f) => f.code !== REVIEW_OPEN);
  if (event === "opened") {
    flags.push({ code: REVIEW_OPEN, label: "Stripe has this payment under review", severity: "medium" });
    return { level: maxRiskLevel(current.level ?? "normal", "elevated"), flags, reviewed: false };
  }
  if (review.reason === "refunded_as_fraud" && !flags.some((f) => f.code === "review_refunded_as_fraud")) {
    flags.push({ code: "review_refunded_as_fraud", label: "Payment was refunded as fraud after review", severity: "high" });
    return { level: "highest", flags, reviewed: true };
  }
  return { level: current.level, flags, reviewed: true };
}

/** Seller-facing API shape. */
export type OrderRiskView = { level: RiskLevel; score: number | null; flags: RiskFlag[]; reviewed: boolean };

const RISK_KEYS = ["riskLevel", "riskScore", "riskFlags", "riskReviewed"] as const;

export function buildRiskView(row: {
  riskLevel?: string | null;
  riskScore?: number | null;
  riskFlags?: unknown;
  riskReviewed?: boolean | null;
}): OrderRiskView | null {
  if (!isRiskLevel(row.riskLevel)) return null;
  const flags = Array.isArray(row.riskFlags)
    ? (row.riskFlags as unknown[]).filter((f): f is RiskFlag =>
      !!f && typeof (f as RiskFlag).code === "string" && typeof (f as RiskFlag).label === "string")
    : [];
  return { level: row.riskLevel, score: row.riskScore ?? null, flags, reviewed: row.riskReviewed === true };
}

/** Replaces the raw risk columns on an order row with one `risk` object (seller responses only). */
export function withRiskView<T extends Record<string, any>>(row: T): Omit<T, (typeof RISK_KEYS)[number]> & { risk: OrderRiskView | null } {
  const rest: Record<string, any> = { ...row };
  for (const key of RISK_KEYS) delete rest[key];
  return { ...(rest as Omit<T, (typeof RISK_KEYS)[number]>), risk: buildRiskView(row) };
}
