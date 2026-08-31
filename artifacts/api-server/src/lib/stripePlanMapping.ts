import type { SellerPlanId } from "./planCatalogue";

/**
 * Translate Stripe Price lookup keys without reinterpreting historical prices.
 *
 * brandthread_pro_monthly belonged to the retired $79 tier and must continue
 * to resolve to Growth. The renamed $199 tier uses a distinct Stripe-only key,
 * while native stores use brandthread_pro_monthly through RevenueCat.
 */
export function sellerPlanFromStripeLookupKey(lookupKey: unknown): SellerPlanId | undefined {
  if (lookupKey === "brandthread_starter_monthly") return "starter";
  if (lookupKey === "brandthread_growth_monthly") return "growth";
  if (lookupKey === "brandthread_pro_monthly") return "growth";
  if (lookupKey === "brandthread_scale_monthly") return "pro";
  if (lookupKey === "brandthread_pro_199_monthly") return "pro";
  return undefined;
}