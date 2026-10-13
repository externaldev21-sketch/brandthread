import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({ useRouter: () => ({}) }));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: false }) }));
vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));

import { canOpenInternalDevMenu, createTapCounter } from './internalDevMenu';

describe('createTapCounter', () => {
  it('fires on the 7th quick tap and then starts over', () => {
    const tap = createTapCounter(7, 1500);
    const results = Array.from({ length: 7 }, (_, i) => tap(i * 200));
    expect(results).toEqual([false, false, false, false, false, false, true]);
    expect(tap(1500)).toBe(false);
  });

  it('resets when the taps are too slow', () => {
    const tap = createTapCounter(3, 1000);
    expect(tap(0)).toBe(false);
    expect(tap(500)).toBe(false);
    expect(tap(2000)).toBe(false); // gap > window: counts as tap 1
    expect(tap(2500)).toBe(false);
    expect(tap(3000)).toBe(true);
  });
});

describe('canOpenInternalDevMenu', () => {
  it('always opens in development builds without asking the server', async () => {
    const checkModerator = vi.fn();
    await expect(canOpenInternalDevMenu({ isDev: true, isSignedIn: false, checkModerator })).resolves.toBe(true);
    expect(checkModerator).not.toHaveBeenCalled();
  });

  it('never calls the protected moderator check when signed out', async () => {
    const checkModerator = vi.fn();
    await expect(canOpenInternalDevMenu({ isDev: false, isSignedIn: false, checkModerator })).resolves.toBe(false);
    expect(checkModerator).not.toHaveBeenCalled();
  });

  it('opens only for server-confirmed moderators in release builds', async () => {
    await expect(canOpenInternalDevMenu({ isDev: false, isSignedIn: true, checkModerator: async () => ({ isModerator: true }) })).resolves.toBe(true);
    await expect(canOpenInternalDevMenu({ isDev: false, isSignedIn: true, checkModerator: async () => ({ isModerator: false }) })).resolves.toBe(false);
    await expect(canOpenInternalDevMenu({ isDev: false, isSignedIn: true, checkModerator: async () => { throw new Error('offline'); } })).resolves.toBe(false);
  });
});
