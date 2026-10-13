import { describe, expect, it } from 'vitest';
import { freeShippingLine, freeShippingProgress } from '../freeShippingProgress';

describe('freeShippingProgress', () => {
  it('returns null without a threshold', () => {
    expect(freeShippingProgress(1000, null)).toBeNull();
    expect(freeShippingProgress(1000, undefined)).toBeNull();
    expect(freeShippingProgress(1000, 0)).toBeNull();
  });

  it('reports what is left under the threshold', () => {
    expect(freeShippingProgress(2950, 7500)).toEqual({ remainingCents: 4550, progress: 2950 / 7500, qualified: false });
  });

  it('is qualified at and above the threshold, with a full bar', () => {
    expect(freeShippingProgress(7500, 7500)).toEqual({ remainingCents: 0, progress: 1, qualified: true });
    expect(freeShippingProgress(9000, 7500)).toEqual({ remainingCents: 0, progress: 1, qualified: true });
  });

  it('treats an empty or negative subtotal as zero', () => {
    expect(freeShippingProgress(0, 5000)).toEqual({ remainingCents: 5000, progress: 0, qualified: false });
    expect(freeShippingProgress(-10, 5000)?.progress).toBe(0);
  });
});

describe('freeShippingLine', () => {
  it('names the amount left and the seller', () => {
    expect(freeShippingLine(freeShippingProgress(2950, 7500)!, 'Atelier Noire')).toBe('Spend $45.50 more for free shipping from Atelier Noire');
  });
  it('says the order ships free once qualified', () => {
    expect(freeShippingLine(freeShippingProgress(7500, 7500)!, 'Saint Rue')).toBe('This order ships free from Saint Rue');
  });
});
