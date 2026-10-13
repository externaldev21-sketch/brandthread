import { describe, expect, it } from 'vitest';
import { applyLiveStock, cartMaxQuantity, lineQuantityCap, SOLD_OUT_REASON, UNKNOWN_STOCK_CAP } from '../cartStock';
import type { CartItem } from '@/services/cartTypes';

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'line-1', productId: 'p1', variantId: 'v1', productName: 'Tee', variantTitle: 'M',
    sellerId: 's1', sellerName: 'Shop', sellerHandle: '@shop', priceCents: 1000, quantity: 1,
    maxQuantity: 8, isPreOrder: false, inventoryPolicy: 'deny', isAvailable: true, addedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as CartItem;
}

describe('cartMaxQuantity', () => {
  it('keeps a known count, including 0', () => {
    expect(cartMaxQuantity(3)).toBe(3);
    expect(cartMaxQuantity(0)).toBe(0);
  });
  it('falls back only when stock is unknown, or a pre-order has no count', () => {
    expect(cartMaxQuantity(undefined)).toBe(UNKNOWN_STOCK_CAP);
    expect(cartMaxQuantity(null)).toBe(UNKNOWN_STOCK_CAP);
    expect(cartMaxQuantity(0, true)).toBe(UNKNOWN_STOCK_CAP);
    expect(cartMaxQuantity(4, true)).toBe(4);
  });
});

describe('lineQuantityCap', () => {
  it('does not turn a known 0 into 99', () => {
    expect(lineQuantityCap(0)).toBe(0);
    expect(lineQuantityCap(2)).toBe(2);
    expect(lineQuantityCap(undefined)).toBe(UNKNOWN_STOCK_CAP);
  });
});

describe('applyLiveStock', () => {
  it('updates the count from live stock', () => {
    const { items, changed } = applyLiveStock([line({ maxQuantity: 8 })], new Map([['v1', 2]]));
    expect(changed).toBe(true);
    expect(items[0].maxQuantity).toBe(2);
    expect(items[0].isAvailable).toBe(true);
  });

  it('marks a sold-out variant unavailable, and clears only its own mark on restock', () => {
    const soldOut = applyLiveStock([line()], new Map([['v1', 0]])).items[0];
    expect(soldOut).toMatchObject({ maxQuantity: 0, isAvailable: false, unavailableReason: SOLD_OUT_REASON });
    const back = applyLiveStock([soldOut], new Map([['v1', 4]])).items[0];
    expect(back).toMatchObject({ maxQuantity: 4, isAvailable: true, unavailableReason: undefined });
    const other = applyLiveStock([line({ isAvailable: false, unavailableReason: 'Removed by seller' })], new Map([['v1', 4]])).items[0];
    expect(other.isAvailable).toBe(false);
  });

  it('leaves unread variants and pre-orders alone', () => {
    const input = [line({ variantId: 'v9' }), line({ id: 'pre', isPreOrder: true, maxQuantity: 99 })];
    const { items, changed } = applyLiveStock(input, new Map([['v1', 0]]));
    expect(changed).toBe(false);
    expect(items).toEqual(input);
  });

  it('reports no change when the count already matches', () => {
    expect(applyLiveStock([line({ maxQuantity: 5 })], new Map([['v1', 5]])).changed).toBe(false);
  });
});
