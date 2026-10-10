/**
 * Shipping for a seller with no shipping zones. A configured flat rate is
 * used as before (a $0 rate is how a seller offers free shipping). With no
 * rate at all, checkout used to charge $0 and the seller paid the label out
 * of their own balance; now it charges a standard rate instead.
 *
 * DEFAULT_SHIPPING_CENTS overrides the standard rate (default $5.99,
 * roughly a 1 lb USPS Ground Advantage label). Setting it to 0 restores the
 * old free-by-default behaviour.
 */
export const STANDARD_SHIPPING_CENTS = 599;
export const STANDARD_SHIPPING_NAME = "Standard shipping";

export function defaultShippingCents(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DEFAULT_SHIPPING_CENTS?.trim();
  if (!raw) return STANDARD_SHIPPING_CENTS;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 && n <= 10_000 ? n : STANDARD_SHIPPING_CENTS;
}

export type FlatRate = { flatRateCents: number; freeAboveCents: number | null; name: string | null } | null | undefined;

export function flatRateShipping(rate: FlatRate, subtotalCents: number, env?: Record<string, string | undefined>): { cents: number; name: string } {
  if (!rate) return { cents: defaultShippingCents(env), name: STANDARD_SHIPPING_NAME };
  const free = rate.freeAboveCents != null && subtotalCents >= rate.freeAboveCents;
  return { cents: free ? 0 : rate.flatRateCents, name: rate.name ?? "Shipping" };
}
