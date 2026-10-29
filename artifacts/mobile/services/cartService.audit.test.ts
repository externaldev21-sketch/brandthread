/**
 * cartService audit fixes: the "already in your bag" copy, and the sync
 * marker is never cleared for a bag the server has not received.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { serviceRequest } = vi.hoisted(() => ({ serviceRequest: vi.fn() }));
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
    removeItem: vi.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    multiRemove: vi.fn((keys: string[]) => { keys.forEach(k => store.delete(k)); return Promise.resolve(); }),
    getAllKeys: vi.fn(() => Promise.resolve(Array.from(store.keys()))),
  },
}));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('@/lib/marketingPixels', () => ({ trackAndRelayConversionEvent: vi.fn(() => false) }));

import { addToCart, clearCartCache, getCartForScreen, initCartService } from './cartService';
import type { BuyerProduct, BuyerProductVariant } from './cartTypes';

const product = (id: string): BuyerProduct => ({
  id, sellerId: 's', sellerName: 'Seller', sellerHandle: '@s', name: `Product ${id}`, description: '', priceCents: 2000,
  imageUris: [], category: 'Apparel', isPreOrder: false, cancellationPolicy: '', refundPolicy: '', options: [], variants: [],
  isActive: true, tags: [],
});
const variant = (id: string, inventoryQuantity = 10): BuyerProductVariant => ({
  id: `variant-${id}`, title: 'M', optionValues: [], priceCents: 2000, inventoryQuantity, isAvailable: true,
});

beforeEach(async () => {
  store.clear();
  serviceRequest.mockReset();
  initCartService('audit-user');
  await clearCartCache('audit-user');
});
afterEach(() => { vi.useRealTimers(); });

describe('addToCart copy', () => {
  it('puts a space between the count and "in your bag"', async () => {
    serviceRequest.mockResolvedValue({ items: [], savedItems: [] });
    await addToCart({ product: product('a'), variant: variant('a', 2), quantity: 2 });
    const result = await addToCart({ product: product('a'), variant: variant('a', 2), quantity: 1 });
    expect(result.success).toBe(false);
    expect(result.message).toBe("You already have 2 in your bag. Can't add more.");
  });
});

describe('write-through sync marker', () => {
  it('a second add in the same millisecond as an in-flight sync still reaches the server', async () => {
    // Every write gets the same updatedAt (a fast double tap).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T12:00:00.000Z'));
    let server: { items: any[]; savedItems: any[] } = { items: [], savedItems: [] };
    let releaseFirstSync!: () => void;
    let syncs = 0;
    serviceRequest.mockImplementation(async (path: string, init?: { body?: string }) => {
      if (path === '/api/buyer/cart/sync') {
        syncs += 1;
        const body = JSON.parse(init!.body!);
        if (syncs === 1) await new Promise<void>((r) => { releaseFirstSync = r; });
        server = body;
        return { ok: true };
      }
      return server;
    });
    await addToCart({ product: product('a'), variant: variant('a'), quantity: 1 });
    // Let the first sync reach the network without moving the (frozen) clock.
    for (let i = 0; i < 100 && !releaseFirstSync; i++) await Promise.resolve();
    expect(releaseFirstSync).toBeTypeOf('function');
    await addToCart({ product: product('b'), variant: variant('b'), quantity: 1 });
    releaseFirstSync();
    await getCartForScreen(); // waits for the queued syncs
    expect(server.items.map((i: any) => i.productId).sort()).toEqual(['a', 'b']);
  });
});
