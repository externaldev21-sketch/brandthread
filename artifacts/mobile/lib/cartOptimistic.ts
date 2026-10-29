/**
 * Pure optimistic cart transforms for the Cart screen: the stepper shows the
 * new quantity on the tap itself, and services/cartService.ts persists the
 * same change right after. Mirrors updateCartItemQuantity exactly (remove at
 * 0, cap at lib/cartStock.ts lineQuantityCap: the line's known stock, or 99
 * when unknown; a sold-out line with cap 0 can step down, never up) so the
 * optimistic state and the persisted one never disagree.
 */
import { lineQuantityCap } from './cartStock';

interface QuantityLine {
  id: string;
  quantity: number;
  maxQuantity?: number;
}

export function applyCartQuantity<C extends { items: L[] }, L extends QuantityLine>(
  cart: C,
  itemId: string,
  quantity: number,
): C {
  const idx = cart.items.findIndex((i) => i.id === itemId);
  if (idx < 0) return cart;
  const items = cart.items.slice();
  if (quantity <= 0) {
    items.splice(idx, 1);
  } else {
    const item = items[idx];
    const cap = lineQuantityCap(item.maxQuantity);
    const capped = cap === 0 ? Math.min(quantity, item.quantity) : Math.min(quantity, cap);
    items[idx] = { ...item, quantity: capped };
  }
  return { ...cart, items };
}
