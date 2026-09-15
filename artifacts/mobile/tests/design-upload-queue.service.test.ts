import { beforeEach, describe, expect, it, vi } from 'vitest';

const { storage, retained, removed } = vi.hoisted(() => ({
  storage: {} as Record<string, string>,
  retained: vi.fn(async (_uri: string, queueId: string, format: 'png' | 'jpeg') =>
    `file:///documents/${queueId}.${format}`),
  removed: vi.fn(async () => {}),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage[key] ?? null),
    setItem: (key: string, value: string) => {
      storage[key] = value;
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      delete storage[key];
      return Promise.resolve();
    },
  },
}));

vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: vi.fn(),
}));

vi.mock('expo-crypto', () => ({
  randomUUID: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
}));

vi.mock('@/lib/imageDimensions', () => ({
  getImageDimensions: () => Promise.resolve({ width: 1, height: 1 }),
}));

vi.mock('@/lib/designCloudImageCache', () => ({
  cacheDesignCloudImage: vi.fn(async (_projectId: string, _objectPath: string, uri: string) => uri),
  readRetainedDesignUploadAsset: vi.fn(async (uri: string) => {
    const response = await fetch(uri);
    return response.arrayBuffer();
  }),
  retainDesignUploadAsset: retained,
  removeRetainedDesignUploadAsset: removed,
}));

import {
  drainVerifiedUploadQueue,
  initDesignService,
  syncVerifiedDesignAsset,
} from '../services/designService';
import { serviceRequest } from '@/lib/serviceConfig';
import { ApiError } from '@/lib/networkNotice';

const pngAsset = {
  uri: 'file:///cache/master.png',
  mimeType: 'image/png' as const,
  width: 2048,
  height: 2048,
  format: 'png' as const,
  lossless: true,
};

describe('verified Design Studio upload queue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.keys(storage).forEach(key => delete storage[key]);
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => Uint8Array.from([137, 80, 78, 71]).buffer,
    })));
    initDesignService(null);
    initDesignService('seller-a', 'store-a');
  });

  it('retains a failed master in its account and store scope without changing metadata', async () => {
    vi.mocked(serviceRequest).mockRejectedValueOnce(new Error('offline'));

    await expect(syncVerifiedDesignAsset('project-1', pngAsset)).resolves.toBeNull();

    const queueKey = 'bt:design:seller-a:store-a:verified-upload-queue:v1';
    const queue = JSON.parse(storage[queueKey]) as Array<{
      projectId: string;
      asset: typeof pngAsset;
    }>;
    expect(queue).toHaveLength(1);
    expect(queue[0].projectId).toBe('project-1');
    expect(queue[0].asset).toEqual({
      ...pngAsset,
      uri: 'file:///documents/123e4567-e89b-42d3-a456-426614174000.png',
    });
    expect(retained).toHaveBeenCalledWith(pngAsset.uri, expect.any(String), 'png');
    expect(storage['bt:design:seller-a:joined:verified-upload-queue:v1']).toBeUndefined();
  });

  it('retries the retained bytes and removes the app-owned file only after success', async () => {
    vi.mocked(serviceRequest)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        asset: {
          id: 'asset-1',
          projectId: 'project-1',
          kind: 'master',
          objectPath: 'design/project-1/master.png',
          downloadUrl: 'https://example.test/master.png',
          width: 2048,
          height: 2048,
          mimeType: 'image/png',
          format: 'png',
          lossless: true,
          quality: null,
          byteSize: 4,
        },
      });

    await expect(syncVerifiedDesignAsset('project-1', pngAsset)).resolves.toBeNull();
    const queueKey = 'bt:design:seller-a:store-a:verified-upload-queue:v1';
    const queuedUri = (JSON.parse(storage[queueKey]) as Array<{ asset: { uri: string } }>)[0].asset.uri;

    await drainVerifiedUploadQueue();

    expect(JSON.parse(storage[queueKey])).toEqual([]);
    expect(fetch).toHaveBeenLastCalledWith(queuedUri);
    expect(serviceRequest).toHaveBeenLastCalledWith(
      '/api/design-studio/projects/project-1/assets/master',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(ArrayBuffer),
        headers: expect.objectContaining({
          'X-Store-Context': 'store-a',
          'Content-Type': 'image/png',
          'X-Design-Width': '2048',
          'X-Design-Height': '2048',
          'X-Design-Format': 'png',
          'X-Design-Lossless': 'true',
          'X-Design-Upload-Id': '123e4567-e89b-42d3-a456-426614174000',
        }),
      }),
    );
    expect(removed).toHaveBeenCalledWith(queuedUri);
  });

  it('drops a terminal failure so later queued masters can continue', async () => {
    const queueKey = 'bt:design:seller-a:store-a:verified-upload-queue:v1';
    storage[queueKey] = JSON.stringify([
      { id: 'upload_terminal', projectId: 'deleted-project', kind: 'master', asset: { ...pngAsset, uri: 'file:///documents/terminal.png' }, queuedAt: '2026-09-15T00:00:00.000Z' },
      { id: 'upload_ready', projectId: 'ready-project', kind: 'master', asset: { ...pngAsset, uri: 'file:///documents/ready.png' }, queuedAt: '2026-09-15T00:00:01.000Z' },
    ]);
    vi.mocked(serviceRequest)
      .mockRejectedValueOnce(new ApiError(400, '{"error":"Asset bytes do not match metadata"}'))
      .mockResolvedValueOnce({
        asset: {
          id: 'asset-ready',
          projectId: 'ready-project',
          kind: 'master',
          objectPath: 'design/ready/master.png',
          downloadUrl: 'https://example.test/ready.png',
          width: 2048,
          height: 2048,
          mimeType: 'image/png',
          format: 'png',
          lossless: true,
          quality: null,
          byteSize: 4,
        },
      });

    await drainVerifiedUploadQueue();

    expect(JSON.parse(storage[queueKey])).toEqual([]);
    expect(removed).toHaveBeenCalledWith('file:///documents/terminal.png');
    expect(removed).toHaveBeenCalledWith('file:///documents/ready.png');
    expect(serviceRequest).toHaveBeenCalledTimes(2);
  });
});