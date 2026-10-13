import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const notice = vi.hoisted(() => ({ reportNetworkError: vi.fn(), dismissNetworkNotice: vi.fn() }));

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }));

vi.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'token'), userId: 'user-1' }),
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
  dismissNetworkNotice: notice.dismissNetworkNotice,
  reportNetworkError: notice.reportNetworkError,
}));

import { api, configureApi } from './api';

const ok = () => ({ ok: true, status: 200, json: async () => ({ role: 'owner' }), text: async () => '' }) as unknown as Response;
const fail = (status: number) => ({ ok: false, status, headers: new Headers(), text: async () => '{}' }) as unknown as Response;

describe('quiet auto-retry for reads', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    notice.reportNetworkError.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => 'token', () => 'user-1');
  });

  afterEach(() => vi.unstubAllGlobals());

  it('retries a dropped connection once and never tells the user', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed')).mockResolvedValueOnce(ok());
    await expect(api.team.context()).resolves.toEqual({ role: 'owner' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notice.reportNetworkError).not.toHaveBeenCalled();
  });

  it('retries a 503 once, then reports the second failure', async () => {
    fetchMock.mockResolvedValue(fail(503));
    await expect(api.team.context()).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notice.reportNetworkError).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 404', async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(api.team.context()).rejects.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
