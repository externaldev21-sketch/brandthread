/**
 * Dev's bug: first-run tips (and the feed's gesture coach) showed again on
 * every load. A tip must show exactly once per account: never decided before
 * auth and the saved state have loaded, marked seen the moment it shows, and
 * never brought back by a server that missed the write.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  auth: { userId: null as string | null, isLoaded: true },
  server: { byUser: new Map<string, Set<string>>(), failWrites: false },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => h.store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: string) => { h.store.set(k, v); }),
  },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => h.auth }));
vi.mock('expo-router', () => ({ usePathname: () => '/(tabs)/feed' }));
vi.mock('@/lib/devPreview', () => ({ isBuyerDevPreview: () => false, isSellerDevPreview: () => false }));
const api = {
  firstRunTips: {
    get: vi.fn(async () => ({ seenTipIds: [...(h.server.byUser.get(h.auth.userId ?? '') ?? [])], skipAll: false })),
    markSeen: vi.fn(async (id: string) => {
      if (h.server.failWrites || !h.auth.userId) throw new Error('401');
      const set = h.server.byUser.get(h.auth.userId) ?? new Set<string>();
      set.add(id);
      h.server.byUser.set(h.auth.userId, set);
    }),
    skipAll: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
  },
};
vi.mock('@/hooks/useApi', () => ({ useApi: () => api }));

import { FirstRunTipsProvider } from '@/contexts/FirstRunTipsContext';
import { useFirstRunTip } from '@/hooks/useFirstRunTip';

const seen: boolean[] = [];
function Probe() {
  const { visible } = useFirstRunTip('buyer-feed', { contentReady: true });
  seen.push(visible);
  return null;
}

async function flush() {
  await act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
}

/** One app launch: mount, let storage + server settle, report whether the tip ever showed. */
async function launch(): Promise<{ shown: boolean; renderer: ReactTestRenderer }> {
  seen.length = 0;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(<FirstRunTipsProvider><Probe /></FirstRunTipsProvider>); });
  await flush();
  return { shown: seen.some(Boolean), renderer };
}

describe('a first-run tip shows exactly once per account', () => {
  beforeEach(() => {
    h.store.clear();
    h.server.byUser.clear();
    h.server.failWrites = false;
    h.auth.userId = 'user_1';
    h.auth.isLoaded = true;
    vi.clearAllMocks();
  });

  it('shown once → reload → not shown', async () => {
    const first = await launch();
    expect(first.shown).toBe(true);
    await act(async () => { first.renderer.unmount(); }); // killed without tapping "Got it"
    const second = await launch();
    expect(second.shown).toBe(false);
  });

  it('failed server PATCH → still not shown on the next loads', async () => {
    h.server.failWrites = true;
    const first = await launch();
    expect(first.shown).toBe(true);
    expect(h.server.byUser.size).toBe(0); // the server never got it
    for (let reload = 0; reload < 2; reload++) {
      await act(async () => { first.renderer.unmount(); });
      expect((await launch()).shown).toBe(false);
    }
  });

  it('null → real userId: not shown twice', async () => {
    h.auth.userId = null;
    const anon = await launch();
    expect(anon.shown).toBe(true); // shown before the account id resolved
    h.auth.userId = 'user_1';
    await act(async () => { anon.renderer.update(<FirstRunTipsProvider><Probe /></FirstRunTipsProvider>); });
    seen.length = 0;
    await flush();
    await act(async () => { anon.renderer.unmount(); });
    expect((await launch()).shown).toBe(false);
  });

  it('never decides before auth has loaded', async () => {
    h.auth.isLoaded = false;
    const { shown } = await launch();
    expect(shown).toBe(false);
    expect(api.firstRunTips.get).not.toHaveBeenCalled();
  });

  it('a different account on the same device still gets its own first time', async () => {
    const a = await launch();
    expect(a.shown).toBe(true);
    await act(async () => { a.renderer.unmount(); });
    h.auth.userId = 'user_2';
    expect((await launch()).shown).toBe(true);
  });
});
