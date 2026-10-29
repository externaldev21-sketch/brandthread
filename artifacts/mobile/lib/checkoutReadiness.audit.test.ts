import { describe, expect, it } from 'vitest';
import {
  getCheckoutAddressErrors, getCheckoutBlockingSection, getCheckoutContactErrors, getCheckoutNextStepHint,
} from './checkoutReadiness';

const session = { deliveryGroups: [{ sellerId: 's', selectedMethodId: 'standard' }], acknowledgments: [] } as any;
const address = { firstName: 'Ana', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

describe('checkout gate agrees with the inline field checks', () => {
  it('accepts an email with a trailing space (autofill) the same way the field does', () => {
    const contact = { email: 'ana@example.com ', phone: '+1 512 555 0100' };
    expect(getCheckoutContactErrors(contact)).toEqual({});
    expect(getCheckoutBlockingSection(contact, address, session)).toBeNull();
    expect(getCheckoutNextStepHint(contact, address, session)).toBeNull();
  });

  it('blocks a whitespace-only street the field already flags', () => {
    const contact = { email: 'ana@example.com', phone: '+1 512 555 0100' };
    const blank = { ...address, line1: '   ' };
    expect(getCheckoutAddressErrors(blank).line1).toBeTruthy();
    expect(getCheckoutBlockingSection(contact, blank, session)).toBe('information');
  });
});
