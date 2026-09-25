import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockServiceRequest = vi.fn();
vi.mock('../lib/serviceConfig', () => ({ serviceRequest: (...args: any[]) => mockServiceRequest(...args) }));

import { getManufacturerProducts, getManufacturerProduct, lowestTierPriceCents, tierForQuantity, type ManufacturerProduct } from './manufacturerCatalog';

const VALID_ID = 'b7d2c2d0-a3ae-4d65-90e4-d777f1f1bca1';
const PRODUCT_ID = 'c1a2b3c4-d5e6-4f78-9abc-def012345678';

beforeEach(() => { mockServiceRequest.mockReset(); });

describe('getManufacturerProducts', () => {
  it('maps catalog rows with sorted price tiers', async () => {
    mockServiceRequest.mockResolvedValue([{
      id: PRODUCT_ID, manufacturerId: VALID_ID, name: 'Heavyweight Tee', description: 'desc', category: 'Cut & Sew',
      images: ['https://x/1.jpg'], moq: 100, leadTimeDays: 20, samplePriceCents: 1500, samplePriceLabel: '$15/sample',
      customizationOptions: ['Custom labels'], status: 'active',
      priceTiers: [{ id: 't1', minQuantity: 100, maxQuantity: 499, unitPriceCents: 800 }, { id: 't2', minQuantity: 500, maxQuantity: null, unitPriceCents: 650 }],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    const products = await getManufacturerProducts(VALID_ID);
    expect(mockServiceRequest).toHaveBeenCalledWith(`/api/manufacturers/public/${VALID_ID}/products`);
    expect(products).toHaveLength(1);
    expect(products[0].priceTiers).toHaveLength(2);
    expect(products[0].priceTiers[1].maxQuantity).toBeNull();
  });

  it('rejects a non-canonical manufacturer id before calling the network', async () => {
    await expect(getManufacturerProducts('not-a-uuid')).rejects.toThrow();
    expect(mockServiceRequest).not.toHaveBeenCalled();
  });

  it('throws when the response is not an array', async () => {
    mockServiceRequest.mockResolvedValue({ oops: true });
    await expect(getManufacturerProducts(VALID_ID)).rejects.toThrow();
  });
});

describe('getManufacturerProduct', () => {
  it('returns undefined when the product does not resolve', async () => {
    mockServiceRequest.mockResolvedValue(undefined);
    expect(await getManufacturerProduct(VALID_ID, PRODUCT_ID)).toBeUndefined();
  });

  it('maps a single product with its tiers', async () => {
    mockServiceRequest.mockResolvedValue({
      id: PRODUCT_ID, manufacturerId: VALID_ID, name: 'Crewneck', description: '', category: 'Knitwear',
      images: [], moq: 50, leadTimeDays: 15, samplePriceCents: 0, samplePriceLabel: null,
      customizationOptions: [], status: 'active', priceTiers: [], createdAt: '', updatedAt: '',
    });
    const product = await getManufacturerProduct(VALID_ID, PRODUCT_ID);
    expect(product?.name).toBe('Crewneck');
  });
});

describe('lowestTierPriceCents / tierForQuantity', () => {
  const product: ManufacturerProduct = {
    id: PRODUCT_ID, manufacturerId: VALID_ID, name: 'Tee', description: '', category: '', images: [],
    moq: 100, leadTimeDays: 10, samplePriceCents: 0, samplePriceLabel: null, customizationOptions: [], status: 'active',
    priceTiers: [
      { id: 't1', minQuantity: 100, maxQuantity: 499, unitPriceCents: 800 },
      { id: 't2', minQuantity: 500, maxQuantity: null, unitPriceCents: 650 },
    ],
    createdAt: '', updatedAt: '',
  };

  it('finds the lowest tier price', () => {
    expect(lowestTierPriceCents(product)).toBe(650);
  });

  it('returns undefined for a product with no tiers', () => {
    expect(lowestTierPriceCents({ ...product, priceTiers: [] })).toBeUndefined();
  });

  it('finds the tier matching a quantity, including the unbounded top tier', () => {
    expect(tierForQuantity(product, 200)?.id).toBe('t1');
    expect(tierForQuantity(product, 10000)?.id).toBe('t2');
    expect(tierForQuantity(product, 5)).toBeUndefined();
  });
});
