/**
 * "Subscribe on the web": a plain link from the iOS app to the public
 * pricing page (brandthread.app/pricing), where sellers subscribe with Stripe.
 *
 * Off by default. It shows only when ALL of these hold:
 *  - the build sets EXPO_PUBLIC_WEB_SUBSCRIBE_LINK=1
 *  - the app runs on iOS (never Android, never the web app itself)
 *  - the App Store storefront is the United States (RevenueCat storefront
 *    country "USA"; App Store external purchase links are only allowed
 *    without Apple's entitlement in the US storefront)
 * Anything unknown (no storefront yet, RevenueCat unavailable) keeps it off.
 */

export const WEB_PRICING_URL = 'https://brandthread.app/pricing';

export function isWebSubscribeFlagOn(value: string | undefined = process.env.EXPO_PUBLIC_WEB_SUBSCRIBE_LINK): boolean {
  return value === '1';
}

/** RevenueCat reports ISO 3166-1 alpha-3 ("USA"); accept alpha-2 too. */
export function isUsStorefront(countryCode: string | null | undefined): boolean {
  const code = String(countryCode ?? '').trim().toUpperCase();
  return code === 'USA' || code === 'US';
}

export function shouldShowWebSubscribeLink(input: {
  platformOS: string;
  flag: boolean;
  storefrontCountry: string | null | undefined;
}): boolean {
  return input.flag && input.platformOS === 'ios' && isUsStorefront(input.storefrontCountry);
}

/** Where the link opens; `source` lets the web page's analytics tell app traffic apart. */
export function webPricingUrl(source = 'ios_app'): string {
  return `${WEB_PRICING_URL}?utm_source=${encodeURIComponent(source)}`;
}

export type WebCheckoutPlanId = 'starter' | 'growth' | 'pro';
export type WebCheckoutBilling = 'monthly' | 'annual';

/**
 * Reads /subscribe?plan=<id>&billing=<monthly|annual> (the /pricing page's
 * yearly buttons). Unknown values return null so the screen falls back to
 * the plan screen instead of guessing.
 */
export function parseWebCheckoutParams(
  plan: unknown,
  billing: unknown,
): { planId: WebCheckoutPlanId; billing: WebCheckoutBilling } | null {
  const p = Array.isArray(plan) ? plan[0] : plan;
  const b = Array.isArray(billing) ? billing[0] : billing;
  if (p !== 'starter' && p !== 'growth' && p !== 'pro') return null;
  if (b !== undefined && b !== null && b !== '' && b !== 'monthly' && b !== 'annual') return null;
  return { planId: p, billing: b === 'annual' ? 'annual' : 'monthly' };
}
