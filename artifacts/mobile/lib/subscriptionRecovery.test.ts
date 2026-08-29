import { describe, expect, it } from 'vitest';
import {
  getBillingRecoveryTarget,
  isSubscriptionPaymentRecoveryRequired,
} from './subscriptionRecovery';

describe('subscription payment recovery', () => {
  it.each(['past_due', 'unpaid'])('shows recovery for %s subscriptions', (status) => {
    expect(isSubscriptionPaymentRecoveryRequired(status)).toBe(true);
  });

  it.each(['active', 'trialing', 'canceled', 'none', null])(
    'does not show recovery for %s subscriptions',
    (status) => {
      expect(isSubscriptionPaymentRecoveryRequired(status)).toBe(false);
    },
  );

  it('routes legacy Stripe subscriptions to Stripe on every platform', () => {
    expect(getBillingRecoveryTarget('stripe', null)).toBe('stripe');
  });

  it('routes RevenueCat subscriptions to their management URL', () => {
    expect(getBillingRecoveryTarget('revenuecat', 'https://apps.apple.com/account/subscriptions'))
      .toBe('revenuecat');
  });

  it('falls back to the subscription screen when provider management is unavailable', () => {
    expect(getBillingRecoveryTarget('revenuecat', null)).toBe('subscription');
    expect(getBillingRecoveryTarget('none', null)).toBe('subscription');
  });
});