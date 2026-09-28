/**
 * Preview buy flow (dev-web preview): the seeded catalog products open a
 * real product page and go through checkout with no Stripe. vitest compiles
 * with `__DEV__: false` (a production build), so this also proves every
 * gated entry point is inert in production. The pure builders behind them
 * are tested directly.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/previewCatalog', () => ({
  isPreviewCatalogEnabled: () => false,
  getPreviewCatalog: () => [],
  getPreviewCatalogProduct: () => null,
}));

import {
  getPreviewBuyerProduct, getPreviewRelatedProducts, previewBuyerProductFromCatalog, rankPreviewRelated,
} from '@/lib/previewProducts';
import {
  buildPreviewOrder, isPreviewCheckoutGroup, isPreviewGroupShape, previewRateFor, previewShippingRate,
} from '@/lib/previewCheckout';
import { getPreviewBuyerOrder } from '@/lib/previewOrders';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'preview-product-01', productId: 'preview-product-01', sellerId: 'preview-seller-01', name: 'Sculpted Wool Coat',
  sellerDisplayName: 'Atelier Noire', category: 'Outerwear', images: ['coat.jpg'], cutoutUri: null, currentPriceCents: 48000,
  compareAtPriceCents: null, priceCents: 48000, sizes: ['XS', 'S', 'M', 'L'], claimedUnits: 0, remainingUnits: 0, demandCount: 0, tags: ['coat'],
  ...over,
}) as any;

const item = (over: Record<string, unknown> = {}) => ({
  id: 'line1', productId: 'preview-product-01', variantId: 'preview-product-01-m', productName: 'Sculpted Wool Coat',
  variantTitle: 'M', imageUri: 'coat.jpg', sellerId: 'preview-seller-01', sellerName: 'Atelier Noire', sellerHandle: '@ateliernoire',
  priceCents: 48000, quantity: 1, maxQuantity: 9, isPreOrder: false, inventoryPolicy: 'deny', isAvailable: true, addedAt: '', ...over,
}) as any;

describe('preview product page data', () => {
  it('builds a real BuyerProduct: sizes, stock, one sold-out size, About copy, real policies', () => {
    const coat = previewBuyerProductFromCatalog(row());
    expect(coat).toMatchObject({ id: 'preview-product-01', sellerId: 'preview-seller-01', sellerName: 'Atelier Noire', sellerHandle: '@ateliernoire', priceCents: 48000, isActive: true });
    expect(coat.options).toEqual([{ id: 'opt_size', name: 'Size', values: ['XS', 'S', 'M', 'L'].map(s => ({ id: `size_${s}`, label: s })) }]);
    expect(coat.variants.map(v => [v.title, v.isAvailable, v.inventoryQuantity])).toEqual([['XS', false, 0], ['S', true, 9], ['M', true, 12], ['L', true, 2]]);
    expect(coat.description).toContain('double-faced wool');
    expect(coat.description).toContain('Materials: 90% virgin wool, 10% cashmere');
    expect(coat.refundPolicy).toMatch(/14 days/);
    // Three sizes: nothing sold out.
    expect(previewBuyerProductFromCatalog(row({ sizes: ['S', 'M', 'L'] })).variants.every(v => v.isAvailable)).toBe(true);
  });

  it('"You might also like": seller first, then same category, then the rest; never itself', () => {
    const all = [
      row(),
      row({ id: 'p2', productId: 'preview-product-02', sellerId: 'preview-seller-02', name: 'Liquid Silver Dress', category: 'Dresses' }),
      row({ id: 'p5', productId: 'preview-product-05', sellerId: 'preview-seller-05', name: 'Asymmetric Layer Jacket', category: 'Outerwear', currentPriceCents: 29500, images: ['jacket.jpg'] }),
      row({ id: 'p11', productId: 'preview-product-11', sellerId: 'preview-seller-01', name: 'Wool Scarf', category: 'Accessories' }),
    ];
    expect(rankPreviewRelated(all, 'preview-product-01').map(r => r.id)).toEqual(['preview-product-11', 'preview-product-05', 'preview-product-02']);
    expect(rankPreviewRelated(all, 'preview-product-01')[1]).toMatchObject({ name: 'Asymmetric Layer Jacket', priceCents: 29500, images: ['jacket.jpg'] });
    expect(rankPreviewRelated(all, 'missing')).toEqual([]);
  });

  it('is inert in a production build and for real ids', () => {
    expect(getPreviewBuyerProduct('preview-product-01')).toBeNull();
    expect(getPreviewBuyerProduct('3f0c6a3e-real-uuid')).toBeNull();
    expect(getPreviewRelatedProducts('preview-product-01')).toEqual([]);
  });
});

describe('preview checkout', () => {
  it('only an all-preview group from a preview seller counts', () => {
    expect(isPreviewGroupShape({ sellerId: 'preview-seller-01', items: [item()] })).toBe(true);
    expect(isPreviewGroupShape({ sellerId: 'preview-seller-01', items: [item(), item({ productId: 'real-uuid' })] })).toBe(false);
    expect(isPreviewGroupShape({ sellerId: 'user_real_seller', items: [item({ sellerId: 'user_real_seller' })] })).toBe(false);
    expect(isPreviewGroupShape({ sellerId: 'preview-seller-01', items: [item({ sellerId: 'user_real_seller' })] })).toBe(false);
    expect(isPreviewGroupShape({ sellerId: 'preview-seller-01', items: [] })).toBe(false);
  });

  it('never skips Stripe in a production build — even for a preview-shaped cart', () => {
    expect(isPreviewCheckoutGroup({ sellerId: 'preview-seller-01', items: [item()] })).toBe(false);
    expect(previewShippingRate('preview-seller-01', 48000)).toBeNull();
    expect(getPreviewBuyerOrder('preview-order-01')).toBeNull();
  });

  it('shipping: $12 standard, free from $500', () => {
    expect(previewRateFor('preview-seller-01', 48000)).toEqual({ id: 'seller_rate_preview-seller-01', name: 'Standard shipping', amountCents: 1200 });
    expect(previewRateFor('preview-seller-01', 50000)).toEqual({ id: 'seller_rate_preview-seller-01', name: 'Free shipping', amountCents: 0 });
  });

  it('placing an order: paid with no charge, in GET /api/buyer/orders/:id shape', () => {
    const { record, result } = buildPreviewOrder({
      group: { sellerId: 'preview-seller-01', sellerName: 'Atelier Noire', items: [item({ quantity: 2 })] },
      shippingCents: 1200,
      contact: { email: 'jordan@example.com' },
      address: { firstName: 'Jordan', lastName: 'Reyes', line1: '148 Mercer Street', city: 'New York', state: 'NY', postalCode: '10012' },
    }, Date.UTC(2026, 8, 28, 15), 1);
    expect(result).toMatchObject({ paymentStatus: 'paid', amountTotal: 97200 });
    expect(result.orderId).toMatch(/^preview-order-/);
    expect(result.orderNumber).toMatch(/^BT-\d{5}$/);
    expect(record).toMatchObject({
      id: result.orderId, orderNumber: result.orderNumber, ownerId: 'preview-seller-01', sellerDisplayName: 'Atelier Noire',
      status: 'pending', stripePaymentIntentId: null, subtotalCents: 96000, shippingCents: 1200, totalCents: 97200,
      shippingAddress: { name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
    });
    expect((record.items as any[])[0]).toMatchObject({ productName: 'Sculpted Wool Coat', variantLabel: 'M', quantity: 2, priceCents: 48000 });
  });
});
