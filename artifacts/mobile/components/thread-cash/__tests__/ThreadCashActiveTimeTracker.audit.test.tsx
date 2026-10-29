import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

const h = vi.hoisted(() => {
  const listeners = new Set<(s: string) => void>();
  const store = new Map<string, string>();
  const pendingGets = new Map<string, Array<() => void>>();
  const blockedKeys = new Set<string>();
  const sets: Array<{ key: string; value: string }> = [];
  const api = { threadCash: { dailyHeartbeat: vi.fn(async () => ({})), dailyClaim: vi.fn(async () => ({ earnedCents: 0, streakBonusCents: 0 })) } };
  return {
    userId: 'user-a' as string,
    celebrate: () => {},
    api,
    listeners,
    store,
    pendingGets,
    blockedKeys,
    sets,
    appState: {
      currentState: 'active',
      addEventListener: (_: string, fn: (s: string) => void) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
    },
    storage: {
      getItem: (key: string) => new Promise<string | null>((resolve) => {
        const done = () => resolve(store.get(key) ?? null);
        if (blockedKeys.has(key)) pendingGets.set(key, [...(pendingGets.get(key) ?? []), done]);
        else done();
      }),
      setItem: async (key: string, value: string) => { sets.push({ key, value }); store.set(key, value); },
    },
  };
});

vi.mock('react-native', () => ({ AppState: h.appState }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: h.storage }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ userId: h.userId }) }));
vi.mock('@/lib/api', () => ({ useApi: () => h.api }));
vi.mock('@/contexts/FeatureFlagContext', () => ({ useFeatureFlag: () => true }));
vi.mock('../CelebrationHost', () => ({ useCelebrateThreadCash: () => h.celebrate }));

import { ThreadCashActiveTimeTracker } from '../ThreadCashActiveTimeTracker';

const KEY_B = 'bt:thread-cash:active-time:v1:user-b';

beforeEach(() => {
  vi.useFakeTimers();
  h.store.clear(); h.sets.length = 0; h.pendingGets.clear(); h.blockedKeys.clear(); h.listeners.clear();
  h.userId = 'user-a';
});
afterEach(() => { vi.useRealTimers(); });

describe('ThreadCashActiveTimeTracker (audit)', () => {
  it('never writes the previous account\'s active time under the next account\'s key', async () => {
    let root!: TestRenderer.ReactTestRenderer;
    await act(async () => { root = TestRenderer.create(<ThreadCashActiveTimeTracker />); });
    // User A is active for 10s.
    for (let i = 0; i < 10; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    // Switch to user B while B's stored day is still loading…
    h.blockedKeys.add(KEY_B);
    h.userId = 'user-b';
    await act(async () => { root.update(<ThreadCashActiveTimeTracker />); });
    // …and the app comes back to the foreground in that window.
    await act(async () => { h.listeners.forEach((fn) => fn('background')); });
    await act(async () => { h.listeners.forEach((fn) => fn('active')); });
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    await act(async () => { (h.pendingGets.get(KEY_B) ?? []).forEach((r) => r()); });
    for (let i = 0; i < 5; i++) await act(async () => { vi.advanceTimersByTime(1000); });
    const writesForB = h.sets.filter((s) => s.key === KEY_B).map((s) => JSON.parse(s.value).activeSeconds as number);
    expect(writesForB.length).toBeGreaterThan(0);
    // B was only ever active for ~10s of its own; A's 10s must not be carried over.
    expect(Math.max(...writesForB)).toBeLessThanOrEqual(10);
    await act(async () => { root.unmount(); });
  });
});
