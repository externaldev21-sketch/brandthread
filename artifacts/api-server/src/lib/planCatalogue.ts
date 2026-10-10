/**
 * THE seller plan config: prices, the active-product cap (the main
 * difference between tiers), staff seats, every other tier gate and the
 * trial. Routes, jobs and the app (GET /api/config/seller-plans) all read
 * this file, so Dev changes a number in one place.
 *
 * Every number can also be set without a code change through env vars:
 *  - SELLER_PLAN_<ID>_CENTS      monthly price in cents (Stripe; App Store /
 *                                Play prices are set in the store consoles)
 *  - SELLER_PLAN_<ID>_PRODUCTS   active-product cap, an integer or "unlimited"
 *  - SELLER_TRIAL_DAYS, SELLER_TRIAL_REMINDER_DAYS_BEFORE, SELLER_CHECKOUT_MODE
 * where <ID> is STARTER, GROWTH or PRO.
 */
export type SellerPlanId = "starter" | "growth" | "pro";

export type SellerPlanLimits = {
  /** Active (published) products. Drafts, archived and deleted ones don't count; variants count as one product. null = unlimited. */
  products: number | null;
  /** Staff seats (team members besides the owner). null = unlimited. */
  teamSeats: number | null;
};

/** Tier gates other than the product cap (enforced where each feature lives). */
export type SellerPlanFeatures = {
  analytics: "basic" | "advanced" | "full";
  analyticsExport: boolean;
  liveSelling: boolean;
  /** Drops and pre-orders paid into escrow. */
  dropsEscrow: boolean;
  /** Marketing emails per month (0 = not included). */
  emailSendsMonthly: number;
  /** Can buy Boost / Featured slots. */
  boostFeatured: boolean;
  customDomain: boolean;
  /** Manufacturer Hub RFQs and bulk orders. Samples are on every plan. */
  manufacturerHub: boolean;
  /** "faster" where Stripe allows (e.g. daily payouts / Instant Payouts). */
  payoutSpeed: "standard" | "faster";
  prioritySupport: boolean;
};

export type SellerPlan = {
  rank: number;
  amountCents: number;
  name: string;
  /** Short name shown in the app. */
  label: string;
  lookupKey: string;
  limits: SellerPlanLimits;
  features: SellerPlanFeatures;
};

