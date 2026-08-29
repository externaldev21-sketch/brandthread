import { describe, expect, it } from 'vitest';
import {
  createRevenueCatIdentityQueue,
  createRevenueCatSessionGuard,
  runRevenueCatSessionOperation,
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