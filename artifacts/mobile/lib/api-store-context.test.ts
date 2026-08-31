import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  getAllKeys: vi.fn(async () => [] as string[]),
  multiRemove: vi.fn(async () => undefined),
}));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'token'), userId: 'user-1' }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storage,
}));

vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error {
    constructor(public status: number, public body: string) {
      super(body);
    }
  },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));

import {
  api,
  configureApi,
  setStoreContext,
  storeContextHeaders,
  storeContextStorageKey,
} from './api';

describe('explicit store context propagation', () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('file://')) {
      return {
        ok: true,
        blob: async () => new Blob(['media'], { type: 'application/octet-stream' }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => (
        url.includes('/avatar/upload')
          ? { profileImageUrl: 'https://example.test/avatar.jpg' }
          : url.includes('/video-clips')
            ? { objectPath: 'clips/one.mp4', contentType: 'video/mp4', size: 5 }
            : { role: 'manager' }
      ),
      text: async () => '',
      requestInit: init,
    } as unknown as Response;
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => 'token', () => 'user-1');
  });

  afterEach(() => {
    setStoreContext(null);
    vi.unstubAllGlobals();
  });

  it('uses the selected membership for JSON, image, and video requests', async () => {
    const membershipId = '11111111-1111-4111-8111-111111111111';
    setStoreContext(membershipId);

    await api.team.context();
    await api.seller.uploadAvatar({ uri: 'file://avatar.jpg', mimeType: 'image/jpeg' });
    await api.posts.uploadVideoClip('file://clip.mp4', 'video/mp4');

    const networkCalls = fetchMock.mock.calls.filter(([input]) => !String(input).startsWith('file://'));
    expect(networkCalls).toHaveLength(3);
    for (const [, init] of networkCalls) {
      expect((init?.headers as Record<string, string>)['X-Store-Context']).toBe(membershipId);
    }
  });

  it('keeps persistence account-scoped and omits the legacy joined header', () => {
    expect(storeContextStorageKey('user-1')).toBe('@brandthread/store_context:user-1');

    setStoreContext('joined');
    expect(storeContextHeaders()).toEqual({});

    setStoreContext('own');
    expect(storeContextHeaders()).toEqual({ 'X-Store-Context': 'own' });
  });
});