function envCents(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function envCap(name: string, fallback: number | null): number | null {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "unlimited") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export const PLAN_CATALOGUE: Record<SellerPlanId, SellerPlan> = {
  starter: {
    rank: 0,
    amountCents: envCents("SELLER_PLAN_STARTER_CENTS", 1999),
    name: "Brandthread Starter Plan",
    label: "Starter",
    lookupKey: "brandthread_starter_monthly",
    limits: { products: envCap("SELLER_PLAN_STARTER_PRODUCTS", 10), teamSeats: 1 },
    features: {
      analytics: "basic",
      analyticsExport: false,
      liveSelling: false,
      dropsEscrow: false,
      emailSendsMonthly: 0,
      boostFeatured: false,
      customDomain: false,
      manufacturerHub: false,
      payoutSpeed: "standard",
      prioritySupport: false,
    },
  },
  growth: {
    rank: 1,
    amountCents: envCents("SELLER_PLAN_GROWTH_CENTS", 4900),
    name: "Brandthread Growth Plan",
    label: "Growth",
    lookupKey: "brandthread_growth_monthly",
    limits: { products: envCap("SELLER_PLAN_GROWTH_PRODUCTS", 50), teamSeats: 3 },
    features: {
      analytics: "advanced",
      analyticsExport: false,
      liveSelling: true,
      dropsEscrow: true,
      emailSendsMonthly: 2500,
      boostFeatured: true,
      customDomain: true,
      manufacturerHub: true,
      payoutSpeed: "standard",
      prioritySupport: false,
    },
  },
  pro: {
    rank: 2,
    amountCents: envCents("SELLER_PLAN_PRO_CENTS", 12900),
    name: "Brandthread Pro Plan",
    label: "Pro",
    // Stripe previously used brandthread_pro_monthly for the retired $79 tier.
    // routes/subscription.ts ensurePrice() moves this key to a new Stripe
    // price whenever amountCents changes; native stores use the
    // brandthread_pro_monthly identifier through RevenueCat.
    lookupKey: "brandthread_pro_199_monthly",
    limits: { products: envCap("SELLER_PLAN_PRO_PRODUCTS", null), teamSeats: null },
    features: {
      analytics: "full",
      analyticsExport: true,
      liveSelling: true,
      dropsEscrow: true,
      emailSendsMonthly: 10000,
      boostFeatured: true,
      customDomain: true,
      manufacturerHub: true,
      payoutSpeed: "faster",
      prioritySupport: true,
    },
  },
};

export const PLAN_IDS = Object.keys(PLAN_CATALOGUE) as SellerPlanId[];

export function isSellerPlanId(value: unknown): value is SellerPlanId {
  return typeof value === "string" && value in PLAN_CATALOGUE;
}

/**
 * A seller without a live trial or paid plan (never subscribed, cancelled
 * after access ended, expired, or past_due beyond PAST_DUE_GRACE_DAYS) can't
 * publish or sell: "pick a plan to keep selling". Their products and data
 * are kept (lib/planProductSync.ts moves live listings to drafts).
 */
export const NO_PLAN_LIMITS: SellerPlanLimits = { products: 0, teamSeats: 0 };

/** Days a past_due Stripe subscription keeps its plan before NO_PLAN_LIMITS apply. */
export const PAST_DUE_GRACE_DAYS = 7;

/** A tier gate's value for a plan. */
export function planFeature<K extends keyof SellerPlanFeatures>(planId: SellerPlanId, key: K): SellerPlanFeatures[K] {
  return PLAN_CATALOGUE[planId].features[key];
}

/** True when a boolean tier gate is on for the plan. */
export function planAllows(planId: SellerPlanId, key: { [K in keyof SellerPlanFeatures]: SellerPlanFeatures[K] extends boolean ? K : never }[keyof SellerPlanFeatures]): boolean {
  return PLAN_CATALOGUE[planId].features[key] === true;
}

/** The cheapest plan whose product cap is above `count` (null when none is). */
export function planForProductCount(count: number): SellerPlanId | null {
  return PLAN_IDS.find((id) => {
    const cap = PLAN_CATALOGUE[id].limits.products;
    return cap === null || cap > count;
  }) ?? null;
}

// ─── Trial and checkout ─────────────────────────────────────────────────────
// Read by Stripe Checkout (routes/subscription.ts), the trial reminder job
// (jobs/sellerTrialReminder.ts) and the app (GET /api/config/seller-plans),
// so the plan screen's copy always matches what actually happens.

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

/** Free days before the first charge. Card is collected up front. */
export const TRIAL_DAYS = envInt("SELLER_TRIAL_DAYS", 7, 1, 30);
/** The reminder (push + email) goes out this many days before the charge. */
export const TRIAL_REMINDER_DAYS_BEFORE = Math.min(envInt("SELLER_TRIAL_REMINDER_DAYS_BEFORE", 2, 1, 7), TRIAL_DAYS - 1);

/**
 * How the app takes payment for a plan:
 *  - "auto"   (default, what is wired today): Apple / Google in-app purchase
 *             through RevenueCat on iOS and Android, Stripe Checkout on web.
 *  - "native": same as auto (kept explicit for clarity).
 *  - "web":    Stripe Checkout everywhere, including inside the iOS app.
 *              Check App Store guideline 3.1.1 / the US storefront rules
 *              before turning this on for iOS.
 */
export type SellerCheckoutMode = "auto" | "native" | "web";
export const SELLER_CHECKOUT_MODE: SellerCheckoutMode = (() => {
  const value = process.env.SELLER_CHECKOUT_MODE;
  return value === "web" || value === "native" ? value : "auto";
})();
