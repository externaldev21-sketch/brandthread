/**
 * Buy now, pay later (Klarna, Afterpay / Clearpay) via Stripe payment methods.
 * Pure functions: no Stripe, no DB, no throwing.
 *
 * A cart offers BNPL only when ALL of these hold:
 *  - the platform switch STRIPE_BNPL_ENABLED is on (OFF by default);
 *  - every seller in the cart opted in (seller_payment_settings.bnpl_enabled);
 *  - the order total is at least the platform minimum (BNPL_MIN_ORDER_CENTS,
 *    default 7500 = $75);
 *  - currency, amount and ship-to country are inside each method's limits.
 *
 * Stripe rule: a PaymentIntent with top-level `setup_future_usage` can't offer
 * Klarna / Afterpay. When BNPL is offered, saving the card is asked for on the
 * card method only (payment_method_options.card.setup_future_usage).
 */

export type BnplMethod = "klarna" | "afterpay_clearpay";

/** Limits for USD / US orders, from Stripe's payment method docs. Amounts in cents. */
const LIMITS: Record<BnplMethod, { currency: string; countries: string[]; minCents: number; maxCents: number }> = {
  klarna: { currency: "usd", countries: ["US"], minCents: 100, maxCents: 1_000_000 },
  afterpay_clearpay: { currency: "usd", countries: ["US"], minCents: 100, maxCents: 400_000 },
};

/** Platform switch: only an explicit "true"/"1" turns it on; anything else (unset, junk) is off. */
export function bnplPlatformEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = (env.STRIPE_BNPL_ENABLED ?? "").trim().toLowerCase();
  return value === "true" || value === "1";
}

/** Platform minimum order total for BNPL, in cents. */
export const DEFAULT_BNPL_MIN_ORDER_CENTS = 7_500;

/** BNPL_MIN_ORDER_CENTS when it is a non-negative integer; the $75 default otherwise. */
export function bnplMinOrderCents(env: Record<string, string | undefined> = process.env): number {
  const raw = (env.BNPL_MIN_ORDER_CENTS ?? "").trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_BNPL_MIN_ORDER_CENTS;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : DEFAULT_BNPL_MIN_ORDER_CENTS;
}

/**
 * Four interest-free payments that sum exactly to the total. The first payment
 * absorbs the rounding remainder: 9_501 -> [2_376, 2_375, 2_375, 2_375].
 */
export function bnplInstallment(totalCents: number): [number, number, number, number] {
  const total = Number.isFinite(totalCents) ? Math.max(0, Math.round(totalCents)) : 0;
  const each = Math.floor(total / 4);
  return [total - each * 3, each, each, each];
}

export function eligibleBnplMethods(input: {
  platformEnabled: boolean;
  /** One entry per seller in the cart; an empty cart is never eligible. */
  sellerOptIns: boolean[];
  currency: string;
  amountCents: number;
  shipToCountry: string;
  /** Defaults to bnplMinOrderCents() (env BNPL_MIN_ORDER_CENTS, else $75). */
  minOrderCents?: number;
}): BnplMethod[] {
  if (!input.platformEnabled) return [];
  if (input.sellerOptIns.length === 0 || !input.sellerOptIns.every((optedIn) => optedIn === true)) return [];
  if (!Number.isInteger(input.amountCents)) return [];
  if (input.amountCents < (input.minOrderCents ?? bnplMinOrderCents())) return [];
  const currency = input.currency.toLowerCase();
  const country = input.shipToCountry.toUpperCase();
  return (Object.keys(LIMITS) as BnplMethod[]).filter((method) => {
    const limit = LIMITS[method];
    return currency === limit.currency
      && limit.countries.includes(country)
      && input.amountCents >= limit.minCents
      && input.amountCents <= limit.maxCents;
  });
}

export function paymentMethodTypesFor(methods: BnplMethod[]): string[] {
  return ["card", ...methods];
}

/** The PaymentIntent params that depend on which methods are offered. */
export function paymentIntentMethodParams(methods: BnplMethod[], saveCard: boolean) {
  const types = paymentMethodTypesFor(methods);
  if (!saveCard) return { payment_method_types: types };
  if (methods.length === 0) {
    return { payment_method_types: types, setup_future_usage: "off_session" as const };
  }
  return {
    payment_method_types: types,
    payment_method_options: { card: { setup_future_usage: "off_session" as const } },
  };
}
