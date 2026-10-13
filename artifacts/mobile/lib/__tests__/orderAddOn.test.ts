import { describe, expect, it } from 'vitest';
import { cardLabel, formatTimeLeft, fromPrice } from '../orderAddOn';

describe('order add-on helpers', () => {
  it('formats the time left as m:ss and never goes negative', () => {
    expect(formatTimeLeft(14 * 60_000 + 39_000)).toBe('14:39');
    expect(formatTimeLeft(61_000)).toBe('1:01');
    expect(formatTimeLeft(500)).toBe('0:01');
    expect(formatTimeLeft(-5_000)).toBe('0:00');
  });

  it('labels the card on file', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('Visa •••• 4242');
    expect(cardLabel({ brand: null, last4: '1881' })).toBe('Card •••• 1881');
    expect(cardLabel({ brand: 'visa', last4: null })).toBeNull();
  });

  it('starts from the cheapest variant', () => {
    expect(fromPrice({ productId: 'p', name: 'Tee', imageUrl: null, variants: [
      { variantId: 'a', label: 'S', priceCents: 3000 }, { variantId: 'b', label: 'XL', priceCents: 2500 },
    ] })).toBe(2500);
  });
});
