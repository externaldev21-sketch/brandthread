/**
 * Read-only view of the fee schedule for the seller-facing "fees" surfaces.
 * Everything here is derived from ./fees.ts — there are no fee numbers in this
 * file, so changing PLATFORM_FEE_BPS / STRIPE_PROCESSING_* there changes what
 * the API reports.
 */
import {
  PLATFORM_FEE_BPS,
  STRIPE_PROCESSING_BPS,
  STRIPE_PROCESSING_FIXED_CENTS,
  MoneyError,
  splitOrder,
} from "./fees";

export type FeeQuote = {
  priceCents: number;
  quantity: number;
  shippingCents: number;
  grossCents: number;
  merchandiseCents: number;
  platformFeeCents: number;
  processingFeeCents: number;
  sellerNetCents: number;
};

/** Largest sale the quote accepts ($1,000,000.00), keeps every product exact. */
export const MAX_QUOTE_CENTS = 100_000_000;

function intField(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new MoneyError(`${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

/**
 * What a seller receives for one sale: platform fee and estimated processing
 * both on the whole charge (merchandise + shipping), via splitOrder.
 */
export function quoteSale(input: { priceCents: unknown; quantity?: unknown; shippingCents?: unknown }): FeeQuote {
  const priceCents = intField(input.priceCents, "priceCents", 0, MAX_QUOTE_CENTS);
  const quantity = input.quantity === undefined ? 1 : intField(input.quantity, "quantity", 1, 1000);
  const shippingCents = input.shippingCents === undefined ? 0 : intField(input.shippingCents, "shippingCents", 0, MAX_QUOTE_CENTS);
  const subtotalCents = priceCents * quantity;
  if (subtotalCents > MAX_QUOTE_CENTS) throw new MoneyError(`price x quantity must not exceed ${MAX_QUOTE_CENTS} cents`);
  const split = splitOrder({
    subtotalCents,
    discountCents: 0,
    shippingCents,
    taxCents: 0,
    grossCents: subtotalCents + shippingCents,
  });
  return {
    priceCents,
    quantity,
    shippingCents,
    grossCents: split.grossCents,
    merchandiseCents: split.merchandiseCents,
    platformFeeCents: split.platformFeeCents,
    processingFeeCents: split.processingFeeCents,
    sellerNetCents: split.sellerNetCents,
  };
}

/** The example sale shown next to the schedule. */
export const FEE_EXAMPLE_PRICE_CENTS = 10_000;

export function getFeeSchedule() {
  return {
    platformFeeBps: PLATFORM_FEE_BPS,
    processing: { bps: STRIPE_PROCESSING_BPS, fixedCents: STRIPE_PROCESSING_FIXED_CENTS },
    example: quoteSale({ priceCents: FEE_EXAMPLE_PRICE_CENTS }),
  };
}
