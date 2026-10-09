import { describe, expect, it } from 'vitest';
import { isGuestBrowseRoute, safeReturnTo } from './guestRoutes';
import { isSignedInOnlyPath } from './guestApiPolicy';

describe('guest browse routes (5.1.1(v))', () => {
  it('lets a guest open feed, discover, search, stores, products, drops and profiles', () => {
    for (const segs of [
      ['(buyer)'], ['(buyer)', 'index'], ['(buyer)', 'feed'], ['(buyer)', 'discover'], ['(buyer)', 'search'], ['(buyer)', 'cart'],
      ['buyer-product-detail'], ['seller-profile'], ['store', 'product', '[productId]'], ['drops', '[dropId]'], ['u', '[username]'], ['c', '[collectionId]'],
    ]) {
      expect(isGuestBrowseRoute(segs)).toBe(true);
    }
  });

  it('keeps account-only areas behind sign-in', () => {
    for (const segs of [
      ['(buyer)', 'inbox'], ['(buyer)', 'orders'], ['(buyer)', 'profile'], ['(buyer)', 'edit-profile'],
      ['(tabs)', 'index'], ['buyer-settings'], ['buyer-conversation'], ['create-post'], ['delete-account'],
    ]) {
      expect(isGuestBrowseRoute(segs)).toBe(false);
    }
  });
});

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

describe('guest checkout + product aliases (BT-249, BT-250)', () => {
  it('lets a guest open the thread-* aliases the cart, Shop sheet and feed tiles push', () => {
    expect(isGuestBrowseRoute(['thread-product-detail'])).toBe(true);
    expect(isGuestBrowseRoute(['thread-checkout'])).toBe(true);
    expect(isGuestBrowseRoute(['checkout-return'])).toBe(true);
  });

  it('every app/ file that only re-exports a guest route is itself guest-allowed', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const appDir = path.resolve(__dirname, '../app');
    const offenders: string[] = [];
    for (const file of readdirSync(appDir)) {
      if (!file.endsWith('.tsx')) continue;
      const source = readFileSync(path.join(appDir, file), 'utf8');
      const alias = source.match(/export\s*\{\s*default\s*\}\s*from\s*'\.\/([\w-]+)'/);
      if (!alias) continue;
      const route = file.replace(/\.tsx$/, '');
      if (isGuestBrowseRoute([alias[1]]) && !isGuestBrowseRoute([route])) offenders.push(route);
    }
    expect(offenders).toEqual([]);
  });
});
