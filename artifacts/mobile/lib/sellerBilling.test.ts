import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SELLER_PACKAGE_IDS, isSellerRevenueCatPackage } from './sellerBilling';

describe('seller native billing boundaries', () => {
  it('only accepts the RevenueCat seller packages', () => {
    expect(SELLER_PACKAGE_IDS).toEqual({
      starter: '$bt_starter',
      growth: '$bt_growth',
      pro: '$bt_pro',
    });
    expect(isSellerRevenueCatPackage('$bt_growth')).toBe(true);
    expect(isSellerRevenueCatPackage('$rc_monthly')).toBe(false);
  });

  it('takes the native RevenueCat purchase path before Stripe seller checkout', () => {
    const source = readFileSync(new URL('../app/plans.tsx', import.meta.url).pathname, 'utf8');
    const nativePurchase = source.indexOf("if (Platform.OS !== 'web')");
    const stripeCheckout = source.indexOf('api.seller.subscription.checkout(plan.id)');
    expect(nativePurchase).toBeGreaterThan(-1);
    expect(stripeCheckout).toBeGreaterThan(nativePurchase);
    expect(source.slice(nativePurchase, stripeCheckout)).toContain('await purchase(packageToPurchase)');
    expect(source).toContain("currentRole !== 'owner'");
  });

  it('does not alter the buyer physical-goods Stripe checkout contract', () => {
    const source = readFileSync(new URL('./api.ts', import.meta.url).pathname, 'utf8');
    expect(source).toContain("post<{ sessionId: string; url: string }>('/api/buyer/checkout/session'");
    expect(source).toContain("successUrl: 'mobile://checkout/return?session_id={CHECKOUT_SESSION_ID}'");
    expect(source).toContain("cancelUrl:  'mobile://checkout/cancel'");
  });
});