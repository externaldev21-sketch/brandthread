/**
 * B2B (sample / bulk order card) fee math, shared by the API (authoritative:
 * it sets Stripe's application_fee_amount) and the manufacturer portal (the
 * "You receive" line). Integer cents and basis points only — the same rules
 * as artifacts/api-server/src/lib/money/fees.ts, whose
 * destinationApplicationFeeCents() a test keeps this in lock-step with.
 *
 * Who pays Stripe's processing on a B2B card is ONE switch:
 *   "pass_through"     the manufacturer: processing is added to Brandthread's
 *                      application fee and deducted before payout (default).
 *   "platform_absorbs" Brandthread: only the 5% platform fee is taken (the
 *                      behaviour before BT-452).
 *   "seller_surcharge" the seller: a "Card processing" line is added to the
 *                      seller's Checkout total; the manufacturer nets price − 5%.
 */

export type B2bProcessingFeeMode = "pass_through" | "platform_absorbs" | "seller_surcharge";
export const B2B_PROCESSING_FEE_MODE: B2bProcessingFeeMode = "pass_through";

/** Brandthread's B2B commission (5%). */
export const B2B_PLATFORM_FEE_BPS = 500;
/** Stripe US card: 2.9% + 30¢. */
export const B2B_CARD_PROCESSING_BPS = 290;
export const B2B_CARD_PROCESSING_FIXED_CENTS = 30;
/** Stripe ACH Direct Debit: 0.8%, capped at $5. */
export const B2B_ACH_PROCESSING_BPS = 80;
export const B2B_ACH_PROCESSING_CAP_CENTS = 500;
/** Bulk cards at or above this total can also be paid by US bank account (ACH). */
export const ACH_MIN_BULK_CENTS = 100_000;

export type B2bPaymentMethod = "card" | "us_bank_account" | "drop_wallet";

function bps(amountCents: number, rate: number): number {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) return 0;
  // Half-up rounding without floating point.
  return Number((BigInt(amountCents) * BigInt(rate) + 5_000n) / 10_000n);
}

export function b2bProcessingEstimateCents(grossCents: number, method: B2bPaymentMethod): number {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0 || method === "drop_wallet") return 0;
  if (method === "us_bank_account") return Math.min(bps(grossCents, B2B_ACH_PROCESSING_BPS), B2B_ACH_PROCESSING_CAP_CENTS);
  return bps(grossCents, B2B_CARD_PROCESSING_BPS) + B2B_CARD_PROCESSING_FIXED_CENTS;
}

/** True when the seller may choose ACH for this card at Checkout. */
export function achEligible(order: { orderType: string; priceCents: number }): boolean {
  return order.orderType === "bulk" && order.priceCents >= ACH_MIN_BULK_CENTS;
}

export type B2bFeeBreakdown = {
  /** What the seller pays in total (price + any surcharge). */
  chargeCents: number;
  platformFeeCents: number;
  /** Stripe processing estimate that Brandthread recovers (0 when absorbed or wallet-funded). */
  processingFeeEstimateCents: number;
  /** Extra line charged to the seller in "seller_surcharge" mode. */
  sellerSurchargeCents: number;
  /** Stripe application_fee_amount (card/ACH) or what Brandthread keeps (wallet). */
  applicationFeeCents: number;
  /** What the manufacturer receives. */
  manufacturerNetCents: number;
};

/**
 * Fees on one paid B2B card. Fees are capped so the manufacturer's share can
 * never go negative.
 */
export function b2bFees(input: {
  priceCents: number;
  method: B2bPaymentMethod;
  mode?: B2bProcessingFeeMode;
}): B2bFeeBreakdown {
  const price = Number.isSafeInteger(input.priceCents) && input.priceCents > 0 ? input.priceCents : 0;
  const mode = input.mode ?? B2B_PROCESSING_FEE_MODE;
  const platformFee = Math.min(bps(price, B2B_PLATFORM_FEE_BPS), price);
  if (input.method === "drop_wallet" || mode === "platform_absorbs") {
    return {
      chargeCents: price, platformFeeCents: platformFee, processingFeeEstimateCents: 0, sellerSurchargeCents: 0,
      applicationFeeCents: platformFee, manufacturerNetCents: price - platformFee,
    };
  }
  if (mode === "seller_surcharge") {
    // The surcharge itself is charged by Stripe, so it is estimated on the
    // grossed-up total: processing on (price + surcharge).
    let surcharge = b2bProcessingEstimateCents(price, input.method);
    surcharge = b2bProcessingEstimateCents(price + surcharge, input.method);
    return {
      chargeCents: price + surcharge, platformFeeCents: platformFee, processingFeeEstimateCents: surcharge,
      sellerSurchargeCents: surcharge, applicationFeeCents: platformFee + surcharge,
      manufacturerNetCents: price - platformFee,
    };
  }
  const processing = Math.min(b2bProcessingEstimateCents(price, input.method), price - platformFee);
  return {
    chargeCents: price, platformFeeCents: platformFee, processingFeeEstimateCents: processing, sellerSurchargeCents: 0,
    applicationFeeCents: platformFee + processing, manufacturerNetCents: price - platformFee - processing,
  };
}

/**
 * What the manufacturer receives for a card: the persisted net once payment
 * fixed it, otherwise the card estimate (the method the seller is most likely
 * to use; ACH only lowers the fee).
 */
export function manufacturerNetCents(order: {
  priceCents: number;
  status?: string | null;
  platformFeeCents?: number | null;
  walletId?: string | null;
  manufacturerNetCents?: number | null;
  refundedCents?: number | null;
  platformFeeRefundedCents?: number | null;
}): number {
  const paidBeforeFeesWereFixed = order.manufacturerNetCents == null && !!order.status
    && order.status !== "pending_payment" && order.status !== "cancelled";
  const base = order.manufacturerNetCents
    ?? (paidBeforeFeesWereFixed
      // Cards paid before B2B processing pass-through kept only the 5%;
      // wallet transfers before it sent the full price.
      ? (order.walletId ? order.priceCents : order.priceCents - Math.max(0, order.platformFeeCents ?? 0))
      : b2bFees({ priceCents: order.priceCents, method: "card" }).manufacturerNetCents);
  const refunded = Math.max(0, order.refundedCents ?? 0);
  const feeReturned = Math.max(0, order.platformFeeRefundedCents ?? 0);
  return Math.max(0, base - Math.max(0, refunded - feeReturned));
}
