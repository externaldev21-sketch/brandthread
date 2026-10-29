/**
 * The account switch transition (lib/accountSwitchTransition.ts) never
 * reveals a half-switched app: the cover stays up through Clerk's activation,
 * the cache re-scope (lib/accountScope.ts) and the new home's first paint,
 * and only paints that happen after the re-scope count. A ceiling bounds the
 * wait so a slow switch still uncovers onto real loading states.
 *
 * Driven against a fake app timeline that records, for every frame the
 * person could see, whether the cover was up and which account's screen was
 * underneath — the test fails on any uncovered frame of the wrong account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountScope, getAccountSwitchKey, markAccountScope, subscribeAccountScope } from '@/lib/accountScope';
import { runAccountSwitch, switchHomeRoute, type AccountSwitchDeps } from '@/lib/accountSwitchTransition';

type Frame = { covered: boolean; showing: string };

function harness(options: { homePaintsAfterMs?: number; scopeAfterMs?: number; activateFails?: boolean } = {}) {
  const frames: Frame[] = [];
  const events: string[] = [];
  let covered = false;
  let showing = 'user_a:dashboard';
  const screenListeners = new Set<(screen: string) => void>();
  const paint = (what: string, screen?: string) => {
    showing = what;
    frames.push({ covered, showing });
    if (screen) screenListeners.forEach((listener) => listener(screen));
  };
  const deps: AccountSwitchDeps = {
    cover: async () => { covered = true; events.push('cover'); frames.push({ covered, showing }); },
    uncover: () => { covered = false; events.push('uncover'); frames.push({ covered, showing }); },
    activate: async () => {
      events.push('activate');
      if (options.activateFails) throw new Error('nope');
      // Clerk flips first: the OLD account's retained screens re-render with
      // the new user, before caches are re-scoped (the old glitch frame) —
      // and they even report themselves interactive.
      paint('user_a-screens-with-user_b-data', 'seller-dashboard');
      setTimeout(() => {
        markAccountScope('user_b');
        // New shell mounts fresh (keyed) — its loading skeleton first.
        paint('user_b:mounting');
      }, options.scopeAfterMs ?? 30);
    },
    navigate: (route) => {
      events.push(`navigate ${route}`);
      setTimeout(() => paint('user_b:dashboard-skeleton', 'seller-dashboard'), options.homePaintsAfterMs ?? 50);
    },
    warmRoute: async (route) => { events.push(`warm ${route}`); },
    getScope: getAccountScope,
    subscribeScope: subscribeAccountScope,
    subscribeScreenReady: (listener) => { screenListeners.add(listener); return () => screenListeners.delete(listener); },
    ceilingMs: 1_000,
  };
  return { deps, frames, events };
}

beforeEach(() => {
  vi.useFakeTimers();
  markAccountScope('user_a');
});
afterEach(() => { vi.useRealTimers(); });

describe('runAccountSwitch', () => {
  it('reveals only once the new account is scoped and its home painted — no uncovered glitch frame', async () => {
    const { deps, frames, events } = harness();
    const done = runAccountSwitch({ userId: 'user_b', kind: 'seller' }, deps);
    await vi.runAllTimersAsync();
    await expect(done).resolves.toBe('switched');

    expect(events).toEqual(['cover', 'warm /(tabs)/index', 'activate', 'navigate /(tabs)/', 'uncover']);
    const uncovered = frames.filter((frame) => !frame.covered);
    expect(uncovered).toEqual([{ covered: false, showing: 'user_b:dashboard-skeleton' }]);
    // The mixed frame happened, but only under the cover.
    expect(frames).toContainEqual({ covered: true, showing: 'user_a-screens-with-user_b-data' });
  });

  it('a paint reported before the re-scope (old account\'s screens) never ends the cover', async () => {
    const { deps, events } = harness({ scopeAfterMs: 300, homePaintsAfterMs: 200 });
    const done = runAccountSwitch({ userId: 'user_b', kind: 'seller' }, deps);
    await vi.advanceTimersByTimeAsync(299);
    expect(events).not.toContain('uncover');
    await vi.advanceTimersByTimeAsync(100);
    expect(events).not.toContain('uncover');
    await vi.advanceTimersByTimeAsync(200);
    await expect(done).resolves.toBe('switched');
    expect(events.at(-1)).toBe('uncover');
  });

  it('a slow home still uncovers at the ceiling (onto its own loading state), never a stuck cover', async () => {
    const { deps, events } = harness({ homePaintsAfterMs: 10_000 });
    const done = runAccountSwitch({ userId: 'user_b', kind: 'seller' }, deps);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(done).resolves.toBe('timed-out');
    expect(events.at(-1)).toBe('uncover');
  });

  it('a failed activation uncovers onto the unchanged account and never navigates', async () => {
    const { deps, events } = harness({ activateFails: true });
    await expect(runAccountSwitch({ userId: 'user_b', kind: 'seller' }, deps)).resolves.toBe('failed');
    expect(events).toEqual(['cover', 'warm /(tabs)/index', 'activate', 'uncover']);
  });

  it('lands on each kind\'s own home; unknown kind lets AuthGate route', () => {
    expect(switchHomeRoute('seller')).toBe('/(tabs)/');
    expect(switchHomeRoute('buyer')).toBe('/(buyer)/');
    expect(switchHomeRoute(null)).toBe('/');
  });
});

describe('accountScope switch key', () => {
  it('changes when one signed-in account replaces another (even via a signed-out render), and only then', () => {
    markAccountScope(null);
    markAccountScope('user_c');
    const key = getAccountSwitchKey();
    markAccountScope('user_c');
    expect(getAccountSwitchKey()).toBe(key);
    markAccountScope(null);
    markAccountScope('user_d');
    expect(getAccountSwitchKey()).not.toBe(key);
  });
});
