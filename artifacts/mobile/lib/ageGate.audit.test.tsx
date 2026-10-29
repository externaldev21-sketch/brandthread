import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ current: { isSignedIn: true as boolean, userId: 'minor' as string | null } }));
const bands = vi.hoisted(() => ({ minor: '13_17', adult: null as string | null } as Record<string, string | null>));
const pendingMe = vi.hoisted(() => ({ resolvers: [] as Array<() => void> }));
vi.mock('@clerk/expo', () => ({ useAuth: () => auth.current }));
vi.mock('@/lib/api', () => {
  const api = {
    auth: {
      me: () => {
        const uid = auth.current.userId as string;
        return new Promise((resolve) => {
          pendingMe.resolvers.push(() => resolve({ ageBand: bands[uid] }));
        });
      },
    },
  };
  return { useApi: () => api };
});

import { useAgeStatus } from './ageGate';

function Probe({ onStatus }: { onStatus: (s: string) => void }) {
  const { status } = useAgeStatus();
  onStatus(status);
  return null;
}

describe('useAgeStatus across an account switch / sign-out', () => {
  it("never shows the previous account's restriction to the next account or once signed out", async () => {
    let latest = '';
    let root!: ReturnType<typeof create>;
    act(() => { root = create(<Probe onStatus={(s) => { latest = s; }} />); });
    await act(async () => { pendingMe.resolvers.shift()!(); });
    expect(latest).toBe('restricted');

    // Switch to an adult account whose status has not loaded yet.
    auth.current = { isSignedIn: true, userId: 'adult' };
    act(() => { root.update(<Probe onStatus={(s) => { latest = s; }} />); });
    expect(latest).toBe('ok');

    // Sign out entirely.
    auth.current = { isSignedIn: false, userId: null };
    act(() => { root.update(<Probe onStatus={(s) => { latest = s; }} />); });
    expect(latest).toBe('ok');
    act(() => root.unmount());
  });
});
