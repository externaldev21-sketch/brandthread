import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); return Promise.resolve(); }),
  },
}));

import {
  markTipSeen,
  readLocalFirstRunTipsState,
  replayAllTips,
  setSkipAllTips,
  syncFirstRunTipsFromServer,
} from './storage';

/** A fake server, like the real first_run_tips_seen / first_run_tips_settings tables. */
function makeServer() {
  const seenByUser = new Map<string, Set<string>>();
  const skipAllByUser = new Map<string, boolean>();
  const api = {
    firstRunTips: {
      get: vi.fn(async () => ({
        seenTipIds: [...(seenByUser.get('user_123') ?? [])],
        skipAll: skipAllByUser.get('user_123') ?? false,
      })),
      markSeen: vi.fn(async (tipId: string) => {
        const set = seenByUser.get('user_123') ?? new Set<string>();
        set.add(tipId);
        seenByUser.set('user_123', set);
      }),
      skipAll: vi.fn(async () => { skipAllByUser.set('user_123', true); }),
      reset: vi.fn(async () => { seenByUser.set('user_123', new Set()); skipAllByUser.set('user_123', false); }),
    },
  };
  return { api, seenByUser, skipAllByUser };
}

describe('First-run tips persistence — local cache + server reconcile', () => {
  beforeEach(() => { store.clear(); });

  it('starts empty for a brand-new account (no local cache, no server call)', async () => {
    const state = await readLocalFirstRunTipsState('user_123');
    expect(state.seenIds.size).toBe(0);
    expect(state.skipAll).toBe(false);
  });

  it('syncFirstRunTipsFromServer pulls server state and writes it into the local cache', async () => {
    const { api, seenByUser } = makeServer();
    seenByUser.set('user_123', new Set(['seller-dashboard']));

    const synced = await syncFirstRunTipsFromServer('user_123', api);
    expect(synced.seenIds.has('seller-dashboard')).toBe(true);
    expect(api.firstRunTips.get).toHaveBeenCalled();

    // A fresh read of the local cache (as a screen mount would do, instantly,
    // with no network) now reflects the server state without another call.
    const local = await readLocalFirstRunTipsState('user_123');
    expect(local.seenIds.has('seller-dashboard')).toBe(true);
  });

  it('a fresh local cache but a server-known tip does not show it again (server is the source of truth)', async () => {
    const { api, seenByUser } = makeServer();
    seenByUser.set('user_123', new Set(['mockup-to-model']));
    store.clear(); // simulate reinstall / new device

    const synced = await syncFirstRunTipsFromServer('user_123', api);
    expect(synced.seenIds.has('mockup-to-model')).toBe(true);
  });

  it('markTipSeen updates the local cache immediately and fires the server write in the background', async () => {
    const { api, seenByUser } = makeServer();
    let state = { seenIds: new Set<string>(), skipAll: false };
    state = markTipSeen('user_123', 'seller-orders', state, api);

    // Local state reflects the dismiss immediately — the caller never awaits this.
    expect(state.seenIds.has('seller-orders')).toBe(true);

    // The server write happens asynchronously; wait a microtask for it to land.
    await Promise.resolve();
    await Promise.resolve();
    expect(seenByUser.get('user_123')?.has('seller-orders')).toBe(true);
  });

  it('markTipSeen still updates the local cache when the server write fails', async () => {
    const api = { firstRunTips: { get: vi.fn(), markSeen: vi.fn(async () => { throw new Error('network'); }), skipAll: vi.fn(), reset: vi.fn() } };
    let state = { seenIds: new Set<string>(), skipAll: false };
    state = markTipSeen('user_123', 'buyer-cart', state, api as any);
    expect(state.seenIds.has('buyer-cart')).toBe(true);
    const reread = await readLocalFirstRunTipsState('user_123');
    expect(reread.seenIds.has('buyer-cart')).toBe(true);
  });

  it('setSkipAllTips suppresses every future tip and persists to the server', async () => {
    const { api, skipAllByUser } = makeServer();
    let state = { seenIds: new Set<string>(), skipAll: false };
    state = setSkipAllTips('user_123', state, api);
    expect(state.skipAll).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    expect(skipAllByUser.get('user_123')).toBe(true);
  });

  it('replayAllTips ("Replay tips") clears both seen ids and skipAll, locally and on the server', async () => {
    const { api, seenByUser, skipAllByUser } = makeServer();
    seenByUser.set('user_123', new Set(['seller-dashboard', 'mockup-to-model']));
    skipAllByUser.set('user_123', true);

    const reset = await replayAllTips('user_123', api);
    expect(reset.seenIds.size).toBe(0);
    expect(reset.skipAll).toBe(false);
    expect(api.firstRunTips.reset).toHaveBeenCalled();

    const local = await readLocalFirstRunTipsState('user_123');
    expect(local.seenIds.size).toBe(0);
    expect(local.skipAll).toBe(false);
  });

  it('replayAllTips still clears the local cache even if the server call fails', async () => {
    const api = { firstRunTips: { get: vi.fn(), markSeen: vi.fn(), skipAll: vi.fn(), reset: vi.fn(async () => { throw new Error('network'); }) } };
    await markTipSeenAndFlush('user_123');
    const reset = await replayAllTips('user_123', api as any);
    expect(reset.seenIds.size).toBe(0);
    expect(reset.skipAll).toBe(false);
  });

  it('keeps each account’s state independent', async () => {
    const { api, seenByUser } = makeServer();
    seenByUser.set('user_123', new Set(['seller-dashboard']));
    const synced123 = await syncFirstRunTipsFromServer('user_123', api);
    expect(synced123.seenIds.has('seller-dashboard')).toBe(true);

    const localOther = await readLocalFirstRunTipsState('user_456');
    expect(localOther.seenIds.size).toBe(0);
  });

  async function markTipSeenAndFlush(userId: string) {
    let state = { seenIds: new Set<string>(), skipAll: false };
    state = markTipSeen(userId, 'seller-dashboard', state);
    await Promise.resolve();
  }
});
