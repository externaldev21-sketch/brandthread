import { describe, expect, it } from 'vitest';
import { bagShippingTotal, groupShippingLabel, shippingRateKey } from '@/lib/cart/bagShipping';

describe('groupShippingLabel (per-brand line in the bag)', () => {
  it('shows the seller rate', () => {
    expect(groupShippingLabel(595)).toBe('Shipping $5.95');
    expect(groupShippingLabel(1200)).toBe('Shipping $12.00');
  });
  it('shows Free shipping at 0', () => {
    expect(groupShippingLabel(0)).toBe('Free shipping');
  });
  it('hides the line when the rate is unknown or invalid', () => {
    expect(groupShippingLabel(undefined)).toBeNull();
    expect(groupShippingLabel(Number.NaN)).toBeNull();
    expect(groupShippingLabel(-1)).toBeNull();
    expect(groupShippingLabel(1.5)).toBeNull();
  });
});

describe('bagShippingTotal (summary row = sum of brand lines)', () => {
  const groups = [{ sellerId: 'a' }, { sellerId: 'b' }];
  it('adds every brand when all rates are known', () => {
    expect(bagShippingTotal(groups, { a: 595, b: 0 })).toBe(595);
    expect(bagShippingTotal(groups, { a: 595, b: 1200 })).toBe(1795);
  });
  it('is null when any brand is unknown (no partial, made-up total)', () => {
    expect(bagShippingTotal(groups, { a: 595 })).toBeNull();
    expect(bagShippingTotal(groups, { a: 595, b: undefined })).toBeNull();
  });
  it('is null for an empty bag', () => {
    expect(bagShippingTotal([], {})).toBeNull();
  });
});

describe('shippingRateKey', () => {
  it('changes with the subtotal (free-above thresholds)', () => {
    expect(shippingRateKey('a', 100)).not.toBe(shippingRateKey('a', 200));
  });
});
