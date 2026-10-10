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

export const PLAN_IDS = Object.keys(PLAN_CATALOGUE) as SellerPlanId[];

// ─── Tier differences besides price and the product cap ──────────────────
// Dev's plan tiers. Read by the plan gates (lib/planFeatures.ts →
// middlewares/featureGate.ts), the email allowance and the app
// (GET /api/config/plan-features), so changing a value here changes the
// gate, the upgrade prompt and the plan screen together. Staff seats live in
// `limits.teamSeats` above; AI credits in aiCredits/catalogue.

export type AnalyticsLevel = "basic" | "advanced" | "full";

export type TierFeatures = {
  /** basic: sales, products, audience. advanced: + conversion, cohorts, top customers. full: + export. */
  analytics: AnalyticsLevel;
  /** Hosting a live (watching is open to everyone). */
  liveSelling: boolean;
  /** Drops and pre-orders with escrow. */
  drops: boolean;
  /** Buying Boosts and Featured slots. */
  boosts: boolean;
  customDomain: boolean;
  /** RFQs and bulk orders. Samples are on every plan. */
  manufacturerHub: boolean;
  /** Marketing emails a month; 0 = not included, null = unlimited. */
  emailSendsPerMonth: number | null;
  /** "faster" where Stripe allows (shown on the plan screen; payouts are set per Connect account). */
  payoutSpeed: "standard" | "faster";
  prioritySupport: boolean;
};

/** EMAIL_MONTHLY_CAP_<PLAN>=25000 or =unlimited overrides a cap without a code change. */
function envCap(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (raw.toLowerCase() === "unlimited") return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : fallback;
}

export function planTierFeatures(): Record<SellerPlanId, TierFeatures> {
  return {
    starter: {
      analytics: "basic", liveSelling: false, drops: false, boosts: false, customDomain: false,
      manufacturerHub: false, emailSendsPerMonth: envCap("EMAIL_MONTHLY_CAP_STARTER", 0),
      payoutSpeed: "standard", prioritySupport: false,
    },
    growth: {
      analytics: "advanced", liveSelling: true, drops: true, boosts: true, customDomain: true,
      manufacturerHub: true, emailSendsPerMonth: envCap("EMAIL_MONTHLY_CAP_GROWTH", 10_000),
      payoutSpeed: "standard", prioritySupport: false,
    },
    pro: {
      analytics: "full", liveSelling: true, drops: true, boosts: true, customDomain: true,
      manufacturerHub: true, emailSendsPerMonth: envCap("EMAIL_MONTHLY_CAP_PRO", 50_000),
      payoutSpeed: "faster", prioritySupport: true,
    },
  };
}

export function isSellerPlanId(value: unknown): value is SellerPlanId {
  return typeof value === "string" && value in PLAN_CATALOGUE;
}
