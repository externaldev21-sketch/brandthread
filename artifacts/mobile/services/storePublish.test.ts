import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/networkNotice';

const { mem, storeApi } = vi.hoisted(() => ({
  mem: new Map<string, string>(),
  storeApi: {
    get: vi.fn(),
    save: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    saveVersion: vi.fn(),
  },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => { mem.set(k, v); },
    removeItem: async (k: string) => { mem.delete(k); },
  },
}));

vi.mock('@/lib/api', () => ({ api: { store: storeApi } }));

import { getStorefront, publishStore, unpublishStore, storefrontStorageKey } from './storeService';

let STORE_KEY: string;

async function seedPublishableStore() {
  await getStorefront();
  STORE_KEY = await storefrontStorageKey();
  const s = JSON.parse(mem.get(STORE_KEY)!);
  s.settings.storeName = 'Nova Goods';
  s.domains = [{ id: 'd1', subdomain: 'nova', isPrimary: true }];
  mem.set(STORE_KEY, JSON.stringify(s));
}

describe('publishStore', () => {
  beforeEach(async () => {
    mem.clear();
    Object.values(storeApi).forEach((fn) => fn.mockReset());
    storeApi.get.mockResolvedValue({ status: 'draft', slug: 'store-1a2b3c4d' });
    storeApi.save.mockResolvedValue({});
    storeApi.saveVersion.mockResolvedValue({});
    await seedPublishableStore();
  });

  it('reports the real server error and never marks the store live when publish fails', async () => {
    storeApi.publish.mockRejectedValue(new ApiError(403, JSON.stringify({ error: 'Your plan does not include a storefront' })));
    const result = await publishStore();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Your plan does not include a storefront');
    expect(result.message).not.toMatch(/now live/i);
    expect(JSON.parse(mem.get(STORE_KEY)!).publishStatus).not.toBe('published');
    expect(storeApi.saveVersion).not.toHaveBeenCalled();
  });

  it('fails when the server does not confirm the published status', async () => {
    storeApi.publish.mockResolvedValue({ status: 'draft' });
    const result = await publishStore();
    expect(result.success).toBe(false);
  });

  it('succeeds only after POST /api/store/publish confirms, carrying the server slug', async () => {
    storeApi.publish.mockResolvedValue({ status: 'published', slug: 'store-1a2b3c4d', publishedAt: '2026-10-17T00:00:00.000Z' });
    const result = await publishStore();
    expect(result.success).toBe(true);
    expect(result.storefront?.serverSlug).toBe('store-1a2b3c4d');
    expect(JSON.parse(mem.get(STORE_KEY)!).publishStatus).toBe('published');
  });

  it('caches the bare server slug, never "{slug}.brandthread.app"', async () => {
    const s = await getStorefront();
    expect(s.settings.storeUrl).toBe('store-1a2b3c4d');
    expect(s.serverSlug).toBe('store-1a2b3c4d');
  });

  it('unpublish propagates a server failure instead of pretending', async () => {
    storeApi.unpublish.mockRejectedValue(new ApiError(500, '{"error":"boom"}'));
    await expect(unpublishStore()).rejects.toBeInstanceOf(ApiError);
  });
});
