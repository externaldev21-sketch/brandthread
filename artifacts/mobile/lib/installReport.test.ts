import { describe, expect, it, vi } from 'vitest';
import { INSTALL_STORAGE_KEY, fallbackUuid, loadInstall, parseInstallState, reportInstall, type InstallDeps } from './installReport';

function deps(over: Partial<InstallDeps> = {}) {
  const store = new Map<string, string>();
  const calls: { url: string; init: RequestInit }[] = [];
  const d: InstallDeps = {
    storage: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } },
    fetchImpl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return { ok: true } as Response; }) as unknown as typeof fetch,
    apiBase: 'https://api.example.test/',
    newId: () => '0F8FAD5B-D9CB-469F-A165-70867728950E',
    platform: 'ios',
    appVersion: '1.2.0',
    ...over,
  };
  return { d, store, calls };
}

describe('installReport', () => {
  it('creates the install once and reports it signed out', async () => {
    const { d, store, calls } = deps();
    const first = await loadInstall(d);
    expect(first.isNew).toBe(true);
    expect(first.state.id).toBe('0f8fad5b-d9cb-469f-a165-70867728950e');
    expect((await loadInstall(d)).isNew).toBe(false);

    const reported = await reportInstall(d, first.state, null);
    expect(reported).toMatchObject({ reported: true, linked: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.example.test/api/app/installs');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ installId: first.state.id, platform: 'ios', appVersion: '1.2.0' });
    expect(parseInstallState(store.get(INSTALL_STORAGE_KEY)!)).toEqual(reported);

    // Nothing more to send until a sign-in.
    await reportInstall(d, reported, null);
    expect(calls).toHaveLength(1);
  });

  it('links the account once after sign-in', async () => {
    const { d, calls } = deps();
    const { state } = await loadInstall(d);
    const linked = await reportInstall(d, { ...state, reported: true }, 'tok');
    expect(linked.linked).toBe(true);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    await reportInstall(d, linked, 'tok');
    expect(calls).toHaveLength(1);
  });

  it('keeps the state unchanged when the request fails, so a later launch retries', async () => {
    const { d } = deps({ fetchImpl: (async () => { throw new Error('offline'); }) as unknown as typeof fetch });
    const { state } = await loadInstall(d);
    expect(await reportInstall(d, state, null)).toEqual(state);
    const { d: d2 } = deps({ fetchImpl: (async () => ({ ok: false }) as Response) as unknown as typeof fetch });
    expect(await reportInstall(d2, state, 'tok')).toEqual(state);
  });

  it('ignores corrupt stored state and starts a fresh install', async () => {
    expect(parseInstallState('{"id":"nope"}')).toBeNull();
    expect(parseInstallState('not json')).toBeNull();
    const newId = vi.fn(() => fallbackUuid(() => 0.5));
    const { d, store } = deps({ newId });
    store.set(INSTALL_STORAGE_KEY, 'garbage');
    expect((await loadInstall(d)).isNew).toBe(true);
    expect(newId).toHaveBeenCalledOnce();
  });

  it('makes RFC 4122 v4 ids without expo-crypto', () => {
    expect(fallbackUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
