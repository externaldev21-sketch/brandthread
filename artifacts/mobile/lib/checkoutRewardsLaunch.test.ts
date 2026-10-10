import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rewardsNeedOneStore, staleRedemptionTokens, threadCashCeilingCents, threadCashMultiStoreAllowed,
} from './threadCashCheckout';
import { clearGuestPaymentTokens, guestPaymentToken, rememberGuestPaymentToken } from './guestPaymentIntent';
import {
  STRIPE_UNAVAILABLE_MESSAGE, reportStripeUnavailableOnce, resetStripeLaunchCheckForTests,
  shouldReportStripeUnavailable, stripeUnavailableReason,
} from './stripeLaunchCheck';

describe('Thread Cash on multi-store orders (BT-270)', () => {
  it('keeps 50¢ on the card for every store', () => {
    const order = { subtotalCents: 6_000, shippingCents: 1_200, promoCents: 0 };
    expect(threadCashCeilingCents(order)).toBe(7_150);
    expect(threadCashCeilingCents({ ...order, storeCount: 2 })).toBe(7_100);
    expect(threadCashCeilingCents({ ...order, storeCount: 0 })).toBe(7_150);
  });

  it('allows several stores only when the order pays in the app', () => {
    expect(threadCashMultiStoreAllowed({ storeCount: 1, paysInApp: false })).toBe(true);
    expect(threadCashMultiStoreAllowed({ storeCount: 3, paysInApp: true })).toBe(true);
    expect(threadCashMultiStoreAllowed({ storeCount: 3, paysInApp: false })).toBe(false);
  });

  it('drops the cart’s one-store rule for Thread Cash paid in the app, never for loyalty', () => {
    expect(rewardsNeedOneStore({ storeCount: 2, loyalty: false, threadCash: true, paysInApp: true })).toBe(false);
    expect(rewardsNeedOneStore({ storeCount: 2, loyalty: false, threadCash: true, paysInApp: false })).toBe(true);
    expect(rewardsNeedOneStore({ storeCount: 2, loyalty: true, threadCash: false, paysInApp: true })).toBe(true);
    expect(rewardsNeedOneStore({ storeCount: 1, loyalty: true, threadCash: true, paysInApp: false })).toBe(false);
    expect(rewardsNeedOneStore({ storeCount: 2, loyalty: false, threadCash: false, paysInApp: false })).toBe(false);
  });

  it('never returns the per-store split of the token this checkout holds', () => {
    const open = [{ token: 'TCASH-AB-1-S1-1' }, { token: 'TCASH-AB-1-S1-2' }, { token: 'TCASH-OLD' }];
    expect(staleRedemptionTokens(open, 'tcash-ab-1')).toEqual(['TCASH-OLD']);
    expect(staleRedemptionTokens(open, null)).toEqual(['TCASH-AB-1-S1-1', 'TCASH-AB-1-S1-2', 'TCASH-OLD']);
  });
});

describe('guest in-app payment token (BT-257)', () => {
  afterEach(() => clearGuestPaymentTokens());

  it('keeps the guest token in memory and strips it from the response', () => {
    const token = 'g'.repeat(43);
    const started = rememberGuestPaymentToken({ paymentIntentId: 'pi_1', clientSecret: 'cs', guestAccessToken: token });
    expect(started).toEqual({ paymentIntentId: 'pi_1', clientSecret: 'cs' });
    expect(guestPaymentToken('pi_1')).toBe(token);
    expect(guestPaymentToken('pi_2')).toBeNull();
  });

  it('remembers nothing for a signed-in intent', () => {
    rememberGuestPaymentToken({ paymentIntentId: 'pi_3' });
    expect(guestPaymentToken('pi_3')).toBeNull();
  });
});

describe('launch check: in-app payments in production (BT-271)', () => {
  afterEach(() => resetStripeLaunchCheckForTests());

  it('names why payments are off', () => {
    expect(stripeUnavailableReason({ hasPublishableKey: false, nativeModulePresent: true })).toBe('missing_publishable_key');
    expect(stripeUnavailableReason({ hasPublishableKey: true, nativeModulePresent: false })).toBe('native_module_missing');
    expect(stripeUnavailableReason({ hasPublishableKey: true, nativeModulePresent: true })).toBeNull();
  });

  it('reports only from production builds', () => {
    expect(shouldReportStripeUnavailable({ isDev: false, isExpoGo: false })).toBe(true);
    expect(shouldReportStripeUnavailable({ isDev: true, isExpoGo: false })).toBe(false);
    expect(shouldReportStripeUnavailable({ isDev: false, isExpoGo: true })).toBe(false);
  });

  it('reports to monitoring and the log once per app session', () => {
    const report = vi.fn();
    const log = vi.fn();
    expect(reportStripeUnavailableOnce('missing_publishable_key', 'ios', report, log)).toBe(true);
    expect(reportStripeUnavailableOnce('missing_publishable_key', 'ios', report, log)).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toEqual({
      tags: { area: 'checkout', check: 'stripe_payment_available', reason: 'missing_publishable_key', platform: 'ios' },
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining(STRIPE_UNAVAILABLE_MESSAGE));
  });

  it('never throws when the reporter does', () => {
    expect(() => reportStripeUnavailableOnce('native_module_missing', 'android', () => { throw new Error('boom'); }, () => {})).not.toThrow();
  });
});
