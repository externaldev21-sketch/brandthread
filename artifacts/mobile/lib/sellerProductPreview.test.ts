import { describe, expect, it } from 'vitest';
import type { Product } from '@/services/productTypes';
import {
  isOwnerPreviewRow,
  localPreviewSaves,
  previewAsBuyerHref,
  sellerProductToBuyerProduct,
} from './sellerProductPreview';

function product(over: Partial<Product> = {}): Product {
  return {
    id: 'prod_abc123',
    sellerId: '',
    name: 'Boxy Tee',
    description: 'Heavyweight cotton.',
    category: 'tops',
    tags: ['tee'],
    media: [
      { id: 'm2', type: 'image', uri: 'file:///b.jpg', isCover: false, sortOrder: 1, createdAt: '' },
      { id: 'm1', type: 'image', uri: 'file:///a.jpg', isCover: true, sortOrder: 0, createdAt: '' },
    ],
    pricing: { priceCents: 4500, currency: 'USD' },
    options: [],
    variants: [],
    inventory: { totalStock: 7, lowStockThreshold: 2, policy: 'deny' },
    salesModel: 'pre-made',
    status: 'draft',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    totalSales: 0,
    totalRevenueCents: 0,
    ...over,
  } as unknown as Product;
}

describe('previewAsBuyerHref', () => {
  it('opens the server product for a signed-in seller', () => {
    expect(previewAsBuyerHref('8f1e', { signedIn: true })).toBe('/buyer-product-detail?productId=8f1e');
  });
  it('opens the device-stored product when signed out or for a seeded demo product', () => {
    expect(previewAsBuyerHref('prod_abc', { signedIn: false })).toBe('/buyer-product-detail?productId=prod_abc&localPreview=1');
    expect(previewAsBuyerHref('preview-product-3', { signedIn: true })).toBe('/buyer-product-detail?productId=preview-product-3&localPreview=1');
  });
});

describe('isOwnerPreviewRow', () => {
  it('is true only for the server previewOnly flag', () => {
    expect(isOwnerPreviewRow({ previewOnly: true })).toBe(true);
    expect(isOwnerPreviewRow({ previewOnly: 'true' })).toBe(false);
    expect(isOwnerPreviewRow({})).toBe(false);
    expect(isOwnerPreviewRow(null)).toBe(false);
  });
});

describe('localPreviewSaves', () => {
  it('keeps products saved on this device and drops the seeded demo catalog', () => {
    const list = [product({ id: 'prod_saved' }), product({ id: 'preview-product-1' })];
    expect(localPreviewSaves(list).map((p) => p.id)).toEqual(['prod_saved']);
  });
});

describe('sellerProductToBuyerProduct', () => {
  it('builds a single default variant from product-level stock, cover photo first', () => {
    const b = sellerProductToBuyerProduct(product());
    expect(b.imageUris).toEqual(['file:///a.jpg', 'file:///b.jpg']);
    expect(b.variants).toHaveLength(1);
    expect(b.variants[0]).toMatchObject({ priceCents: 4500, inventoryQuantity: 7, isAvailable: true, optionValues: [] });
    expect(b.isActive).toBe(false);
    expect(b.sellerName).toBe('Your store');
  });

  it('maps options and variants', () => {
    const b = sellerProductToBuyerProduct(product({
      status: 'active',
      options: [{ id: 'o1', type: 'size', name: 'Size', sortOrder: 0, values: [{ id: 's', value: 'S' }, { id: 'm', value: 'M' }] }],
      variants: [
        { id: 'v1', title: 'S', optionValues: [{ optionId: 'o1', valueId: 's' }], inventoryQuantity: 0 },
        { id: 'v2', title: 'M', optionValues: [{ optionId: 'o1', valueId: 'm' }], inventoryQuantity: 3, priceCents: 5000 },
      ] as unknown as Product['variants'],
    }));
    expect(b.options).toEqual([{ id: 'o1', name: 'Size', values: [{ id: 's', label: 'S' }, { id: 'm', label: 'M' }] }]);
    expect(b.variants.map((v) => [v.id, v.priceCents, v.isAvailable])).toEqual([['v1', 4500, false], ['v2', 5000, true]]);
    expect(b.isActive).toBe(true);
  });
});
