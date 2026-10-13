import { describe, expect, it } from 'vitest';
import { freeShippingLabel, freeShippingStatus } from './freeShipping';

describe('freeShippingStatus', () => {
  it('has no status when the seller has no threshold', () => {
    expect(freeShippingStatus(5000, null)).toEqual({ kind: 'none' });
    expect(freeShippingStatus(5000, undefined)).toEqual({ kind: 'none' });
    expect(freeShippingStatus(5000, Number.NaN)).toEqual({ kind: 'none' });
    expect(freeShippingStatus(5000, -1)).toEqual({ kind: 'none' });
  });

  it('is free at or above the threshold', () => {
    expect(freeShippingStatus(10000, 10000)).toEqual({ kind: 'free' });
    expect(freeShippingStatus(31800, 25000)).toEqual({ kind: 'free' });
    expect(freeShippingStatus(0, 0)).toEqual({ kind: 'free' });
  });

  it('reports what is left below the threshold', () => {
    expect(freeShippingStatus(16500, 20000)).toEqual({ kind: 'remaining', remainingCents: 3500 });
    expect(freeShippingStatus(0, 7500)).toEqual({ kind: 'remaining', remainingCents: 7500 });
  });

  it('treats a negative or invalid subtotal as zero', () => {
    expect(freeShippingStatus(-500, 2000)).toEqual({ kind: 'remaining', remainingCents: 2000 });
    expect(freeShippingStatus(Number.NaN, 2000)).toEqual({ kind: 'remaining', remainingCents: 2000 });
  });
});

describe('freeShippingLabel', () => {
  it('is null without a threshold', () => {
    expect(freeShippingLabel(5000, null)).toBeNull();
  });

  it('says free shipping once qualified', () => {
    expect(freeShippingLabel(25000, 25000)).toBe('Free shipping');
  });

  it('uses whole dollars when the remainder is whole', () => {
    expect(freeShippingLabel(7600, 10000)).toBe('$24 away from free shipping');
  });

  it('keeps cents when the remainder is not whole', () => {
    expect(freeShippingLabel(7650, 10000)).toBe('$23.50 away from free shipping');
    expect(freeShippingLabel(9999, 10000)).toBe('$0.01 away from free shipping');
  });

  it('groups thousands', () => {
    expect(freeShippingLabel(0, 150000)).toBe('$1,500 away from free shipping');
  });
});
