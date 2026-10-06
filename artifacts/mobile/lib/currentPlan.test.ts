import { describe, expect, it } from 'vitest';
import {
  currentPlanSummary, hasSellerSubscription, manageSubscriptionAction, storeSubscriptionsUrl,
} from './currentPlan';

describe('currentPlanSummary (QA-0093 / QA-0166)', () => {
  it('never shows Starter or a price to a seller without a subscription', () => {
    // Exactly what GET /api/seller/subscription returns for a never-subscribed seller.
    const s = currentPlanSummary({ plan: 'starter', status: 'none', amountCents: 0 });
    expect(s).toEqual({ hasPlan: false, planId: null, name: 'No plan', priceLabel: null, statusLabel: 'Not subscribed' });
  });

  it('shows the real charge for a paying seller', () => {
    expect(currentPlanSummary({ plan: 'growth', status: 'active', amountCents: 7900 }))
      .toMatchObject({ hasPlan: true, planId: 'growth', name: 'Growth', priceLabel: '$79.00/mo', statusLabel: 'Active' });
  });

  it('falls back to the plan list price when the charge is unknown', () => {
    expect(currentPlanSummary({ plan: 'starter', status: 'trialing', amountCents: 0 }))
      .toMatchObject({ name: 'Starter', priceLabel: '$29/mo', statusLabel: 'Trial' });
  });

  it('treats only real subscription states as subscribed', () => {
    for (const st of ['active', 'trialing', 'past_due', 'unpaid', 'canceled']) expect(hasSellerSubscription(st)).toBe(true);
    for (const st of ['none', '', null, undefined, 'incomplete_expired']) expect(hasSellerSubscription(st)).toBe(false);
  });
});

describe('manageSubscriptionAction (QA-0167)', () => {
  it('never opens the Stripe portal on iOS or Android', () => {
    expect(manageSubscriptionAction('ios', 'stripe', null)).toEqual({ kind: 'web_billed' });
    expect(manageSubscriptionAction('android', 'stripe', 'https://x')).toEqual({ kind: 'web_billed' });
  });

  it('opens the store subscription page for store plans', () => {
    expect(manageSubscriptionAction('ios', 'revenuecat', 'https://apps.apple.com/account/subscriptions?x=1'))
      .toEqual({ kind: 'open_url', url: 'https://apps.apple.com/account/subscriptions?x=1' });
    expect(manageSubscriptionAction('ios', 'revenuecat', null))
      .toEqual({ kind: 'open_url', url: 'https://apps.apple.com/account/subscriptions' });
    expect(manageSubscriptionAction('android', 'none', null))
      .toEqual({ kind: 'open_url', url: 'https://play.google.com/store/account/subscriptions' });
  });

  it('keeps the Stripe portal on web for Stripe plans only', () => {
    expect(manageSubscriptionAction('web', 'stripe', null)).toEqual({ kind: 'stripe_portal' });
    expect(manageSubscriptionAction('web', 'revenuecat', null)).toEqual({ kind: 'store_billed' });
    expect(manageSubscriptionAction('web', 'none', null)).toEqual({ kind: 'no_subscription' });
    expect(storeSubscriptionsUrl('web')).toBeNull();
  });
});
