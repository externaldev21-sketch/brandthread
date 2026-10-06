/**
 * Seller Checkout settings (app/checkout.tsx). Stored in the seller's
 * settings (PATCH /api/seller/settings) and enforced at checkout by the API
 * (api-server lib/sellerCheckoutSettings.ts):
 *   - checkoutMode 'accounts_required' turns guest checkout off;
 *   - tippingEnabled lets buyers add a tip in the in-app checkout.
 */

export type CheckoutMode = 'accounts_optional' | 'accounts_required';

export interface SellerCheckoutSettings {
  checkoutMode: CheckoutMode;
  tippingEnabled: boolean;
  /** The store language (Languages screen), shown as the checkout language. */
  storeLanguage: string;
}

export const DEFAULT_SELLER_CHECKOUT_SETTINGS: SellerCheckoutSettings = {
  checkoutMode: 'accounts_optional',
  tippingEnabled: false,
  storeLanguage: 'en',
};

export const CHECKOUT_MODE_OPTIONS: Array<{ id: CheckoutMode; label: string; description: string }> = [
  { id: 'accounts_optional', label: 'Accounts optional', description: 'Buyers can check out as a guest or signed in' },
  { id: 'accounts_required', label: 'Accounts required', description: 'Buyers must sign in to check out' },
];

export function checkoutModeOption(mode: CheckoutMode) {
  return CHECKOUT_MODE_OPTIONS.find(option => option.id === mode) ?? CHECKOUT_MODE_OPTIONS[0];
}

export function nextCheckoutMode(mode: CheckoutMode): CheckoutMode {
  const index = CHECKOUT_MODE_OPTIONS.findIndex(option => option.id === mode);
  return CHECKOUT_MODE_OPTIONS[(index + 1) % CHECKOUT_MODE_OPTIONS.length].id;
}

/** GET /api/seller/settings → the screen's values (defaults for anything unset or invalid). */
export function sellerCheckoutSettingsFrom(raw: unknown): SellerCheckoutSettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    checkoutMode: CHECKOUT_MODE_OPTIONS.some(option => option.id === value.checkoutMode)
      ? value.checkoutMode as CheckoutMode
      : DEFAULT_SELLER_CHECKOUT_SETTINGS.checkoutMode,
    tippingEnabled: value.tippingEnabled === true,
    storeLanguage: typeof value.storeLanguage === 'string' && value.storeLanguage.trim()
      ? value.storeLanguage.trim()
      : DEFAULT_SELLER_CHECKOUT_SETTINGS.storeLanguage,
  };
}

/** Names for the Languages screen's store language codes. */
const STORE_LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
  ar: 'Arabic',
  it: 'Italian',
};

export function storeLanguageName(code: string): string {
  return STORE_LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
