/**
 * designService audit fixes: concurrent project creation never drops a
 * project, and the one-time brand-asset carry-over is really one-time.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock('@/lib/devPreview', () => ({
  isBuyerDevPreview: () => false, isPreviewDemoMode: () => false, isSellerDevPreview: () => false,
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));
vi.mock('expo-crypto', () => ({ randomUUID: () => `test-${Math.random().toString(36).slice(2)}` }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/imageDimensions', () => ({ getImageDimensions: () => Promise.resolve({ width: 1, height: 1 }) }));
vi.mock('@/lib/designCloudImageCache', () => ({
  cacheDesignCloudImage: (_p: string, _o: string, uri: string) => Promise.resolve(uri),
  readRetainedDesignUploadAsset: () => Promise.resolve(new Uint8Array()),
  removeRetainedDesignUploadAsset: () => Promise.resolve(),
  retainDesignUploadAsset: (uri: string) => Promise.resolve(uri),
}));

import { serviceRequest } from '@/lib/serviceConfig';
import { createProject, deleteBrandAsset, getBrandAssets, initDesignService } from './designService';

const request = vi.mocked(serviceRequest);

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  request.mockReset();
  initDesignService('audit-seller', 'own');
});

function projectsKey() {
  return Object.keys(store).find((k) => k.endsWith(':projects:v2'))!;
}

describe('createProject', () => {
  it('two projects created at the same time both stay in the gallery', async () => {
    let revision = 0;
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && path.startsWith('/api/design-studio/projects/')) {
        await new Promise((r) => setTimeout(r, 5));
        return { project: { ...JSON.parse(String(init.body)), cloudRevision: ++revision } } as never;
      }
      throw new Error(`unexpected ${path}`);
    });
    const [a, b] = await Promise.all([
      createProject('canvas', 'First', {}),
      createProject('canvas', 'Second', {}),
    ]);
    const stored = JSON.parse(store[projectsKey()]) as Array<{ id: string; cloudRevision?: number }>;
    expect(stored.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(stored.every((p) => typeof p.cloudRevision === 'number')).toBe(true);
  });
});

describe('brand assets carry-over', () => {
  it('does not re-upload phone assets after the seller empties the server library', async () => {
    const assetsKey = 'bt:design:audit-seller:own:brand-assets:v2';
    store[assetsKey] = JSON.stringify([
      { id: 'c1', name: 'Ink', type: 'color', color: '#111111', tags: [], createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    let server: unknown[] = [];
    request.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path !== '/api/seller/brand-assets') throw new Error(`unexpected ${path}`);
      if (init?.method === 'PUT') server = JSON.parse(String(init.body)).assets;
      return { assets: server } as never;
    });
    expect((await getBrandAssets()).map((a) => a.id)).toEqual(['c1']); // carried over once
    await deleteBrandAsset('c1'); // the seller deletes it on purpose
    expect(await getBrandAssets()).toEqual([]);
  });
});
