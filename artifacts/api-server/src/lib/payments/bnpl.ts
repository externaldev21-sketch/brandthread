/**
 * Buy now, pay later (Klarna, Afterpay / Clearpay) via Stripe payment methods.
 * Pure functions: no Stripe, no DB, no throwing.
 *
 * A cart offers BNPL only when ALL of these hold:
 *  - the platform switch STRIPE_BNPL_ENABLED is on (OFF by default);
 *  - every seller in the cart opted in (seller_payment_settings.bnpl_enabled);
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

export function eligibleBnplMethods(input: {
  platformEnabled: boolean;
  /** One entry per seller in the cart; an empty cart is never eligible. */
  sellerOptIns: boolean[];
  currency: string;
  amountCents: number;
  shipToCountry: string;
}): BnplMethod[] {
  if (!input.platformEnabled) return [];
  if (input.sellerOptIns.length === 0 || !input.sellerOptIns.every((optedIn) => optedIn === true)) return [];
  if (!Number.isInteger(input.amountCents)) return [];
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
