/**
 * invalidateBuyerPreferences() drops the cached saved sizes (e.g. after the
 * onboarding survey wrote new ones server-side). Every mounted consumer must
 * then load the fresh value — not sit at status 'loading' with empty
 * preferences until it happens to remount — and a request that was already
 * in flight before the invalidation must not overwrite the fresh value.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const resolvers: Array<(v: unknown) => void> = [];
const api = {
  buyer: {
    preferences: {
      get: vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); })),
      update: vi.fn(),
    },
  },
};

vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isSignedIn: true, userId: 'user_prefs' }) }));
vi.mock('@/lib/api', () => ({ useApi: () => api }));

import { invalidateBuyerPreferences, useBuyerPreferences } from './useBuyerPreferences';

type Result = ReturnType<typeof useBuyerPreferences>;
function Probe({ onValue }: { onValue: (v: Result) => void }) {
  onValue(useBuyerPreferences());
  return null;
}
const prefs = (tops: string) => ({ sizes: { tops }, likedBrandIds: [], styleInterests: [], surveyCompletedAt: null, updatedAt: null });
async function flush() { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); }

describe('useBuyerPreferences invalidation', () => {
  it('refetches for mounted consumers and ignores a superseded in-flight answer', async () => {
    invalidateBuyerPreferences();
    resolvers.length = 0;
    let latest!: Result;
    let r!: ReactTestRenderer;
    act(() => { r = create(<Probe onValue={(v) => { latest = v; }} />); });
    await flush();
    expect(resolvers).toHaveLength(1);
    const stale = resolvers.shift()!; // still in flight

    act(() => { invalidateBuyerPreferences(); });
    await flush();
    // A fresh request went out for the mounted consumer.
    expect(resolvers).toHaveLength(1);
    resolvers.shift()!(prefs('M'));
    await flush();
    expect(latest.status).toBe('loaded');
    expect(latest.preferences.sizes).toEqual({ tops: 'M' });

    // The pre-invalidation answer arrives last: it must not win.
    stale(prefs('XS'));
    await flush();
    expect(latest.preferences.sizes).toEqual({ tops: 'M' });
    act(() => r.unmount());
  });
});
