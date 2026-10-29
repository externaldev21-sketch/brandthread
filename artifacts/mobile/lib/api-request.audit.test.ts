import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default } }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ getToken: vi.fn(async () => 'token'), userId: 'user-1' }) }));
const storage = vi.hoisted(() => ({
  getItem: vi.fn(async () => null),
  setItem: vi.fn(async () => undefined),
  getAllKeys: vi.fn(async () => [] as string[]),
  multiRemove: vi.fn(async () => undefined),
  removeItem: vi.fn(async () => undefined),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class ApiError extends Error { constructor(public status: number, public body: string) { super(body); } },
  dismissNetworkNotice: vi.fn(),
  reportNetworkError: vi.fn(),
}));

import { api, configureApi } from './api';

function noContent(): Response {
  return {
    ok: true,
    status: 204,
    json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    text: async () => '',
  } as unknown as Response;
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

describe('request(): 204 No Content', () => {
  beforeEach(() => {
    storage.multiRemove.mockClear();
    storage.getAllKeys.mockResolvedValue(['bt:api-cache:v1:user-1:joined:%2Fapi%2Fv1%2Fbuyer%2Faddresses']);
    configureApi(async () => 'token', () => 'user-1');
  });

  it('resolves a successful DELETE /api/buyer/addresses/:id (server answers 204) instead of throwing', async () => {
    const fetchMock = vi.fn(async () => noContent());
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.buyer.addresses.delete('addr-1')).resolves.toBeUndefined();
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
    // The write still drops this account's cached reads (the address list).
    expect(storage.multiRemove).toHaveBeenCalledWith(['bt:api-cache:v1:user-1:joined:%2Fapi%2Fv1%2Fbuyer%2Faddresses']);
  });

  it('resolves the 204 seller/first-run writes (dismiss, milestone seen, tip seen)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => noContent()));
    await expect(api.seller.launchChecklist.dismiss()).resolves.toBeUndefined();
    await expect(api.seller.milestones.seen('first_sale')).resolves.toBeUndefined();
    await expect(api.firstRunTips.markSeen('feed-swipe')).resolves.toBeUndefined();
  });
});

describe('request(): in-flight GET dedupe is per account', () => {
  it("a new account's GET never joins the previous account's in-flight request", async () => {
    let releaseFirst!: (r: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { releaseFirst = resolve; }))
      .mockImplementationOnce(async () => jsonResponse({ id: 'user-2' }));
    vi.stubGlobal('fetch', fetchMock);

    configureApi(async () => 'token-1', () => 'user-1');
    const first = api.auth.me();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Account switch while user-1's request is still pending.
    configureApi(async () => 'token-2', () => 'user-2');
    const second = api.auth.me();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    releaseFirst(jsonResponse({ id: 'user-1' }));

    await expect(first).resolves.toEqual({ id: 'user-1' });
    await expect(second).resolves.toEqual({ id: 'user-2' });
    const auth = (call: unknown) => ((call as [string, RequestInit])[1].headers as Record<string, string>).Authorization;
    expect(auth(fetchMock.mock.calls[0])).toBe('Bearer token-1');
    expect(auth(fetchMock.mock.calls[1])).toBe('Bearer token-2');
  });

  it("does not send the previous session's cached bearer after configureApi (sign-out / switch)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => 'token-a', () => 'user-a');
    await api.auth.sessions();
    configureApi(async () => 'token-b', () => 'user-b');
    await api.auth.sessions();
    const auth = (call: unknown) => ((call as [string, RequestInit])[1].headers as Record<string, string>).Authorization;
    expect(auth(fetchMock.mock.calls[0])).toBe('Bearer token-a');
    expect(auth(fetchMock.mock.calls[1])).toBe('Bearer token-b');
  });

  it('still shares one network call for the same account', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'user-3' }));
    vi.stubGlobal('fetch', fetchMock);
    configureApi(async () => 'token-3', () => 'user-3');
    const [a, b] = await Promise.all([api.auth.me(), api.auth.me()]);
    expect(a).toEqual({ id: 'user-3' });
    expect(b).toEqual({ id: 'user-3' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
