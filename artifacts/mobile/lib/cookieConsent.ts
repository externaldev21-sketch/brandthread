export const COOKIE_CONSENT_VERSION = 1;
export type CookieConsent = { version: number; timestamp: number; necessary: true; analytics: boolean; marketing: boolean };
export const canUseAnalytics = (value: CookieConsent | null | undefined) =>
  value?.version === COOKIE_CONSENT_VERSION && value.analytics === true;
export const canUseMarketing = (value: CookieConsent | null | undefined) =>
  value?.version === COOKIE_CONSENT_VERSION && value.marketing === true;