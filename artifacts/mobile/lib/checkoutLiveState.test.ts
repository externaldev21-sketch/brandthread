import { describe, expect, it } from 'vitest';
import { resolveCheckoutLive } from './checkoutLiveState';

describe('resolveCheckoutLive', () => {
  it('is off without the app publishable key, whatever the server says', () => {
    expect(resolveCheckoutLive('', { live: true, applePay: true, googlePay: true }).status).toBe('off');
  });
  it('is off when the server is not live or did not answer', () => {
    expect(resolveCheckoutLive('pk_test_x', { live: false }).status).toBe('off');
    expect(resolveCheckoutLive('pk_test_x', null).status).toBe('off');
  });
  it('is live with both, wallets as the server flags them', () => {
    expect(resolveCheckoutLive('pk_test_x', { live: true, applePay: false, googlePay: true }))
      .toEqual({ status: 'live', applePay: false, googlePay: true });
  });
});
