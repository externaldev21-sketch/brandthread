export type SellerPlanId = "starter" | "growth" | "pro";

export type SellerPlanLimits = {
  products: number | null;
  teamSeats: number | null;
};

/**
 * Prices can be set without a code change: SELLER_PLAN_<ID>_CENTS (e.g.
 * SELLER_PLAN_GROWTH_CENTS=6900). Stripe prices are created from these
 * amounts by routes/subscription.ts ensurePrice(); App Store / Play prices
 * are set in App Store Connect / Play Console and read through RevenueCat.
 */
function envCents(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const PLAN_CATALOGUE: Record<SellerPlanId, {
  rank: number;
  amountCents: number;
  name: string;
  lookupKey: string;
  limits: SellerPlanLimits;
}> = {
  starter: {
    rank: 0,
    amountCents: envCents("SELLER_PLAN_STARTER_CENTS", 2900),
    name: "Brandthread Starter Plan",
    lookupKey: "brandthread_starter_monthly",
    limits: { products: 25, teamSeats: 0 },
  },
  growth: {
    rank: 1,
    amountCents: envCents("SELLER_PLAN_GROWTH_CENTS", 7900),
    name: "Brandthread Growth Plan",
    lookupKey: "brandthread_growth_monthly",
    limits: { products: null, teamSeats: 3 },
  },
  pro: {
    rank: 2,
    amountCents: envCents("SELLER_PLAN_PRO_CENTS", 19900),
    name: "Brandthread Pro Plan",
    // Stripe previously used brandthread_pro_monthly for the retired $79 tier.
    // Keep the new $199 web price distinct; native stores use the requested
    // brandthread_pro_monthly identifier through RevenueCat.
    lookupKey: "brandthread_pro_199_monthly",
    limits: { products: null, teamSeats: null },
  },
};

export const PLAN_IDS = Object.keys(PLAN_CATALOGUE) as SellerPlanId[];

export function isSellerPlanId(value: unknown): value is SellerPlanId {
  return typeof value === "string" && value in PLAN_CATALOGUE;
}

// ─── Trial and checkout: the one shared plan config ───────────────────────
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

export interface PublicSellerPlanConfig {
  trialDays: number;
  reminderDaysBefore: number;
  checkoutMode: SellerCheckoutMode;
  currency: "usd";
  plans: {
    id: SellerPlanId;
    /** Short display name ("Growth"). */
    name: string;
    amountCents: number;
    interval: "month";
    /** The plan card's headline. null = unlimited. More limits are added here as the config grows. */
    limits: { activeProducts: number | null };
  }[];
}

export function publicSellerPlanConfig(): PublicSellerPlanConfig {
  return {
    trialDays: TRIAL_DAYS,
    reminderDaysBefore: TRIAL_REMINDER_DAYS_BEFORE,
    checkoutMode: SELLER_CHECKOUT_MODE,
    currency: "usd",
    plans: PLAN_IDS.map((id) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      amountCents: PLAN_CATALOGUE[id].amountCents,
      interval: "month" as const,
      limits: { activeProducts: PLAN_CATALOGUE[id].limits.products },
    })),
  };
}
