/**
 * Config for the seller paywall's retention surfaces (exit drawer + one-time
 * offer). No price points are hard-coded here — the offer discount is always
 * applied to the real SELLER_PLANS price at render time.
 *
 * The one-time offer is OFF by default. Turning it on requires BOTH:
 *   1. ONE_TIME_OFFER_PROMO_PRODUCT_ID set to a real product configured in
 *      Stripe (web) and RevenueCat (native) — the discounted price must
 *      actually exist as a billable product before this ships.
 *   2. ONE_TIME_OFFER_ENABLED flipped to true.
 * Until both are true, `isOneTimeOfferAvailable` is false and the exit
 * drawer's dismiss just exits — no offer is ever shown.
 */

/** Master switch. Leave false until the promo product below is real. */
export const ONE_TIME_OFFER_ENABLED = false;

/** Discount shown/applied on the one-time offer. Never exceed 33%. */
export const ONE_TIME_OFFER_DISCOUNT_PERCENT = 25;

/**
 * The real product/price ID for the discounted offer (Stripe price ID on
 * web, RevenueCat package identifier on native). Must be set to a product
 * that actually bills at the discounted amount before enabling the flag —
 * this UI never invents or self-calculates a charge.
 */
export const ONE_TIME_OFFER_PROMO_PRODUCT_ID: string | null = null;

export const isOneTimeOfferAvailable =
  ONE_TIME_OFFER_ENABLED &&
  !!ONE_TIME_OFFER_PROMO_PRODUCT_ID &&
  ONE_TIME_OFFER_DISCOUNT_PERCENT > 0 &&
  ONE_TIME_OFFER_DISCOUNT_PERCENT <= 33;
