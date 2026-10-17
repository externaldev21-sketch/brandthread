import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mem, serviceRequest } = vi.hoisted(() => ({
  mem: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => { mem.set(k, v); },
    removeItem: async (k: string) => { mem.delete(k); },
    multiRemove: async (ks: string[]) => { ks.forEach((k) => mem.delete(k)); },
    getAllKeys: async () => [...mem.keys()],
    multiGet: async (ks: string[]) => ks.map((k) => [k, mem.get(k) ?? null]),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false, isSellerDevPreview: () => false }));

import { createProduct, getProduct, getProducts, initProductService } from '../productService';

const SERVER_ID = '3f2b8a5e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
let userN = 0;

describe('productService reads the server catalog', () => {
  beforeEach(() => {
    mem.clear();
    serviceRequest.mockReset();
    initProductService(`user_${++userN}`); // fresh cache per test
  });

  it('Products list includes products published on the server plus local drafts', async () => {
    serviceRequest.mockResolvedValue([
      { id: SERVER_ID, name: 'Published Tee', status: 'active', createdAt: '2026-10-01T00:00:00.000Z', minPriceCents: 3000, totalStock: 4 },
    ]);
    await createProduct({ name: 'Local Draft' });
    const list = await getProducts();
    expect(list.map((p) => p.name).sort()).toEqual(['Local Draft', 'Published Tee']);
    expect(serviceRequest).toHaveBeenCalledWith('/api/products', {}, false);
    expect((await getProducts({ filter: 'active' })).map((p) => p.name)).toEqual(['Published Tee']);
  });

  it('propagates a server failure when there is nothing on the device', async () => {
    serviceRequest.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    await expect(getProducts()).rejects.toThrow('boom');
  });

  it('View product loads a server product by id via the owner endpoint', async () => {
    serviceRequest.mockResolvedValue({
      id: SERVER_ID, name: 'Published Tee', status: 'active',
      variants: [{ id: 'v1', size: 'M', sku: 'T-M', priceCents: 3000, stock: 4 }],
    });
    const p = await getProduct(SERVER_ID);
    expect(serviceRequest).toHaveBeenCalledWith(`/api/products/${SERVER_ID}`, {}, false);
    expect(p?.name).toBe('Published Tee');
    expect(p?.variants).toHaveLength(1);
  });

  it('returns undefined (not found) for a 404, without hitting the server for device ids', async () => {
    serviceRequest.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    expect(await getProduct(SERVER_ID)).toBeUndefined();
    serviceRequest.mockClear();
    expect(await getProduct('prod_missing1')).toBeUndefined();
    expect(serviceRequest).not.toHaveBeenCalled();
  });
});
