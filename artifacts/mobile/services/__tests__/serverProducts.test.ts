import { describe, expect, it } from 'vitest';
import { isServerProductId, mapServerProduct, mergeServerAndLocalProducts } from '../serverProducts';

const ID = '3f2b8a5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';

describe('mapServerProduct', () => {
  it('maps a GET /api/products list row', () => {
    const p = mapServerProduct({
      id: ID, name: 'Boxy Tee', category: 'apparel', status: 'active',
      images: ['https://cdn/x.jpg'], tags: ['tee'], createdAt: '2026-10-01T00:00:00.000Z',
      totalStock: 12, minPriceCents: 4500,
    });
    expect(p.id).toBe(ID);
    expect(p.status).toBe('active');
    expect(p.pricing.priceCents).toBe(4500);
    expect(p.inventory.totalStock).toBe(12);
    expect(p.media[0]).toMatchObject({ uri: 'https://cdn/x.jpg', isCover: true });
    expect(p.category).toBe('Other');
  });

  it('maps a GET /api/products/:id detail row with variants', () => {
    const p = mapServerProduct({
      id: ID, ownerId: 'user_1', name: 'Hoodie', category: 'Hoodie', status: 'draft',
      variants: [
        { id: 'v1', size: 'M', color: 'Black', sku: 'H-M', priceCents: 9000, stock: 3, lowStockThreshold: 2 },
        { id: 'v2', size: 'L', sku: 'H-L', priceCents: 8000, stock: 4 },
      ],
    });
    expect(p.sellerId).toBe('user_1');
    expect(p.category).toBe('Hoodie');
    expect(p.variants.map((v) => v.title)).toEqual(['M / Black', 'L']);
    expect(p.pricing.priceCents).toBe(8000);
    expect(p.inventory.totalStock).toBe(7);
    expect(p.inventory.lowStockThreshold).toBe(2);
  });

  it('never invents values for unknown fields', () => {
    const p = mapServerProduct({ id: ID, status: 'weird' });
    expect(p.status).toBe('draft');
    expect(p.pricing.priceCents).toBe(0);
    expect(p.totalSales).toBe(0);
  });
});

describe('mergeServerAndLocalProducts', () => {
  it('keeps device-only drafts and lets server rows win on id clash', () => {
    const server = [mapServerProduct({ id: ID, name: 'Server', createdAt: '2026-10-02T00:00:00.000Z' })];
    const local = [
      { ...server[0], name: 'Stale local copy' },
      { ...mapServerProduct({ id: 'prod_abc123xyz', name: 'Local draft', createdAt: '2026-10-03T00:00:00.000Z' }) },
    ];
    const merged = mergeServerAndLocalProducts(server, local);
    expect(merged.map((p) => p.name)).toEqual(['Local draft', 'Server']);
  });
});

describe('isServerProductId', () => {
  it('distinguishes server UUIDs from device ids', () => {
    expect(isServerProductId(ID)).toBe(true);
    expect(isServerProductId('prod_abc123xyz')).toBe(false);
  });
});
