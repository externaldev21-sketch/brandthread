import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let connected = false;
const eventListeners = new Set<(e: any) => void>();
const statusListeners = new Set<(c: boolean) => void>();
let unreadCalls = 0;

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: async () => null, setItem: async () => {} },
}));
vi.mock('@/lib/realtime/messagesSocket', () => ({
  isRealtimeConnected: () => connected,
  subscribeRealtime: (fn: (e: any) => void) => { eventListeners.add(fn); return () => eventListeners.delete(fn); },
  subscribeRealtimeStatus: (fn: (c: boolean) => void) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
}));
vi.mock('@/lib/serviceConfig', () => ({
  serviceRequest: async (path: string) => {
    if (path.endsWith('/unread-count')) { unreadCalls += 1; return { count: unreadCalls, latestId: `n${unreadCalls}` }; }
    return [];
  },
}));
vi.mock('@/services/socialService', () => ({ subscribeSocial: () => () => {} }));
vi.mock('@/lib/activity', () => ({ ACTIVITY_PAGE_SIZE: 30 }));
vi.mock('@/lib/previewActivity', () => ({
  isPreviewActivityEnabled: () => false,
  isPreviewActivityId: () => false,
  isPreviewActivitySeedServed: () => false,
  markAllPreviewActivityRead: () => {},
  markPreviewActivityRead: () => {},
  previewUnreadActivityCount: () => 0,
}));

describe('seller new-order badge refresh', () => {
  it('counts pending orders newer than the last time Orders was opened', async () => {
    const store = await import('../orderBadgeStore');
    const { refreshSellerOrderBadge } = await import('../sellerOrderBadge');
    store.clearBadge('seller-1');
    const viewedAt = store.getLastViewedAt('seller-1');
    const later = new Date(viewedAt + 60_000).toISOString();
    const earlier = new Date(viewedAt - 60_000).toISOString();
    await new Promise((r) => setTimeout(r, 2));
    await refreshSellerOrderBadge('seller-1', async () => [
      { status: 'pending', createdAt: later },
      { status: 'pending', createdAt: later },
      { status: 'shipped', createdAt: later },
      { status: 'pending', createdAt: earlier },
    ]);
    expect(store.getBadgeCount('seller-1')).toBe(2);
  });

  it('never throws when the list fails', async () => {
    const { refreshSellerOrderBadge } = await import('../sellerOrderBadge');
    await expect(refreshSellerOrderBadge('seller-2', async () => { throw new Error('offline'); })).resolves.toBeUndefined();
  });
});

describe('Activity unread count over the socket', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    unreadCalls = 0;
    connected = false;
    eventListeners.clear();
    statusListeners.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('short-polls only while the socket is down and refreshes on badges.changed', async () => {
    const { watchActivityRealtime } = await import('@/services/activityService');
    const seen: number[] = [];
    const handle = watchActivityRealtime(({ count }) => seen.push(count), 1500);
    await vi.advanceTimersByTimeAsync(10);
    expect(unreadCalls).toBe(1);

    // Disconnected: short poll.
    await vi.advanceTimersByTimeAsync(1500);
    expect(unreadCalls).toBe(2);

    // Connected: the short poll stops…
    connected = true;
    statusListeners.forEach((fn) => fn(true));
    await vi.advanceTimersByTimeAsync(10);
    const afterConnect = unreadCalls;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(unreadCalls).toBe(afterConnect);

    // …and a badges.changed event fetches the count at once.
    eventListeners.forEach((fn) => fn({ type: 'badges.changed' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(unreadCalls).toBe(afterConnect + 1);
    expect(seen[seen.length - 1]).toBe(unreadCalls);

    handle.stop();
    expect(eventListeners.size).toBe(0);
    expect(statusListeners.size).toBe(0);
  });
});
