/**
 * Optional web-only yearly seller prices (Stripe Checkout only, never the
 * App Store / Google Play). Off until Dev sets a Stripe Price ID:
 *
 *   STRIPE_PRICE_STARTER_ANNUAL_WEB=price_...
 *   STRIPE_PRICE_GROWTH_ANNUAL_WEB=price_...
 *   STRIPE_PRICE_PRO_ANNUAL_WEB=price_...
 *
 * No yearly amount is defined in code: the amount shown on /pricing and the
 * amount charged are both the Stripe Price's own unit_amount. A configured
 * price is only offered when it is active, USD, billed every 1 year and its
 * lookup key is unset or `brandthread_<plan>_annual_web`, so the subscription
 * webhook can map it back to the plan (lib/stripePlanMapping.ts).
 */
import { PLAN_IDS, type SellerPlanId } from "./planCatalogue";

export const WEB_ANNUAL_LOOKUP_KEYS: Record<SellerPlanId, string> = {
  starter: "brandthread_starter_annual_web",
  growth: "brandthread_growth_annual_web",
  pro: "brandthread_pro_annual_web",
};

export function webAnnualEnvName(planId: SellerPlanId): string {
  return `STRIPE_PRICE_${planId.toUpperCase()}_ANNUAL_WEB`;
}

/** The configured Stripe Price ID for a plan, or null when unset/malformed. */
export function webAnnualPriceIdFor(planId: SellerPlanId, env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[webAnnualEnvName(planId)]?.trim();
  return value && /^price_[A-Za-z0-9_]+$/.test(value) ? value : null;
}

export function hasAnyWebAnnualPrice(env: NodeJS.ProcessEnv = process.env): boolean {
  return PLAN_IDS.some((planId) => webAnnualPriceIdFor(planId, env) !== null);
}

type StripePriceLike = {
  id?: string;
  active?: boolean;
  currency?: string;
  unit_amount?: number | null;
  lookup_key?: string | null;
  recurring?: { interval?: string; interval_count?: number } | null;
};

/** Whether a retrieved Stripe Price may be sold as this plan's yearly web price. */
export function isUsableWebAnnualPrice(price: StripePriceLike | null | undefined, planId: SellerPlanId): boolean {
  if (!price || price.active !== true || price.currency !== "usd") return false;
  if (!Number.isSafeInteger(price.unit_amount) || (price.unit_amount as number) <= 0) return false;
  if (price.recurring?.interval !== "year" || (price.recurring.interval_count ?? 1) !== 1) return false;
  return price.lookup_key == null || price.lookup_key === WEB_ANNUAL_LOOKUP_KEYS[planId];
}

export type WebAnnualOffer = { planId: SellerPlanId; amountCents: number };

type StripePricesClient = {
  prices: {
    retrieve: (id: string) => Promise<StripePriceLike>;
    update: (id: string, params: Record<string, unknown>) => Promise<StripePriceLike>;
  };
};

const CACHE_MS = 10 * 60 * 1000;
let cache: { at: number; offers: WebAnnualOffer[] } | null = null;

export function resetWebAnnualCache(): void {
  cache = null;
}

/**
 * The yearly web prices that can be sold right now, for the public /pricing
 * page. Cached for 10 minutes; a Stripe error hides the offer, never throws.
 */
export async function listWebAnnualOffers(
  stripe: StripePricesClient,
  { env = process.env, now = Date.now() }: { env?: NodeJS.ProcessEnv; now?: number } = {},
): Promise<WebAnnualOffer[]> {
  if (cache && now - cache.at < CACHE_MS) return cache.offers;
  const offers: WebAnnualOffer[] = [];
  for (const planId of PLAN_IDS) {
    const priceId = webAnnualPriceIdFor(planId, env);
    if (!priceId) continue;
    try {
      const price = await stripe.prices.retrieve(priceId);
      if (isUsableWebAnnualPrice(price, planId)) offers.push({ planId, amountCents: price.unit_amount as number });
    } catch {
      // Misconfigured or deleted price: don't offer it.
    }
  }
  cache = { at: now, offers };
  return offers;
}

/**
 * The Stripe Price to use for a yearly web checkout, or null when the plan has
 * no usable yearly web price. Gives the price its lookup key when it has none,
 * so the subscription webhook can resolve the plan.
 */
export async function resolveWebAnnualPriceForCheckout(
  stripe: StripePricesClient,
  planId: SellerPlanId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const priceId = webAnnualPriceIdFor(planId, env);
  if (!priceId) return null;
  const price = await stripe.prices.retrieve(priceId);
  if (!isUsableWebAnnualPrice(price, planId)) return null;
  if (price.lookup_key == null) {
    await stripe.prices.update(priceId, { lookup_key: WEB_ANNUAL_LOOKUP_KEYS[planId], transfer_lookup_key: true });
  }
  return priceId;
}
