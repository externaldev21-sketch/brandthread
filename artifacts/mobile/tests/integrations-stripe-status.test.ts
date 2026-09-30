import { describe, expect, it } from 'vitest';
import { isStripeFullyConnected, normalizeConnectStatus } from '@/lib/stripeConnectStatus';

/**
 * Regression for a fresh store showing Stripe as "Connected" with a green
 * badge while the footer said "0 of 2 integrations connected" — the
 * Integrations screen used to treat Stripe as `autoConnected: true`
 * unconditionally instead of checking real onboarding status.
 */
describe('Stripe row on the Integrations screen', () => {
  it('is not connected for a fresh store that has not started Connect onboarding', () => {
    const status = normalizeConnectStatus({
      connected: false,
      chargesEnabled: false,
      payoutsEnabled: false,
      status: 'unstarted',
    });
    expect(isStripeFullyConnected(status)).toBe(false);
  });

  it('is not connected once Connect exists but onboarding is incomplete', () => {
    const status = normalizeConnectStatus({
      connected: true,
      chargesEnabled: false,
      payoutsEnabled: false,
      status: 'pending',
    });
    expect(isStripeFullyConnected(status)).toBe(false);
  });

  it('is connected only once Connect onboarding is fully done', () => {
    const status = normalizeConnectStatus({
      connected: true,
      chargesEnabled: true,
      payoutsEnabled: true,
      status: 'active',
    });
    expect(isStripeFullyConnected(status)).toBe(true);
  });

  it('treats a missing/failed status fetch (e.g. no session) as not connected', () => {
    expect(isStripeFullyConnected(null)).toBe(false);
  });
});
