export type SellerPlanId = "starter" | "growth" | "pro";

export type SellerPlanLimits = {
  products: number | null;
  teamSeats: number | null;
};

export const PLAN_CATALOGUE: Record<SellerPlanId, {
  rank: number;
  amountCents: number;
  name: string;
  lookupKey: string;
  limits: SellerPlanLimits;
}> = {
  starter: {
    rank: 0,
    amountCents: 2900,
    name: "Brandthread Starter Plan",
    lookupKey: "brandthread_starter_monthly",
    limits: { products: 25, teamSeats: 0 },
  },
  growth: {
    rank: 1,
    amountCents: 7900,
    name: "Brandthread Growth Plan",
    lookupKey: "brandthread_growth_monthly",
    limits: { products: null, teamSeats: 3 },
  },
  pro: {
    rank: 2,
    amountCents: 19900,
    name: "Brandthread Pro Plan",
    // Stripe previously used brandthread_pro_monthly for the retired $79 tier.
    // Keep the new $199 web price distinct; native stores use the requested
    // brandthread_pro_monthly identifier through RevenueCat.
    lookupKey: "brandthread_pro_199_monthly",
    limits: { products: null, teamSeats: null },
  },
};

/**
 * Limits for a seller with no paid access (BT-002): never subscribed,
 * cancelled, or past_due beyond PAST_DUE_GRACE_DAYS. Paid plans use their own
 * `limits` above. Only the first `products` live listings can be sold.
 */
export const FREE_TIER_LIMITS: SellerPlanLimits = { products: 5, teamSeats: 0 };

/** Days a past_due Stripe subscription keeps its plan before the free limits apply. */
export const PAST_DUE_GRACE_DAYS = 7;

export const PLAN_IDS = Object.keys(PLAN_CATALOGUE) as SellerPlanId[];

export function isSellerPlanId(value: unknown): value is SellerPlanId {
  return typeof value === "string" && value in PLAN_CATALOGUE;
}
