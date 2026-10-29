/**
 * watchActivityRealtime: a wake-up during an in-flight poll is not lost, and a
 * stopped watcher never reports a late result to an unmounted screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  realtimeListeners: new Set<(e: { type: string }) => void>(),
}));

vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: vi.fn() }));
vi.mock('@/services/socialService', () => ({ subscribeSocial: () => () => {} }));
vi.mock('@/lib/notificationBadge', () => ({ setAppBadgeCount: vi.fn(async () => {}), syncNotificationBadge: vi.fn() }));
vi.mock('@/lib/previewActivity', () => ({
  isPreviewActivityEnabled: () => false,
  isPreviewActivitySeedServed: () => false,
  isPreviewActivityId: () => false,
  markPreviewActivityRead: () => {},
  markAllPreviewActivityRead: () => {},
  previewUnreadActivityCount: () => 0,
}));
vi.mock('@/lib/realtime/messagesSocket', () => ({
  isRealtimeConnected: () => true, // socket up: the safety tick is 60s away
  subscribeRealtime: (fn: (e: { type: string }) => void) => { h.realtimeListeners.add(fn); return () => h.realtimeListeners.delete(fn); },
  subscribeRealtimeStatus: () => () => {},
}));
vi.mock('@/lib/realtime/userEvents', () => ({
  isUserEventsConnected: () => false,
  subscribeUserEvents: () => () => {},
}));

import { serviceRequest } from '@/lib/serviceConfig';
import { watchActivityRealtime } from './activityService';

const request = vi.mocked(serviceRequest);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  h.realtimeListeners.clear();
});
afterEach(() => { vi.useRealTimers(); });

describe('watchActivityRealtime', () => {
  it('re-fetches once a badges.changed that arrived mid-request settles', async () => {
    const first = deferred<{ count: number; latestId: string }>();
    request.mockReturnValueOnce(first.promise as never);
    request.mockResolvedValueOnce({ count: 3, latestId: 'b' } as never);
    const onChange = vi.fn();
    const handle = watchActivityRealtime(onChange);

    // A row lands while the first (older) answer is still in the air.
    for (const fn of h.realtimeListeners) fn({ type: 'badges.changed' });
    first.resolve({ count: 2, latestId: 'a' });
    await vi.advanceTimersByTimeAsync(0);

    expect(request).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ count: 3, latestId: 'b' });
    handle.stop();
  });

  it('does not report a result that arrives after stop()', async () => {
    const pending = deferred<{ count: number; latestId: string }>();
    request.mockReturnValueOnce(pending.promise as never);
    const onChange = vi.fn();
    const handle = watchActivityRealtime(onChange);
    handle.stop();
    pending.resolve({ count: 5, latestId: 'x' });
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});
