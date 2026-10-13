/**
 * Real stock for bag lines (pure; services/cartService.ts does the I/O).
 *
 * A line's maxQuantity is the variant's stock. 99 is only the cap when stock
 * is genuinely unknown (or a pre-order with no stock count) — a known 0 or a
 * low count is kept as is, so "Only N left" on the bag is the real number.
 */
import type { CartItem } from '@/services/cartTypes';

export const UNKNOWN_STOCK_CAP = 99;
/** unavailableReason set when a live refresh finds the variant sold out. */
export const SOLD_OUT_REASON = 'Sold out';

/** maxQuantity for a new or changed bag line. */
export function cartMaxQuantity(inventoryQuantity: number | null | undefined, isPreOrder = false): number {
  const known = typeof inventoryQuantity === 'number' && Number.isInteger(inventoryQuantity) && inventoryQuantity >= 0;
  if (!known) return UNKNOWN_STOCK_CAP;
  if (isPreOrder && inventoryQuantity === 0) return UNKNOWN_STOCK_CAP;
  return inventoryQuantity;
}

/** The cap a stored line's quantity may reach. */
export function lineQuantityCap(maxQuantity: number | null | undefined): number {
  return typeof maxQuantity === 'number' && Number.isInteger(maxQuantity) && maxQuantity >= 0 ? maxQuantity : UNKNOWN_STOCK_CAP;
}

/**
 * Applies live variant stock to bag lines. Lines whose variant wasn't read,
 * and pre-orders, are left alone. A sold-out variant marks the line
 * unavailable; one that comes back in stock clears that mark (only the mark
 * this function set, never another reason).
 */
export function applyLiveStock(items: CartItem[], stockByVariantId: ReadonlyMap<string, number>): { items: CartItem[]; changed: boolean } {
  let changed = false;
  const next = items.map(item => {
    const stock = stockByVariantId.get(item.variantId);
    if (item.isPreOrder || typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) return item;
    let updated: CartItem = item;
    if (item.maxQuantity !== stock) updated = { ...updated, maxQuantity: stock };
    if (stock === 0 && item.isAvailable) {
      updated = { ...updated, isAvailable: false, unavailableReason: SOLD_OUT_REASON };
    } else if (stock > 0 && !item.isAvailable && item.unavailableReason === SOLD_OUT_REASON) {
      updated = { ...updated, isAvailable: true, unavailableReason: undefined };
    }
    if (updated !== item) changed = true;
    return updated;
  });
  return { items: next, changed };
}
