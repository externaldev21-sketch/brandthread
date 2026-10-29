import { describe, expect, it } from 'vitest';
import { applyCartQuantity } from './cartOptimistic';

// maxQuantity 0 is a KNOWN sold-out line (lib/cartStock.ts), not "no max":
// services/cartService.ts updateCartItemQuantity lets it step down, never up.
describe('applyCartQuantity on a sold-out line (maxQuantity 0)', () => {
  const cart = { items: [{ id: 's', quantity: 2, maxQuantity: 0 }] };

  it('never steps up past the current quantity', () => {
    expect(applyCartQuantity(cart, 's', 3).items[0].quantity).toBe(2);
  });

  it('still steps down', () => {
    expect(applyCartQuantity(cart, 's', 1).items[0].quantity).toBe(1);
  });
});
