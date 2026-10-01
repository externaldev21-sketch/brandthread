import { describe, expect, it } from 'vitest';
import {
  GENERIC_DELIVERY_WINDOW, buildCreatePaymentIntentBody, buildQuoteBody, canQuote, choosePaymentPath,
  deliveryWindowLabel, paymentErrorMessage, quoteTotals, walletContactToCheckout,
} from './checkoutPayment';

const TEST_CARD = '4242424242424242';

const session = {
  deliveryGroups: [
    { sellerId: 's1', items: [{ variantId: 'v1', productId: 'p1', quantity: 2 }] },
    { sellerId: 's2', items: [{ variantId: 'v2', productId: 'p2', quantity: 1 }] },
  ],
  discounts: [{ code: 'TENOFF', isValid: true }],
} as any;

describe('payment-intent request bodies (PCI SAQ-A: card data never reaches our API)', () => {
  it('sends only whitelisted fields, even when card data sneaks into the form state', () => {
    const polluted = {
      firstName: 'Jordan', lastName: 'Reyes', line1: '148 Mercer St', line2: 'Apt 4', city: 'New York',
      state: 'NY', postalCode: '10012', country: 'us',
      // Everything below must be dropped.
      cardNumber: TEST_CARD, cvc: '123', number: TEST_CARD, card: { number: TEST_CARD, exp_month: 12 },
    } as any;
    const contact = { email: 'a@b.co', phone: '+1 503 555 0100', cardNumber: TEST_CARD, paymentMethod: { card: TEST_CARD } } as any;
    const body = buildCreatePaymentIntentBody({ session, contact, address: polluted, idempotencyKey: 'ck_123456789', saveCard: true });

    expect(Object.keys(body).sort()).toEqual(['clientIdempotencyKey', 'contactEmail', 'contactPhone', 'groups', 'saveCard', 'shippingAddress']);
    expect(Object.keys(body.shippingAddress).sort()).toEqual(['city', 'country', 'line2', 'postalCode', 'recipientName', 'state', 'street']);
    for (const group of body.groups) {
      for (const item of group.items) expect(Object.keys(item).sort()).toEqual(['productId', 'quantity', 'variantId']);
    }
    const json = JSON.stringify(body);
    expect(json).not.toContain('4242');
    expect(json).not.toMatch(/cvc|cvv|exp_|"card"|cardNumber|"number"/i);
    expect(body.shippingAddress).toMatchObject({ recipientName: 'Jordan Reyes', country: 'US', line2: 'Apt 4' });
  });

  it('applies a promo code only to a single-seller order', () => {
    const body = buildCreatePaymentIntentBody({ session, contact: {}, address: {}, idempotencyKey: 'k1234567', saveCard: false });
    expect(body.groups.every(g => !('discountCode' in g))).toBe(true);
    const single = buildCreatePaymentIntentBody({
      session: { ...session, deliveryGroups: [session.deliveryGroups[0]] }, contact: {}, address: {}, idempotencyKey: 'k1234567', saveCard: false,
    });
    expect(single.groups[0].discountCode).toBe('TENOFF');
  });

  it('quotes with only the parts of the address that price the order', () => {
    expect(canQuote({ postalCode: '1' })).toBe(false);
    expect(canQuote({ postalCode: '10012', country: 'US' })).toBe(true);
    const body = buildQuoteBody(session, { postalCode: '10012', country: 'us', state: 'NY', cardNumber: TEST_CARD } as any);
    expect(body.shippingAddress).toEqual({ state: 'NY', postalCode: '10012', country: 'US' });
    expect(JSON.stringify(body)).not.toContain('4242');
  });
});

