/**
 * Signed-out web preview: Design Studio's gallery must read local (or
 * demo-seeded) projects only and never call the protected cloud API, which
 * can only 401 there (or stall the gallery waiting on services config).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('react-native', () => ({
  Platform: { OS: 'web', select: (obj: Record<string, unknown>) => obj.web ?? obj.default },
}));

const store: Record<string, string> = {};
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(store[key] ?? null),
    setItem: (key: string, value: string) => { store[key] = value; return Promise.resolve(); },
    removeItem: (key: string) => { delete store[key]; return Promise.resolve(); },
  },
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => `test-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/lib/imageDimensions', () => ({
  getImageDimensions: () => Promise.resolve({ width: 1, height: 1 }),
}));
vi.mock('@/lib/designCloudImageCache', () => ({
  cacheDesignCloudImage: (_p: string, _o: string, uri: string) => Promise.resolve(uri),
  readRetainedDesignUploadAsset: () => Promise.resolve(new Uint8Array()),
  removeRetainedDesignUploadAsset: () => Promise.resolve(),
  retainDesignUploadAsset: (uri: string) => Promise.resolve(uri),
}));

const preview = { seller: true, demo: false };
vi.mock('@/lib/devPreview', () => ({
  isSellerDevPreview: () => preview.seller,
  isBuyerDevPreview: () => false,
  isPreviewDemoMode: () => preview.demo,
}));

import { getProjects, initDesignService } from '../services/designService';
import { serviceRequest } from '@/lib/serviceConfig';

describe('designService.getProjects — signed-out web preview', () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
    vi.mocked(serviceRequest).mockReset();
    initDesignService(null);
  });

  it('fresh preview: resolves to an empty list without calling the API', async () => {
    preview.demo = false;
    expect(await getProjects()).toEqual([]);
    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it('demo preview: returns the demo seed projects without calling the API', async () => {
    preview.demo = true;
    const projects = await getProjects();
    expect(projects.length).toBeGreaterThan(0);
    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it('outside the preview, a signed-out session still goes through cloud sync', async () => {
    preview.seller = false;
    preview.demo = false;
    vi.mocked(serviceRequest).mockResolvedValue({ projects: [] } as never);
    await getProjects();
    expect(serviceRequest).toHaveBeenCalled();
    preview.seller = true;
  });
});
