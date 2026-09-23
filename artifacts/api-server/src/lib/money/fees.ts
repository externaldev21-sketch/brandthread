/**
 * Money arithmetic for Brandthread. Every amount is an integer number of
 * cents (see replit.md). Nothing in this file touches floating point: rates
 * are expressed in basis points (1 bp = 0.01%) and every division rounds with
 * an explicit, documented rule.
 *
 * Owner's rule: Brandthread keeps 5% of each sale, and the seller also bears
 * standard Stripe processing. Both are computed here and nowhere else.
 */

/** Brandthread's commission on merchandise, in basis points (500 bp = 5%). */
export const PLATFORM_FEE_BPS = 500;

/**
 * Standard Stripe processing for a US card payment: 2.9% + 30¢. This is only
 * an estimate, used where Stripe needs the fee before the charge exists
 * (application_fee_amount on in-stock destination charges). Held preorder
 * orders always use the exact fee from Stripe's balance transaction.
 */
export const STRIPE_PROCESSING_BPS = 290;
export const STRIPE_PROCESSING_FIXED_CENTS = 30;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Throws unless value is a non-negative safe integer number of cents. */
export function assertCents(value: unknown, label = "amount"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative integer number of cents (got ${String(value)})`);
  }
}

/**
 * amount × bps / 10 000, rounded half-up to the nearest cent, using integer
 * arithmetic only. Half-up is what a person expects from "5% of $10.10"
 * (50.5¢ → 51¢) and matches Stripe's own rounding of percentage fees.
 */
export function bpsOfCents(amountCents: number, bps: number): number {
  assertCents(amountCents, "amountCents");
  if (!Number.isSafeInteger(bps) || bps < 0) throw new MoneyError("bps must be a non-negative integer");
  // BigInt keeps this exact even when amount × bps exceeds 2^53.
  const product = BigInt(amountCents) * BigInt(bps);
  return Number((product + 5_000n) / 10_000n);
}

/** Brandthread's 5% commission on merchandise (after discounts). */
export function platformFeeCents(merchandiseCents: number): number {
  assertCents(merchandiseCents, "merchandiseCents");
  return bpsOfCents(merchandiseCents, PLATFORM_FEE_BPS);
}

/**
 * Estimated Stripe processing fee for a charge of grossCents. Zero-value
 * charges cost nothing (Stripe does not create a charge for them).
 */
export function estimateProcessingFeeCents(grossCents: number): number {
  assertCents(grossCents, "grossCents");
  if (grossCents === 0) return 0;
  return bpsOfCents(grossCents, STRIPE_PROCESSING_BPS) + STRIPE_PROCESSING_FIXED_CENTS;
}

export type OrderSplitInput = {
  /** Sum of line items (price × quantity), before any discount. */
  subtotalCents: number;
  /** Discount actually applied by Stripe (coupon / loyalty). */
  discountCents: number;
  shippingCents: number;
  taxCents: number;
  /** What Stripe charged the buyer. Authoritative when present. */
  grossCents: number;
  /**
   * Stripe's processing fee. Pass the real fee from the balance transaction
   * when known; otherwise the standard estimate is used.
   */
  processingFeeCents?: number | null;
};

export type OrderSplit = {
  grossCents: number;
  merchandiseCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  processingFeeSource: "actual" | "estimate";
  /** What the seller is entitled to: gross − platform fee − processing fee. */
  sellerNetCents: number;
};

/**
 * Splits one paid order into platform fee, processing fee and seller net.
 * The fees are capped so the seller's share can never go negative — a $0.50
 * sale cannot produce a 30¢ + 5% bill larger than the sale itself.
 */
export function splitOrder(input: OrderSplitInput): OrderSplit {
  assertCents(input.subtotalCents, "subtotalCents");
  assertCents(input.discountCents, "discountCents");
  assertCents(input.shippingCents, "shippingCents");
  assertCents(input.taxCents, "taxCents");
  assertCents(input.grossCents, "grossCents");

  const merchandiseCents = Math.max(0, input.subtotalCents - input.discountCents);
  const rawPlatformFee = platformFeeCents(merchandiseCents);
  const hasActualFee = input.processingFeeCents !== undefined && input.processingFeeCents !== null;
  if (hasActualFee) assertCents(input.processingFeeCents, "processingFeeCents");
  const rawProcessingFee = hasActualFee
    ? (input.processingFeeCents as number)
    : estimateProcessingFeeCents(input.grossCents);

  const platformFee = Math.min(rawPlatformFee, input.grossCents);
  const processingFee = Math.min(rawProcessingFee, input.grossCents - platformFee);
  return {
    grossCents: input.grossCents,
    merchandiseCents,
    platformFeeCents: platformFee,
    processingFeeCents: processingFee,
    processingFeeSource: hasActualFee ? "actual" : "estimate",
    sellerNetCents: input.grossCents - platformFee - processingFee,
  };
}

/**
 * application_fee_amount for an in-stock destination charge. Stripe needs it
 * when the Checkout Session is created — before tax is known — so the
 * processing part is estimated on the pre-tax total. The ledger records the
 * difference between this estimate and Stripe's real fee.
 */
export function destinationApplicationFeeCents(input: {
  merchandiseCents: number;
  preTaxTotalCents: number;
}): { platformFeeCents: number; processingFeeEstimateCents: number; applicationFeeCents: number } {
  assertCents(input.merchandiseCents, "merchandiseCents");
  assertCents(input.preTaxTotalCents, "preTaxTotalCents");
  const platformFee = Math.min(platformFeeCents(input.merchandiseCents), input.preTaxTotalCents);
  const processing = Math.min(
    estimateProcessingFeeCents(input.preTaxTotalCents),
    input.preTaxTotalCents - platformFee,
  );
  return {
    platformFeeCents: platformFee,
    processingFeeEstimateCents: processing,
    applicationFeeCents: platformFee + processing,
  };
}

/**
 * Portion of the platform fee returned to the seller when refundCents of an
 * order is refunded. Proportional to the refund against the gross charge,
 * rounded half-up, and never more than what is still unreturned.
 * Stripe does not return its processing fee on refunds, so that part is not
 * returned either (it stays a cost of the sale).
 */
export function platformFeeRefundCents(input: {
  refundCents: number;
  grossCents: number;
  platformFeeCents: number;
  platformFeeAlreadyRefundedCents: number;
}): number {
  assertCents(input.refundCents, "refundCents");
  assertCents(input.grossCents, "grossCents");
  assertCents(input.platformFeeCents, "platformFeeCents");
  assertCents(input.platformFeeAlreadyRefundedCents, "platformFeeAlreadyRefundedCents");
  if (input.grossCents === 0 || input.refundCents === 0) return 0;
  const remaining = Math.max(0, input.platformFeeCents - input.platformFeeAlreadyRefundedCents);
  const proportional = Number(
    (BigInt(input.platformFeeCents) * BigInt(input.refundCents) * 2n + BigInt(input.grossCents))
      / (2n * BigInt(input.grossCents)),
  );
  return Math.min(remaining, proportional);
}

/**
 * Share of a pooled cost (the drop's bulk manufacturing payment) charged to
 * one order at the moment that order's funds are released.
 *
 * "Running pro-rata": the cost not yet charged to any released order is
 * split across the orders still waiting, by their net amount. The last
 * remaining order takes the exact remainder, so across a whole drop the
 * shares always add up to the pooled cost to the cent — no rounding drift.
 * The share is capped at what the order can actually cover.
 */
export function runningProRataShareCents(input: {
  unallocatedCostCents: number;
  orderWeightCents: number;
  remainingWeightCents: number;
  isLastRemainingOrder: boolean;
  capCents: number;
}): number {
  assertCents(input.unallocatedCostCents, "unallocatedCostCents");
  assertCents(input.orderWeightCents, "orderWeightCents");
  assertCents(input.remainingWeightCents, "remainingWeightCents");
  assertCents(input.capCents, "capCents");
  if (input.unallocatedCostCents === 0) return 0;
  let share: number;
  if (input.isLastRemainingOrder || input.remainingWeightCents <= input.orderWeightCents) {
    share = input.unallocatedCostCents;
  } else if (input.remainingWeightCents === 0) {
    share = 0;
  } else {
    share = Number(
      (BigInt(input.unallocatedCostCents) * BigInt(input.orderWeightCents) * 2n + BigInt(input.remainingWeightCents))
        / (2n * BigInt(input.remainingWeightCents)),
    );
  }
  return Math.min(share, input.capCents, input.unallocatedCostCents);
}

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