describe('which way an order pays', () => {
  const base = {
    previewOnly: false, signedIn: true, hostedFallbackFlag: false, stripeAvailable: true,
    hasPreOrder: false, threadCashApplied: false, loyaltyApplied: false, serverSaidHosted: false,
  };
  it('pays in the app by default', () => {
    expect(choosePaymentPath(base)).toEqual({ path: 'in_app', reason: null });
  });
  it('keeps the preview fake path', () => {
    expect(choosePaymentPath({ ...base, previewOnly: true, stripeAvailable: false }).path).toBe('preview');
  });
  it.each([
    ['flag', { hostedFallbackFlag: true }],
    ['guest', { signedIn: false }],
    ['stripe_unavailable', { stripeAvailable: false }],
    ['preorder', { hasPreOrder: true }],
    ['thread_cash', { threadCashApplied: true }],
    ['loyalty', { loyaltyApplied: true }],
    ['server', { serverSaidHosted: true }],
  ])('falls back to hosted Checkout for %s', (reason, patch) => {
    expect(choosePaymentPath({ ...base, ...patch })).toEqual({ path: 'hosted', reason });
  });
});

describe('delivery window', () => {
  it('uses the seller processing time, else a generic window, never blank', () => {
    expect(deliveryWindowLabel({ processingDays: 2 })).toBe('Ships in 2 business days');
    expect(deliveryWindowLabel({ processingDays: 0 })).toBe('Ships in 1 business day');
    expect(deliveryWindowLabel({ processingDays: null })).toBe(GENERIC_DELIVERY_WINDOW);
    expect(deliveryWindowLabel({})).toBe('Ships in 3–5 business days');
    expect(deliveryWindowLabel({ isPreOrder: true, processingDays: 2 })).toBe('Ships after production');
  });
});

describe('wallet sheet contact', () => {
  it('maps the Apple Pay / Google Pay contact onto the page', () => {
    const { address, contact } = walletContactToCheckout({
      name: 'Jordan  Reyes', email: 'j@r.co', phone: '5035550100',
      address: { line1: '148 Mercer St', line2: null, city: 'New York', state: 'NY', postalCode: '10012', country: 'us' },
    });
    expect(address).toMatchObject({ firstName: 'Jordan', lastName: 'Reyes', line1: '148 Mercer St', country: 'US' });
    expect(contact).toEqual({ email: 'j@r.co', phone: '5035550100' });
  });
});

describe('quote totals and errors', () => {
  it('adds up the seller groups', () => {
    expect(quoteTotals({
      amountCents: 1_500,
      groups: [
        { sellerId: 'a', checkoutSessionId: '', subtotalCents: 1_000, shippingCents: 200, discountCents: 100, taxCents: 80, totalCents: 1_180, processingDays: 2 },
        { sellerId: 'b', checkoutSessionId: '', subtotalCents: 300, shippingCents: 0, discountCents: 0, taxCents: 20, totalCents: 320, processingDays: null },
      ],
    })).toEqual({ subtotalCents: 1_300, shippingCents: 200, discountCents: 100, taxCents: 100, totalCents: 1_500 });
  });
  it('explains declines in plain language', () => {
    expect(paymentErrorMessage('insufficient_funds')).toContain('insufficient funds');
    expect(paymentErrorMessage(null, 'Custom')).toBe('Custom');
    expect(paymentErrorMessage(null)).toContain('didn’t go through');
  });
});

describe('quote responses', () => {
  it('accepts only a well-formed quote', async () => {
    const { isCartQuote } = await import('./checkoutPayment');
    expect(isCartQuote({ amountCents: 100, groups: [{ totalCents: 100, taxCents: 0, shippingCents: 0 }] })).toBe(true);
    expect(isCartQuote({})).toBe(false);
    expect(isCartQuote(null)).toBe(false);
    expect(isCartQuote({ amountCents: 100 })).toBe(false);
    expect(isCartQuote({ amountCents: 100, groups: [{}] })).toBe(false);
  });
});

describe('quoteOffersBnpl', () => {
  it('is true only when the server offered klarna or afterpay', async () => {
    const { quoteOffersBnpl } = await import('./checkoutPayment');
    const base = { amountCents: 100, groups: [] };
    expect(quoteOffersBnpl(undefined)).toBe(false);
    expect(quoteOffersBnpl(base)).toBe(false);
    expect(quoteOffersBnpl({ ...base, paymentMethodTypes: ['card'] })).toBe(false);
    expect(quoteOffersBnpl({ ...base, paymentMethodTypes: ['card', 'klarna'] })).toBe(true);
    expect(quoteOffersBnpl({ ...base, paymentMethodTypes: ['card', 'afterpay_clearpay'] })).toBe(true);
  });
});
