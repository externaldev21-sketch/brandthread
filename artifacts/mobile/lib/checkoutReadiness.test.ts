import { describe, expect, it } from 'vitest';

import {
  getCheckoutAddressErrors,
  getCheckoutBlockingSection,
  getCheckoutContactErrors,
  getCheckoutDisplayTotals,
  getCheckoutNextStepHint,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
  withoutImplicitTermsAck,
} from './checkoutReadiness';

const contact = { email: 'buyer@example.com', phone: '+1 512 555 0100' };
const address = {
  firstName: 'Buyer',
  lastName: 'One',
  line1: '1 Main Street',
  city: 'Austin',
  state: 'TX',
  postalCode: '78701',
  country: 'US',
};

describe('checkout readiness', () => {
  it('blocks review payment when contact or address is incomplete', () => {
    expect(getCheckoutBlockingSection({}, {}, { deliveryGroups: [], acknowledgments: [] })).toBe('information');
  });

  it('requires a delivery choice for every seller group', () => {
    const session = {
      deliveryGroups: [
        { sellerId: 'seller-1', selectedMethodId: 'standard' },
        { sellerId: 'seller-2', selectedMethodId: undefined },
      ],
      acknowledgments: [],
    } as any;
    expect(getCheckoutBlockingSection(contact, address, session)).toBe('delivery');
    session.deliveryGroups[1].selectedMethodId = 'express';
    expect(getCheckoutBlockingSection(contact, address, session)).toBeNull();
  });

  it('opens incomplete delivery even when no acknowledgments are required', () => {
    const session = {
      deliveryGroups: [{ sellerId: 'seller-1', selectedMethodId: undefined }],
      acknowledgments: [],
    } as any;
    expect(getFirstIncompleteCheckoutSection(contact, address, session)).toBe('delivery');
  });

  it('blocks payment until every required acknowledgment is accepted', () => {
    const session = {
      deliveryGroups: [{ sellerId: 'seller-1', selectedMethodId: 'standard' }],
      acknowledgments: [{ key: 'policy', required: true, acknowledged: false }],
    } as any;
    expect(getCheckoutBlockingSection(contact, address, session)).toBe('acknowledgments');
  });

  it('persists edits made after checkout has already advanced', () => {
    const session = {
      step: 'review',
      contact: { email: 'old@example.com' },
      shippingAddress: { ...address, city: 'Dallas' },
    } as any;
    const merged = mergeCheckoutFormState(
      session,
      { email: 'new@example.com' },
      { ...address, city: 'Austin' },
    );
    expect(merged.step).toBe('review');
    expect(merged.contact?.email).toBe('new@example.com');
    expect(merged.shippingAddress?.city).toBe('Austin');
  });
});

describe('checkout redesign helpers', () => {
  const readySession = {
    deliveryGroups: [{ sellerId: 'seller-1', selectedMethodId: 'standard' }],
    acknowledgments: [],
  } as any;

  it('explains the next missing step in the same order the button gate checks', () => {
    expect(getCheckoutNextStepHint({}, {}, readySession)).toBe('Enter a valid email to continue');
    expect(getCheckoutNextStepHint({ email: 'buyer@example.com' }, {}, readySession)).toBe('Enter a phone number for delivery updates');
    expect(getCheckoutNextStepHint(contact, {}, readySession)).toBe('Add a shipping address to continue');
    expect(getCheckoutNextStepHint(contact, address, {
      deliveryGroups: [{ sellerId: 'seller-1', selectedMethodId: undefined }], acknowledgments: [],
    } as any)).toBe('Choose a delivery option to continue');
    expect(getCheckoutNextStepHint(contact, address, {
      ...readySession, acknowledgments: [{ key: 'preorder_policy', required: true, acknowledged: false }],
    })).toBe('Accept the pre-order terms to continue');
    expect(getCheckoutNextStepHint(contact, address, readySession)).toBeNull();
  });

  it('hint and button gate always agree', () => {
    const cases: Array<[any, any]> = [[{}, {}], [contact, {}], [contact, address], [{ email: 'bad' }, address]];
    for (const [c, a] of cases) {
      expect(getCheckoutNextStepHint(c, a, readySession) === null).toBe(getCheckoutBlockingSection(c, a, readySession) === null);
    }
  });

  it('validates contact fields inline', () => {
    expect(getCheckoutContactErrors({})).toEqual({
      email: 'Enter your email address',
      phone: 'Enter a phone number for delivery updates',
    });
    expect(getCheckoutContactErrors({ email: 'nope', phone: '12' })).toEqual({
      email: 'Enter a valid email, like name@example.com',
      phone: 'Enter a valid phone number',
    });
    expect(getCheckoutContactErrors(contact)).toEqual({});
  });

  it('validates every required address field', () => {
    expect(Object.keys(getCheckoutAddressErrors({})).sort()).toEqual(
      ['city', 'country', 'firstName', 'lastName', 'line1', 'postalCode', 'state'],
    );
    expect(getCheckoutAddressErrors(address)).toEqual({});
  });

  it('drops only the legacy client-side terms checkbox, never pre-order acknowledgments', () => {
    const acks = [
      { key: 'preorder_policy', required: true, acknowledged: false },
      { key: 'terms', required: true, acknowledged: false },
    ];
    expect(withoutImplicitTermsAck(acks).map(a => a.key)).toEqual(['preorder_policy']);
  });

  it('shows a validated promo once, subtracted from the total, for single-seller orders only', () => {
    const summary = { subtotalCents: 10000, shippingTotalCents: 1200, taxTotalCents: 0, discountTotalCents: 0, totalCents: 11200, currency: 'USD' };
    const discounts = [{ code: 'SAVE10', isValid: true, appliedAmountCents: 1000 }] as any;
    const single = getCheckoutDisplayTotals({ summary, discounts, deliveryGroups: [{}] } as any);
    expect(single.promoCents).toBe(1000);
    expect(single.totalCents).toBe(10200);
    const multi = getCheckoutDisplayTotals({ summary, discounts, deliveryGroups: [{}, {}] } as any);
    expect(multi.promoCents).toBe(0);
    expect(multi.totalCents).toBe(11200);
    const invalid = getCheckoutDisplayTotals({ summary, discounts: [{ code: 'X', isValid: false, appliedAmountCents: 500 }], deliveryGroups: [{}] } as any);
    expect(invalid.totalCents).toBe(11200);
  });
});
