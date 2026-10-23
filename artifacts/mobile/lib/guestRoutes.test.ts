import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './guestRoutes';
import { isSignedInOnlyPath } from './guestApiPolicy';

describe('safeReturnTo', () => {
  it('accepts in-app paths and rejects external or looping targets', () => {
    expect(safeReturnTo('/buyer-product-detail?id=abc')).toBe('/buyer-product-detail?id=abc');
    expect(safeReturnTo('/(buyer)/discover')).toBe('/(buyer)/discover');
    for (const bad of ['//evil.com', 'https://evil.com', '/sign-in', '/onboarding?x=1', '/', 'javascript:alert(1)', undefined, 5]) {
      expect(safeReturnTo(bad)).toBeNull();
    }
  });
});

describe('signed-out API guard', () => {
  it('blocks paid and account-scoped endpoints but never public browse endpoints', () => {
    for (const p of ['/api/ai/chat', '/api/v1/mockup/generate', '/api/photography', '/api/design-studio/x', '/api/conversations', '/api/buyer/notifications?x=1', '/api/feed/for-you', '/api/buyer/cart']) {
      expect(isSignedInOnlyPath(p)).toBe(true);
    }
    for (const p of ['/api/public/products', '/api/v1/public/discover/feed', '/api/public/sellers/abc', '/api/guest/checkout/session', '/api/config/features', '/api/onboarding-sample/logo', '/api/live/feed', '/api/aim']) {
      expect(isSignedInOnlyPath(p)).toBe(false);
    }
  });
});
