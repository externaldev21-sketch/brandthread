/**
 * Pure optimistic cart transforms for the Cart screen: the stepper shows the
 * new quantity on the tap itself, and services/cartService.ts persists the
 * same change right after. Mirrors updateCartItemQuantity exactly (remove at
 * 0, cap at the line's maxQuantity or 99) so the optimistic state and the
 * persisted one never disagree.
 */
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
    items[idx] = { ...item, quantity: Math.min(quantity, item.maxQuantity || 99) };
  }
  return { ...cart, items };
}
