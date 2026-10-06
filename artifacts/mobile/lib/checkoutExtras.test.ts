import { describe, expect, it } from 'vitest';
import {
  EMPTY_TRACKING, OFFER_DISCOUNT_STEPS, nextDiscountStep, offerOrderId, offerPriceCents, offerableProducts,
  trackingFieldError, trackingPatchFor, trackingSummary,
} from './checkoutExtras';

describe('post-purchase offer helpers', () => {
  it('prices like the server (half-up, capped at 50%)', () => {
    expect(offerPriceCents(6_000, 20)).toBe(4_800);
    expect(offerPriceCents(1_999, 15)).toBe(1_699);
    expect(offerPriceCents(1_000, 80)).toBe(500);
    expect(Math.max(...OFFER_DISCOUNT_STEPS)).toBe(50);
    expect(nextDiscountStep(50)).toBe(0);
    expect(nextDiscountStep(0)).toBe(5);
  });

  it('offers only active, in-stock products from the API or the local store', () => {
    const api = [
      { id: 'a', name: 'Tee', status: 'active', images: ['https://img/a.jpg'], variants: [{ priceCents: 3000, stock: 2 }, { priceCents: 2800, stock: 0 }] },
      { id: 'b', name: 'Cap', status: 'draft', variants: [{ priceCents: 1000, stock: 5 }] },
      { id: 'c', name: 'Bag', status: 'active', variants: [{ priceCents: 5000, stock: 0 }] },
      { id: 'd', name: 'Gone', status: 'active', deletedAt: '2026-01-01', variants: [{ priceCents: 5000, stock: 3 }] },
    ];
    expect(offerableProducts(api)).toEqual([{ id: 'a', name: 'Tee', image: 'https://img/a.jpg', priceCents: 2800, inStock: true }]);
    const local = [{
      id: 'l1', name: 'Hoodie', status: 'active', media: [{ uri: 'file://h.jpg' }], pricing: { priceCents: 6500 },
      inventory: { availableStock: 4 }, variants: [{ inventoryQuantity: 4 }],
    }];
    expect(offerableProducts({ products: local })).toEqual([{ id: 'l1', name: 'Hoodie', image: 'file://h.jpg', priceCents: 6500, inStock: true }]);
    expect(offerableProducts(null)).toEqual([]);
  });

  it('shows the offer only for a single-seller checkout', () => {
    expect(offerOrderId([{ id: 'o1' }], 1)).toBe('o1');
    expect(offerOrderId([{ id: 'o1' }, { id: 'o2' }], 2)).toBeNull();
    expect(offerOrderId([], 1)).toBeNull();
  });
});

describe('conversion tracking helpers', () => {
  it('checks formats the way the server does', () => {
    expect(trackingFieldError('metaPixelId', '123456789012345')).toBeNull();
    expect(trackingFieldError('metaPixelId', '12ab')).toMatch(/10–20 digits/);
    expect(trackingFieldError('ga4MeasurementId', 'g-abc1234')).toBeNull();
    expect(trackingFieldError('ga4MeasurementId', 'UA-123-1')).toMatch(/G-/);
    expect(trackingFieldError('tiktokPixelId', 'cabcd1234efgh5678ijk')).toBeNull();
    expect(trackingFieldError('metaAccessToken', '')).toBeNull();
  });

  it('never sends an untouched secret, and clears both values on disconnect', () => {
    expect(trackingPatchFor('meta', { id: ' 123456789012345 ', secret: '' })).toEqual({ metaPixelId: '123456789012345' });
    expect(trackingPatchFor('ga4', { id: 'g-abc123', secret: ' secret_value_123456 ' })).toEqual({ ga4MeasurementId: 'G-ABC123', ga4ApiSecret: 'secret_value_123456' });
    expect(trackingPatchFor('tiktok', { id: 'X', secret: 'Y' }, true)).toEqual({ tiktokPixelId: null, tiktokAccessToken: null });
  });

  it('summarises the connected providers', () => {
    expect(trackingSummary(EMPTY_TRACKING)).toBe('Not connected');
    expect(trackingSummary({ ...EMPTY_TRACKING, activeProviders: ['meta', 'ga4'] })).toBe('Meta Pixel, Google Analytics 4');
  });
});
