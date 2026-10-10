import { describe, expect, it } from 'vitest';
import { pickDefaultAddress, prefillDelivery } from './liveCheckoutPrefill';

const empty = { name: '', phone: '', street: '', city: '', region: '', postalCode: '' };
const home = { recipientName: 'Jordan Kim', street: '1 Main St', line2: 'Apt 4', city: 'Los Angeles', state: 'CA', postalCode: '90001', phone: '555-0100', isDefault: true };

describe('live checkout prefill', () => {
  it('uses the default address, else the first one', () => {
    expect(pickDefaultAddress([{ ...home, isDefault: false, city: 'SF' }, home])).toBe(home);
    expect(pickDefaultAddress([{ ...home, isDefault: false }])?.city).toBe('Los Angeles');
    expect(pickDefaultAddress([])).toBeNull();
  });
  it('fills every empty field', () => {
    expect(prefillDelivery(empty, home)).toEqual({
      name: 'Jordan Kim', phone: '555-0100', street: '1 Main St, Apt 4', city: 'Los Angeles', region: 'CA', postalCode: '90001',
    });
  });
  it('keeps what the buyer already typed', () => {
    expect(prefillDelivery({ ...empty, name: 'J. Kim', city: 'Pasadena' }, home)).toMatchObject({ name: 'J. Kim', city: 'Pasadena', region: 'CA' });
  });
});
