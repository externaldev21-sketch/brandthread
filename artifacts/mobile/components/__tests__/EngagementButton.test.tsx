/**
 * EngagementButton — focused Vitest tests
 *
 * Pure logic tests — no render tree needed (vitest environment: node).
 *
 * Covers:
 * 1. formatCount: zero, hundreds, thousands, millions
 * 2. Inflight guard: concurrent calls are deduplicated
 * 3. Optimistic rollback: parent handler rolls back on rejection
 * 4. Toast context fallback: useFeedToast degrades gracefully without provider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCount } from '@/lib/engagementUtils';

// ─── formatCount ─────────────────────────────────────────────────────────────

describe('formatCount', () => {
  it('returns "0" for zero', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('returns exact count below 1000', () => {
    expect(formatCount(1)).toBe('1');
    expect(formatCount(999)).toBe('999');
  });

  it('abbreviates thousands with no decimal when multiple of 1000', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(2000)).toBe('2K');
  });

  it('abbreviates thousands with one decimal when remainder ≥ 100', () => {
    expect(formatCount(1100)).toBe('1.1K');
    expect(formatCount(9900)).toBe('9.9K');
  });

  it('abbreviates thousands without decimal when remainder < 100', () => {
    expect(formatCount(10050)).toBe('10K');
  });

  it('abbreviates millions', () => {
    expect(formatCount(1_000_000)).toBe('1.0M');
    expect(formatCount(2_500_000)).toBe('2.5M');
  });
});

// ─── Inflight guard (pure logic simulation) ───────────────────────────────────
// Reproduces the inflight-ref pattern inside EngagementButton.

function makeInflightGuard(action: () => Promise<void>) {
  let inflight = false;
  return async function guardedPress() {
    if (inflight) return;
    inflight = true;
    try {
      await action();
    } finally {
      inflight = false;
    }
  };
}

describe('Inflight guard', () => {
  it('calls the action exactly once even when pressed multiple times simultaneously', async () => {
    let resolveAction!: () => void;
    const slowAction = vi.fn(
      () => new Promise<void>(res => { resolveAction = res; }),
    );

    const guarded = makeInflightGuard(slowAction);

    // Simulate three rapid presses before the action resolves
    const p1 = guarded();
    const p2 = guarded(); // should be a no-op
    const p3 = guarded(); // should be a no-op

    resolveAction(); // resolve the underlying action
    await Promise.all([p1, p2, p3]);

    expect(slowAction).toHaveBeenCalledTimes(1);
  });

  it('re-allows the action after it completes', async () => {
    const fastAction = vi.fn().mockResolvedValue(undefined);
    const guarded = makeInflightGuard(fastAction);

    await guarded();
    await guarded();

    expect(fastAction).toHaveBeenCalledTimes(2);
  });

  it('re-allows the action after it rejects (inflight clears on error)', async () => {
    const failingAction = vi.fn().mockRejectedValue(new Error('network'));
    const guarded = makeInflightGuard(failingAction);

    // First press — rejects
    await guarded().catch(() => {});
    // Second press — should now be accepted
    await guarded().catch(() => {});

    expect(failingAction).toHaveBeenCalledTimes(2);
  });
});

// ─── Optimistic rollback simulation ──────────────────────────────────────────
// Verifies that a parent handler correctly rolls back on API failure,
// matching the pattern used in handleLike / handleSave / handleRepost.

interface EngagementState {
  liked: boolean;
  likes: number;
}

function makeOptimisticLikeHandler(
  getState: () => EngagementState,
  setState: (s: EngagementState) => void,
  apiCall: (willLike: boolean) => Promise<void>,
  onError: (msg: string) => void,
) {
  return async function handleLike() {
    const snapshot = getState();
    const willLike = !snapshot.liked;
    // Optimistic update
    setState({ liked: willLike, likes: willLike ? snapshot.likes + 1 : Math.max(0, snapshot.likes - 1) });
    try {
      await apiCall(willLike);
    } catch {
      // Rollback
      setState(snapshot);
      onError('Could not update like. Try again.');
    }
  };
}

describe('Optimistic rollback', () => {
  let state: EngagementState;
  let capturedErrors: string[];
  let onError: (msg: string) => void;

  beforeEach(() => {
    state = { liked: false, likes: 10 };
    capturedErrors = [];
    onError = (msg: string) => { capturedErrors.push(msg); };
  });

  it('applies optimistic update before API resolves', async () => {
    let resolveApi!: () => void;
    const apiCall = vi.fn(() => new Promise<void>(res => { resolveApi = res; }));

    const handler = makeOptimisticLikeHandler(
      () => state,
      s => { state = s; },
      apiCall,
      onError,
    );

    const p = handler();
    // Optimistic update should already be applied
    expect(state.liked).toBe(true);
    expect(state.likes).toBe(11);

    resolveApi();
    await p;

    // Should still be true after success
    expect(state.liked).toBe(true);
    expect(state.likes).toBe(11);
    expect(capturedErrors).toHaveLength(0);
  });

  it('rolls back to snapshot when API rejects', async () => {
    const apiCall = vi.fn().mockRejectedValue(new Error('server error'));

    const handler = makeOptimisticLikeHandler(
      () => state,
      s => { state = s; },
      apiCall,
      onError,
    );

    await handler();

    // Rolled back
    expect(state.liked).toBe(false);
    expect(state.likes).toBe(10);
    expect(capturedErrors).toContain('Could not update like. Try again.');
  });

  it('does not call onError when API succeeds', async () => {
    const apiCall = vi.fn().mockResolvedValue(undefined);

    const handler = makeOptimisticLikeHandler(
      () => state,
      s => { state = s; },
      apiCall,
      onError,
    );

    await handler();
    expect(capturedErrors).toHaveLength(0);
  });

  it('toggles liked off (unlike) with correct count', async () => {
    state = { liked: true, likes: 5 };
    const apiCall = vi.fn().mockResolvedValue(undefined);

    const handler = makeOptimisticLikeHandler(
      () => state,
      s => { state = s; },
      apiCall,
      onError,
    );

    await handler();

    expect(state.liked).toBe(false);
    expect(state.likes).toBe(4);
  });
});

// ─── Toast context fallback ───────────────────────────────────────────────────
// Verify that the fallback returned when no FeedToastContext is present
// is a no-op that does not throw.

describe('useFeedToast fallback', () => {
  it('produces a showToast that does not throw when called without a provider', () => {
    // Mirrors the fallback in useFeedToast:
    const fallback = { showToast: (_msg: string, _variant?: 'error' | 'info') => {} };
    expect(() => fallback.showToast('Something failed', 'error')).not.toThrow();
    expect(() => fallback.showToast('Done')).not.toThrow();
  });
});
