import { describe, expect, it } from 'vitest';
import { chargeableSubtotalCents } from '../services/cartSync';
import { bagProduct, bagCanChooseOptions } from '../lib/cart/bagProduct';
import type { CartItem } from '../services/cartTypes';

const coat: CartItem = {
  id: 'line-coat', productId: 'product-coat', variantId: 'variant-m',
  productName: 'Sculpted Wool Coat', variantTitle: 'M',
  sellerId: 'atelier', sellerName: 'Atelier Noire', sellerHandle: 'atelier',
  priceCents: 96_000, quantity: 2, maxQuantity: 6,
  isAvailable: true, isPreOrder: false, inventoryPolicy: 'deny',
  addedAt: '2026-10-13T00:00:00.000Z',
};

describe('Bag unit-price, quantity and option contracts', () => {
  it.each(['preview-product-coat', 'database-product-coat'])('multiplies $960 × 2 for %s', productId => {
    const line = { ...coat, productId };
    expect(chargeableSubtotalCents([line])).toBe(192_000);
    expect([line].reduce((sum, item) => sum + item.quantity, 0)).toBe(2);
    expect(chargeableSubtotalCents([{ ...line, quantity: 3 }])).toBe(288_000);
  });
  it('adds unit-priced lines, not just row counts', () => {
    expect(chargeableSubtotalCents([coat, { ...coat, priceCents: 1000, quantity: 3 }])).toBe(195_000);
  });
  it('uses the saved variant and price when a product cannot be reloaded', () => {
    const product = bagProduct(coat);
    expect(product.variants[0]).toMatchObject({ id: 'variant-m', title: 'M', priceCents: 96_000 });
    expect(product.options).toEqual([]);
    expect(bagCanChooseOptions(coat)).toBe(true);
  });
  it('preserves all cached options for demo/offline items', () => {
    const product = bagProduct(coat);
    product.variants.push({ ...product.variants[0], id: 'variant-l', title: 'L' });
    product.options = [{ id: 'size', name: 'Size', values: [{ id: 'm', label: 'M' }, { id: 'l', label: 'L' }] }];
    const item = { ...coat, productSnapshot: product };
    expect(bagProduct(item)).toBe(product);
    expect(bagCanChooseOptions(item)).toBe(true);
  });
  it('does not show a dropdown for a confirmed one-variant product', () => {
    expect(bagCanChooseOptions(coat, bagProduct(coat))).toBe(false);
  });
  it('prefers matching live metadata, never another product snapshot', () => {
    const live = bagProduct(coat);
    expect(bagProduct(coat, live)).toBe(live);
    expect(bagProduct(coat, { ...live, id: 'other' }).id).toBe(coat.productId);
  });
});
