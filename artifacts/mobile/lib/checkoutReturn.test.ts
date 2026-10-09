import { describe, expect, it } from 'vitest';
import { checkoutReturnUrls, hostedCheckoutVerdict, NATIVE_CHECKOUT_RETURN_BASE } from './checkoutReturn';

describe('checkoutReturnUrls (BT-251)', () => {
  it('uses the app scheme from app.json on native, never mobile://', () => {
    const urls = checkoutReturnUrls();
    expect(urls.successUrl).toBe('brandthread://checkout-return?session_id={CHECKOUT_SESSION_ID}');
    expect(urls.cancelUrl).toBe('brandthread://checkout-return?cancelled=1');
    expect(urls.redirectUrl).toBe(NATIVE_CHECKOUT_RETURN_BASE);
    expect(JSON.stringify(urls)).not.toContain('mobile://');
  });

  it('uses the https origin on web (and the universal link path)', () => {
    const urls = checkoutReturnUrls('https://brandthread.app/');
    expect(urls.successUrl).toBe('https://brandthread.app/checkout-return?session_id={CHECKOUT_SESSION_ID}');
    expect(urls.redirectUrl).toBe('https://brandthread.app/checkout-return');
  });

  it('ignores an origin that is not a bare http(s) origin', () => {
    expect(checkoutReturnUrls('javascript:alert(1)').redirectUrl).toBe(NATIVE_CHECKOUT_RETURN_BASE);
    expect(checkoutReturnUrls('https://evil.test/path').redirectUrl).toBe(NATIVE_CHECKOUT_RETURN_BASE);
  });
});

describe('hostedCheckoutVerdict (BT-251)', () => {
  it('a paid buyer who closed the browser with Done is never told they cancelled', () => {
    expect(hostedCheckoutVerdict({ browserType: 'cancel', paymentStatus: 'paid' })).toBe('paid');
    expect(hostedCheckoutVerdict({ browserType: 'dismiss', orderId: 'ord_1' })).toBe('paid');
  });

  it('closing without paying is a cancel', () => {
    expect(hostedCheckoutVerdict({ browserType: 'cancel', paymentStatus: 'unpaid' })).toBe('cancelled');
    expect(hostedCheckoutVerdict({
      browserType: 'success',
      returnedUrl: 'brandthread://checkout-return?cancelled=1',
      paymentStatus: 'unpaid',
    })).toBe('cancelled');
  });

  it('a decline reason wins over cancel, and an unconfirmed success is pending', () => {
    expect(hostedCheckoutVerdict({ browserType: 'cancel', declineReason: 'card_declined' })).toBe('declined');
    expect(hostedCheckoutVerdict({
      browserType: 'success',
      returnedUrl: 'brandthread://checkout-return?session_id=cs_1',
      paymentStatus: 'unpaid',
    })).toBe('pending');
  });
});
