import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: vi.fn(async () => 'token'), userId: 'user-1' }) }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => undefined), getAllKeys: vi.fn(async () => []), multiRemove: vi.fn(async () => undefined) },
}));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public body: string) { super(body); } },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));
vi.mock('@/lib/installId', () => ({ getInstallId: vi.fn(async () => 'install-abc') }));

import { api, configureApi } from './api';

describe('trial checkout sends the install id (one trial per device, server side)', () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ url: 'https://checkout.test' }), text: async () => '' }) as unknown as Response);
  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => 'token', () => 'user-1');
  });

  it('on Stripe checkout and on the native store sync', async () => {
    await api.seller.subscription.checkout('growth');
    await api.seller.subscription.syncNative();
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url]) => url.replace(/^.*\/seller\//, '/seller/'))).toEqual([
      '/seller/subscription/checkout', '/seller/subscription/native/sync',
    ]);
    for (const [, init] of calls) expect((init.headers as Record<string, string>)['x-bt-install-id']).toBe('install-abc');
  });

  it('other requests do not carry it', async () => {
    await api.seller.subscription.portal();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-bt-install-id']).toBeUndefined();
  });
});
