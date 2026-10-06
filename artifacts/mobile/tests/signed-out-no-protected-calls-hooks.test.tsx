import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { auth, api } = vi.hoisted(() => {
  // The hook reads the plan from /entitlement; one mock stands for both
  // plan endpoints so the "never called signed out" assertions cover them.
  const planRequest = vi.fn();
  return {
    auth: { isLoaded: true, isSignedIn: false, userId: null as string | null },
    api: {
      team: { context: vi.fn() },
      seller: { subscription: { status: planRequest, entitlement: planRequest } },
    },
  };
});

vi.mock('@clerk/expo', () => ({ useAuth: () => auth }));
vi.mock('@/lib/api', () => ({
  useApi: () => api,
  getStoreContext: () => null,
  subscribeStoreContext: () => () => {},
}));

import { useTeamRole } from '@/hooks/useTeamRole';
import { useSubscriptionPlan, invalidatePlanCache } from '@/hooks/useSubscriptionPlan';

let tree: ReactTestRenderer | undefined;
function renderHook<T>(hook: () => T) {
  const result = { current: undefined as unknown as T };
  function Probe() { result.current = hook(); return null; }
  act(() => { tree = create(<Probe />); });
  return { result, rerender: () => act(() => { tree!.update(<Probe />); }) };
}

beforeEach(() => {
  auth.isLoaded = true; auth.isSignedIn = false; auth.userId = null;
  api.team.context.mockReset().mockResolvedValue({ role: 'owner' });
  api.seller.subscription.status.mockReset().mockResolvedValue({ plan: 'growth' });
  invalidatePlanCache();
});
afterEach(() => { act(() => tree?.unmount()); tree = undefined; });

describe('useTeamRole never calls the protected team-context API without a session', () => {
  it('signed out: no request, not stuck loading, no role', () => {
    const { result } = renderHook(() => useTeamRole());
    expect(api.team.context).not.toHaveBeenCalled();
    expect(result.current).toEqual({ currentRole: null, isLoadingRole: false });
  });

  it('Clerk not loaded yet: no request', () => {
    auth.isLoaded = false; auth.isSignedIn = false;
    renderHook(() => useTeamRole());
    expect(api.team.context).not.toHaveBeenCalled();
  });

  it('signed in: requests the role', async () => {
    auth.isSignedIn = true; auth.userId = 'user_1';
    const { result } = renderHook(() => useTeamRole());
    await act(async () => { await Promise.resolve(); });
    expect(api.team.context).toHaveBeenCalledTimes(1);
    expect(result.current.currentRole).toBe('owner');
  });
});

describe('useSubscriptionPlan never calls the protected subscription API without a session', () => {
  it('signed out: no request and falls back to starter without loading', () => {
    const { result } = renderHook(() => useSubscriptionPlan());
    expect(api.seller.subscription.status).not.toHaveBeenCalled();
    expect(result.current.plan).toBe('starter');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it('fetches once a session appears', async () => {
    const { result, rerender } = renderHook(() => useSubscriptionPlan());
    expect(api.seller.subscription.status).not.toHaveBeenCalled();
    auth.isSignedIn = true; auth.userId = 'user_1';
    rerender();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(api.seller.subscription.status).toHaveBeenCalledTimes(1);
    expect(result.current.plan).toBe('growth');
  });
});
