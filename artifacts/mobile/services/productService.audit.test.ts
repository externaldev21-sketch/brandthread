import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, serviceRequest } = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  serviceRequest: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
    multiGet: vi.fn(async (keys: string[]) => keys.map((key) => [key, storage.get(key) ?? null])),
    multiSet: vi.fn(async (pairs: [string, string][]) => { pairs.forEach(([k, v]) => storage.set(k, v)); }),
    multiRemove: vi.fn(async (keys: string[]) => { keys.forEach((k) => storage.delete(k)); }),
    getAllKeys: vi.fn(async () => [...storage.keys()]),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('@/lib/devPreview', () => ({ isPreviewDemoMode: () => false }));

import { adjustInventory, adjustVariantStock, getProducts, initProductService } from './productService';

const SERVER_ID = '11111111-2222-4333-8444-555555555555';
const serverRow = {
  id: SERVER_ID, name: 'Server Tee', status: 'active',
  variants: [{ id: 'v1', size: 'M', stock: 4, priceCents: 2000 }],
};

let seller = 0;

describe('productService (audit)', () => {
  beforeEach(() => {
    storage.clear();
    serviceRequest.mockReset();
    // Fresh account each test so the 3s server-list cache never carries over.
    initProductService(`seller-audit-${++seller}`);
  });

  it('does not report a stock adjustment when nothing was saved (server-only product)', async () => {
    serviceRequest.mockImplementation(async (path: string) => (path === `/api/products/${SERVER_ID}` ? serverRow : []));
    expect(await adjustVariantStock(SERVER_ID, 'v1', 3, 'Restock')).toBeUndefined();
    expect(await adjustInventory(SERVER_ID, undefined, 3, 'Restock')).toBeUndefined();
  });

  it('reads every page of the seller catalog, not only the first 100 products', async () => {
    const row = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name: `P${n}`, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' });
    const all = Array.from({ length: 105 }, (_, i) => row(i));
    serviceRequest.mockImplementation(async (path: string) => {
      if (path === '/api/products') return all.slice(0, 100);
      if (path === '/api/products?offset=100') return all.slice(100);
      return [];
    });
    const list = await getProducts();
    expect(list).toHaveLength(105);
    expect(serviceRequest).toHaveBeenCalledWith('/api/products', {}, false);
  });
});
