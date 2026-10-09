import { describe, expect, it } from 'vitest';
import { applyCartQuantity } from './cartOptimistic';

const cart = {
  id: 'cart',
  items: [
    { id: 'a', quantity: 1, maxQuantity: 3 },
    { id: 'b', quantity: 2, maxQuantity: 0 },
  ],
};

describe('applyCartQuantity', () => {
  it('sets the new quantity without touching other lines or the input', () => {
    const next = applyCartQuantity(cart, 'a', 2);
    expect(next.items).toEqual([{ id: 'a', quantity: 2, maxQuantity: 3 }, cart.items[1]]);
    expect(cart.items[0].quantity).toBe(1);
  });

  it('caps at the line max, or 99 when the line has none', () => {
    expect(applyCartQuantity(cart, 'a', 10).items[0].quantity).toBe(3);
    expect(applyCartQuantity(cart, 'b', 500).items[1].quantity).toBe(99);
  });

  it('removes the line at zero', () => {
    expect(applyCartQuantity(cart, 'a', 0).items.map((i) => i.id)).toEqual(['b']);
  });

  it('returns the same cart for an unknown line', () => {
    expect(applyCartQuantity(cart, 'zzz', 4)).toBe(cart);
  });
});
