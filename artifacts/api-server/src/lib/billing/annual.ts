/**
 * Annual billing for seller plans — item 116: "2 months free".
 *
 * Yearly price = 10 × the monthly price (12 months for the price of 10):
 *   starter $290/yr · growth $790/yr · pro $1,990/yr
 * Stripe Prices are found or created by lookup key (brandthread_<plan>_annual)
 * exactly like the monthly ones, with recurring.interval "year". Native
 * stores (App Store / Google Play via RevenueCat) need products with the same
 * identifiers — see lib/nativeEntitlements.ts.
 */
import { PLAN_CATALOGUE, type SellerPlanId } from "../planCatalogue";

export type BillingInterval = "month" | "year";

/** Months charged for a year: 12 − 2 free. */
export const ANNUAL_MONTHS_CHARGED = 10;

/**
 * Validate POST /checkout's `interval`. Missing → "month" (the existing
 * behaviour); anything other than "month" / "year" → null (400).
 */
export function parseBillingInterval(value: unknown): BillingInterval | null {
  if (value === undefined || value === null || value === "") return "month";
  return value === "month" || value === "year" ? value : null;
}

export function annualLookupKey(planId: SellerPlanId): string {
  return `brandthread_${planId}_annual`;
}

export function planAmountCents(planId: SellerPlanId, interval: BillingInterval): number {
  const monthly = PLAN_CATALOGUE[planId].amountCents;
  return interval === "year" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
}

/** The Stripe Price a plan + interval resolves to. */
export function priceSpecFor(planId: SellerPlanId, interval: BillingInterval): {
  lookupKey: string;
  amountCents: number;
  interval: BillingInterval;
  name: string;
} {
  const cfg = PLAN_CATALOGUE[planId];
  return interval === "year"
    ? { lookupKey: annualLookupKey(planId), amountCents: planAmountCents(planId, "year"), interval, name: `${cfg.name} (yearly)` }
    : { lookupKey: cfg.lookupKey, amountCents: cfg.amountCents, interval, name: cfg.name };
}

/** Billing interval of a Stripe subscription (first item); month when unknown. */
export function intervalFromSubscription(sub: any): BillingInterval {
  const item = sub?.items?.data?.[0];
  const interval = item?.price?.recurring?.interval ?? item?.plan?.interval;
  return interval === "year" ? "year" : "month";
}
