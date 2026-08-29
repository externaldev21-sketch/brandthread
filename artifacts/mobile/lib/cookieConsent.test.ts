import { describe, expect, it } from 'vitest';
import { canUseAnalytics, canUseMarketing, COOKIE_CONSENT_VERSION } from './cookieConsent';

describe('cookie consent gates', () => {
  it('allows only explicitly accepted current-version categories', () => {
    const consent = { version: COOKIE_CONSENT_VERSION, timestamp: 1, necessary: true as const, analytics: true, marketing: false };
    expect(canUseAnalytics(consent)).toBe(true);
    expect(canUseMarketing(consent)).toBe(false);
  });
  it('rejects stale or absent consent', () => {
    expect(canUseAnalytics(null)).toBe(false);
    expect(canUseMarketing({ version: COOKIE_CONSENT_VERSION - 1, timestamp: 1, necessary: true, analytics: true, marketing: true })).toBe(false);
  });
});