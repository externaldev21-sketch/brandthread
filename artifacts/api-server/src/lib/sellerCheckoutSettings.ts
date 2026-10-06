/**
 * Seller checkout settings — the seller-side Checkout settings screen
 * (mobile app/checkout.tsx). Stored as keys of the seller's seller_settings
 * JSON (routes/seller-settings-route.ts) and enforced at checkout:
 *
 *   • checkoutMode "accounts_required" → guest checkout (routes/guest-checkout.ts)
 *     refuses the seller's items; buyers sign in and pay in the app.
 *   • checkoutMode "guest_only" (the screen's "Guest checkout only", the
 *     original "Checkout only" option — Shopify's "accounts disabled") →
 *     buyers check out as guests: anyone may buy (signed-in buyers too), but
 *     nothing from this store's checkout is kept on an account — the card is
 *     not saved to the buyer's Stripe customer (routes/checkout-intent.ts,
 *     routes/buyer.ts), and the app neither saves the address nor asks the
 *     buyer to create an account. With no saved card there is no
 *     post-purchase one-click offer either (lib/postPurchaseOffer.ts).
 *   • tippingEnabled → the in-app checkout (routes/checkout-intent.ts) accepts
 *     a tip for that seller's group, charges it and pays it out with the order.
 *   • storeLanguage (Languages screen) → the buyer checkout's language
 *     (GET /api/checkout-profile, mobile lib/checkoutI18n.ts) and the hosted
 *     guest Stripe Checkout page's locale (stripeCheckoutLocale below).
 */
import { inArray } from "drizzle-orm";
import { db, sellerSettings } from "@workspace/db";

export const CHECKOUT_MODES = ["guest_only", "accounts_optional", "accounts_required"] as const;
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];

export interface SellerCheckoutSettings {
  checkoutMode: CheckoutMode;
  tippingEnabled: boolean;
  /** The store language (Languages screen); one of STORE_LANGUAGES. */
  storeLanguage: StoreLanguage;
}

/** The Languages screen's store languages (mobile app/languages.tsx). */
export const STORE_LANGUAGES = ["en", "es", "fr", "de", "pt", "zh", "ja", "ko", "ar", "it"] as const;
export type StoreLanguage = (typeof STORE_LANGUAGES)[number];

export const DEFAULT_SELLER_CHECKOUT_SETTINGS: SellerCheckoutSettings = {
  checkoutMode: "accounts_optional",
  tippingEnabled: false,
  storeLanguage: "en",
};

/**
 * Stripe Checkout's `locale` for a store language. Stripe Checkout has no
 * Arabic, so an Arabic store lets Stripe follow the buyer's browser ("auto").
 */
export function stripeCheckoutLocale(language: StoreLanguage): "auto" | "en" | "es" | "fr" | "de" | "pt" | "zh" | "ja" | "ko" | "it" {
  return language === "ar" ? "auto" : language;
}

/** Largest tip accepted for one seller group, whatever the order size ($1,000). */
export const MAX_TIP_CENTS = 100_000;

export function normalizeSellerCheckoutSettings(raw: unknown): SellerCheckoutSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    checkoutMode: CHECKOUT_MODES.includes(value.checkoutMode as CheckoutMode)
      ? value.checkoutMode as CheckoutMode
      : DEFAULT_SELLER_CHECKOUT_SETTINGS.checkoutMode,
    tippingEnabled: value.tippingEnabled === true,
    storeLanguage: STORE_LANGUAGES.includes(value.storeLanguage as StoreLanguage)
      ? value.storeLanguage as StoreLanguage
      : DEFAULT_SELLER_CHECKOUT_SETTINGS.storeLanguage,
  };
}

/**
 * Checks the checkout keys of a PATCH /api/seller/settings body. Other keys
 * pass through untouched (the route merges whatever else it is sent).
 * Returns an error message, or null when the body is acceptable.
 */
export function checkoutSettingsPatchError(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Settings must be an object";
  const value = body as Record<string, unknown>;
  if ("checkoutMode" in value && !CHECKOUT_MODES.includes(value.checkoutMode as CheckoutMode)) {
    return `checkoutMode must be one of: ${CHECKOUT_MODES.join(", ")}`;
  }
  if ("tippingEnabled" in value && typeof value.tippingEnabled !== "boolean") {
    return "tippingEnabled must be true or false";
  }
  if ("storeLanguage" in value && !STORE_LANGUAGES.includes(value.storeLanguage as StoreLanguage)) {
    return `storeLanguage must be one of: ${STORE_LANGUAGES.join(", ")}`;
  }
  return null;
}

export type TipCheck =
  | { ok: true }
  | { ok: false; code: "TIPPING_DISABLED" | "INVALID_TIP"; message: string };

/** A buyer's tip for one seller group: allowed only when the seller turned tipping on, and never more than the items. */
export function checkTip(input: { tipCents: number; subtotalCents: number; tippingEnabled: boolean }): TipCheck {
  const { tipCents, subtotalCents, tippingEnabled } = input;
  if (!Number.isInteger(tipCents) || tipCents < 0) {
    return { ok: false, code: "INVALID_TIP", message: "Enter a valid tip amount." };
  }
  if (tipCents === 0) return { ok: true };
  if (!tippingEnabled) {
    return { ok: false, code: "TIPPING_DISABLED", message: "This shop doesn't accept tips." };
  }
  if (tipCents > Math.min(MAX_TIP_CENTS, Math.max(0, subtotalCents))) {
    return { ok: false, code: "INVALID_TIP", message: "A tip can't be more than the items in the order." };
  }
  return { ok: true };
}

/** Checkout settings for each seller (defaults for sellers who never saved any). */
export async function loadSellerCheckoutSettings(sellerIds: string[]): Promise<Map<string, SellerCheckoutSettings>> {
  const ids = Array.from(new Set(sellerIds.filter(Boolean)));
  const result = new Map<string, SellerCheckoutSettings>();
  if (ids.length === 0) return result;
  const rows = await db.select({ ownerId: sellerSettings.ownerId, settings: sellerSettings.settings })
    .from(sellerSettings).where(inArray(sellerSettings.ownerId, ids));
  const byId = new Map(rows.map((row) => [row.ownerId, row.settings]));
  for (const id of ids) result.set(id, normalizeSellerCheckoutSettings(byId.get(id)));
  return result;
}
