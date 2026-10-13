import { describe, expect, it } from 'vitest';
import { paymentAlertFor } from './billingStatus';

const base = { provider: 'stripe' as const, planName: 'Growth', platformOS: 'ios' };

describe('payment alert (dunning)', () => {
  it('shows "Retry N of 3 on <date>" while Stripe is retrying', () => {
    const alert = paymentAlertFor({
      ...base, status: 'past_due',
      dunning: { state: 'retrying', retryNumber: 2, maxRetries: 3, nextRetryAt: '2026-10-16T12:00:00.000Z' },
    });
    expect(alert).toMatchObject({ kind: 'retrying', cta: 'Update card' });
    expect(alert?.body).toContain('Retry 2 of 3 on Oct 16.');
  });

  it('shows the paused state after the last retry', () => {
    const alert = paymentAlertFor({ ...base, status: 'paused', dunning: { state: 'paused', pausedAt: '2026-10-20T00:00:00Z', maxRetries: 3 } });
    expect(alert).toMatchObject({ kind: 'paused', title: 'Your plan is paused', cta: 'Update card' });
    expect(alert?.body).toContain('declined 4 times');
  });

  it('keeps the original past-due copy when the server sends no dunning detail', () => {
    expect(paymentAlertFor({ ...base, status: 'past_due' })).toMatchObject({ kind: 'failed', title: 'Payment failed' });
  });

  it('explains store billing retry for App Store / Google Play plans (no pause)', () => {
    expect(paymentAlertFor({ ...base, provider: 'revenuecat', status: 'grace' })?.body).toContain('App Store');
    expect(paymentAlertFor({ ...base, provider: 'revenuecat', status: 'grace', platformOS: 'android' })?.body).toContain('Google Play');
    expect(paymentAlertFor({ ...base, provider: 'revenuecat', status: 'active' })).toBeNull();
  });

  it('shows nothing for a healthy plan', () => {
    expect(paymentAlertFor({ ...base, status: 'active' })).toBeNull();
    expect(paymentAlertFor({ ...base, status: 'trialing' })).toBeNull();
  });
});
