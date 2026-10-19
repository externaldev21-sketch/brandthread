import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  isLoaded: false,
  isSignedIn: false,
  userId: null as string | null,
  getToken: vi.fn(async () => 'token-for-test'),
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => auth }));
vi.mock('@/lib/networkNotice', () => ({
  ApiError: class extends Error {
    constructor(public status: number, public body: string) { super(body); }
  },
  reportNetworkError: vi.fn(),
  dismissNetworkNotice: vi.fn(),
}));
import { useApi } from '../api';

let renderer: ReactTestRenderer | undefined;
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  vi.unstubAllGlobals();
});

describe('useApi auth-state guard', () => {
  it('never requests a token/fetch while loading, and cannot reuse a cached token after sign-out', async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ displayName: 'Test' }) }));
    vi.stubGlobal('fetch', fetch);
    let api!: ReturnType<typeof useApi>;
    function Harness() { api = useApi(); return null; }
    await act(async () => { renderer = create(<Harness />); });
    await expect(api.seller.getProfile()).rejects.toMatchObject({ status: 401 });
    expect(auth.getToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    Object.assign(auth, { isLoaded: true, isSignedIn: true, userId: 'test-user' });
    await act(async () => renderer!.update(<Harness />));
    await api.seller.getProfile();
    expect(fetch).toHaveBeenCalledTimes(1);
    const signedInApi = api;

    // Clerk can signal signed-out before clearing userId. The previous
    // getter's token cache must not authorize another request in that gap.
    auth.isSignedIn = false;
    await act(async () => renderer!.update(<Harness />));
    expect(api).not.toBe(signedInApi);
    await expect(api.seller.getProfile()).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(auth.getToken).toHaveBeenCalledTimes(1);
  });
});
