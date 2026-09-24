import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: async () => null, userId: null }),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    getAllKeys: vi.fn(async () => [] as string[]),
    multiRemove: vi.fn(async () => undefined),
  },
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

import { api, configureApi } from './api';

describe('api.discover.feed', () => {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => ({
    ok: true,
    json: async () => ({
      items: [],
      computedAt: '2026-01-01T00:00:00.000Z',
      source: 'empty',
      nextOffset: null,
    }),
    text: async () => '',
    requestInit: init,
    _url: String(input),
  } as unknown as Response));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => null, () => 'anonymous');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls GET /api/public/discover/feed with limit and offset query params', async () => {
    await api.discover.feed({ limit: 20, offset: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/public/discover/feed');
    expect(String(url)).toContain('limit=20');
    expect(String(url)).toContain('offset=0');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
  });

  it('defaults limit to 20 and offset to 0 when called with no args', async () => {
    await api.discover.feed();

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('limit=20');
    expect(String(url)).toContain('offset=0');
  });

  it('paginates by passing through a non-zero offset', async () => {
    await api.discover.feed({ limit: 20, offset: 20 });

    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('offset=20');
  });

  it('returns the response shape unchanged (items, computedAt, source, nextOffset)', async () => {
    const result = await api.discover.feed({ limit: 20, offset: 0 });
    expect(result).toEqual({
      items: [],
      computedAt: '2026-01-01T00:00:00.000Z',
      source: 'empty',
      nextOffset: null,
    });
  });
});
