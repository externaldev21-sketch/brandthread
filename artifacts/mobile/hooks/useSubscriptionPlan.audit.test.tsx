/**
 * Switching store (or account) while the previous plan request is still in
 * flight: the older answer must not overwrite the plan of the store now
 * selected — features would be gated on the wrong store's plan.
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: 'store_a' as string | null,
  storeListeners: [] as Array<() => void>,
  resolvers: [] as Array<(v: unknown) => void>,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    seller: {
      subscription: {
        entitlement: () => new Promise((resolve) => { h.resolvers.push(resolve); }),
        status: () => new Promise(() => {}),
      },
    },
  }),
  getStoreContext: () => h.store,
  subscribeStoreContext: (fn: () => void) => { h.storeListeners.push(fn); return () => {}; },
}));
vi.mock('@clerk/expo', () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: 'user_plan' }) }));

import { useSubscriptionPlan } from './useSubscriptionPlan';

type Hook = ReturnType<typeof useSubscriptionPlan>;
async function flush() { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); }

describe('useSubscriptionPlan store switch', () => {
  it("keeps the selected store's plan when the previous store's answer lands late", async () => {
    let latest!: Hook;
    function Probe() { latest = useSubscriptionPlan(); return null; }
    let r!: ReturnType<typeof create>;
    act(() => { r = create(<Probe />); });
    await flush();
    expect(h.resolvers).toHaveLength(1);
    const storeA = h.resolvers.shift()!;

    // Switch to store B while A's request is still out.
    h.store = 'store_b';
    act(() => { h.storeListeners.forEach((fn) => fn()); });
    await flush();
    expect(h.resolvers).toHaveLength(1);
    h.resolvers.shift()!({ plan: 'pro' });
    await flush();
    expect(latest.plan).toBe('pro');

    storeA({ plan: 'starter' });
    await flush();
    expect(latest.plan).toBe('pro');
    act(() => r.unmount());
  });
});
