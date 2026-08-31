import { describe, expect, it } from 'vitest';

import {
  getCheckoutBlockingSection,
  getFirstIncompleteCheckoutSection,
  mergeCheckoutFormState,
} from './checkoutReadiness';

const contact = { email: 'buyer@example.com' };
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