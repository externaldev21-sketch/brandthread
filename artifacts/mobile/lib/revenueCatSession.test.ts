import { describe, expect, it } from 'vitest';
import {
  createRevenueCatIdentityQueue,
  createRevenueCatSessionGuard,
  runRevenueCatSessionOperation,
  switchRevenueCatIdentity,
} from './revenueCatSession';

describe('RevenueCat Clerk session isolation', () => {
  it('invalidates all prior-user async completions on an identity change', () => {
    const guard = createRevenueCatSessionGuard();
    const userA = guard.begin();
    const userB = guard.begin();
    expect(guard.isCurrent(userA)).toBe(false);
    expect(guard.isCurrent(userB)).toBe(true);
  });

  it('serializes logout/login transitions even after a failed transition', async () => {
    const queue = createRevenueCatIdentityQueue();
    const order: string[] = [];
    await Promise.all([
      queue(async () => { order.push('logout-a'); throw new Error('offline'); }).catch(() => {}),
      queue(async () => { order.push('logout-b'); order.push('login-b'); }),
    ]);
    expect(order).toEqual(['logout-a', 'logout-b', 'login-b']);
  });

  it.each(['purchase', 'restore'])('completes %s and syncs without invalidating its own session', async () => {
    const guard = createRevenueCatSessionGuard();
    guard.begin();
    const synced: string[] = [];
    const result = await runRevenueCatSessionOperation(
      guard,
      async () => 'customer-info',
      async (info, generation) => {
        expect(guard.isCurrent(generation)).toBe(true);
        synced.push(info);
      },
    );
    expect(result).toBe('customer-info');
    expect(synced).toEqual(['customer-info']);
  });

  it('rejects an operation whose account changes before completion', async () => {
    const guard = createRevenueCatSessionGuard();
    guard.begin();
    await expect(runRevenueCatSessionOperation(
      guard,
      async () => {
        guard.begin();
        return 'old-customer-info';
      },
      async () => {
        throw new Error('must not sync');
      },
    )).rejects.toThrow('Your account changed');
  });
});
describe('switchRevenueCatIdentity (BT-003)', () => {
  function fakeSdk(state: { anonymous: boolean; id: string }) {
    const calls: string[] = [];
    return {
      calls,
      sdk: {
        isAnonymous: async () => state.anonymous,
        getAppUserID: async () => state.id,
        logOut: async () => {
          calls.push('logOut');
          // Mirrors the real SDK: LOGOUT_CALLED_WITH_ANONYMOUS_USER.
          if (state.anonymous) throw new Error('LOGOUT_CALLED_WITH_ANONYMOUS_USER');
          state.anonymous = true;
          state.id = '$RCAnonymousID:new';
        },
        logIn: async (id: string) => {
          calls.push(`logIn:${id}`);
          state.anonymous = false;
          state.id = id;
        },
      },
    };
  }

  it('logs an anonymous fresh-install customer straight in without logOut', async () => {
    const { sdk, calls } = fakeSdk({ anonymous: true, id: '$RCAnonymousID:abc' });
    await switchRevenueCatIdentity(sdk, 'user_a');
    expect(calls).toEqual(['logIn:user_a']);
  });

  it('logs out a different identified customer before logging in', async () => {
    const { sdk, calls } = fakeSdk({ anonymous: false, id: 'user_a' });
    await switchRevenueCatIdentity(sdk, 'user_b');
    expect(calls).toEqual(['logOut', 'logIn:user_b']);
  });

  it('does nothing when the same customer is already active', async () => {
    const { sdk, calls } = fakeSdk({ anonymous: false, id: 'user_a' });
    await switchRevenueCatIdentity(sdk, 'user_a');
    expect(calls).toEqual([]);
  });

  it('signs out an identified customer and never logs out an anonymous one', async () => {
    const signedIn = fakeSdk({ anonymous: false, id: 'user_a' });
    await switchRevenueCatIdentity(signedIn.sdk, undefined);
    expect(signedIn.calls).toEqual(['logOut']);
    const anon = fakeSdk({ anonymous: true, id: '$RCAnonymousID:abc' });
    await switchRevenueCatIdentity(anon.sdk, undefined);
    expect(anon.calls).toEqual([]);
  });
});
