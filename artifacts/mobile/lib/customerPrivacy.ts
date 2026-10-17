/**
 * Seller Customer privacy settings — mirrors api-server
 * lib/customerPrivacySettings.ts (stored under seller_settings.customerPrivacy).
 */
export interface CustomerPrivacySettings {
  /** Store data exports leave out customer email, phone and addresses. */
  maskContactInExports: boolean;
}

export const DEFAULT_CUSTOMER_PRIVACY: CustomerPrivacySettings = {
  maskContactInExports: false,
};

export function normalizeCustomerPrivacy(input: unknown): CustomerPrivacySettings {
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    maskContactInExports: typeof raw.maskContactInExports === 'boolean'
      ? raw.maskContactInExports
      : DEFAULT_CUSTOMER_PRIVACY.maskContactInExports,
  };
}
