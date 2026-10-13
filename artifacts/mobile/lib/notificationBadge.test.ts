import { beforeEach, describe, expect, it, vi } from 'vitest';

const setBadgeCountAsync = vi.fn();
const serviceRequest = vi.fn();
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({ setBadgeCountAsync: (n: number) => setBadgeCountAsync(n) }));
vi.mock('@/lib/serviceConfig', () => ({ serviceRequest: (...args: unknown[]) => serviceRequest(...args) }));

import { countUnreadNotifications, setAppBadgeCount, syncNotificationBadge } from './notificationBadge';

describe('countUnreadNotifications', () => {
  it('counts only unread notifications', () => {
    expect(countUnreadNotifications([
      { isRead: false },
      { isRead: true },
      { isRead: false },
    ])).toBe(2);
  });

  it('is zero for an empty list', () => {
    expect(countUnreadNotifications([])).toBe(0);
  });

  it('is zero when everything is read', () => {
    expect(countUnreadNotifications([{ isRead: true }, { isRead: true }])).toBe(0);
  });
});

describe('syncNotificationBadge', () => {
  beforeEach(() => {
    setBadgeCountAsync.mockReset();
    serviceRequest.mockReset();
  });

  it('applies the server unread count (muted rows already excluded server-side)', async () => {
    serviceRequest.mockResolvedValue({ count: 7, latestId: 'n1' });
    await syncNotificationBadge();
    expect(serviceRequest).toHaveBeenCalledWith('/api/buyer/notifications/unread-count', {}, false);
    expect(setBadgeCountAsync).toHaveBeenCalledWith(7);
  });

  it('leaves the badge alone when the count cannot be read', async () => {
    serviceRequest.mockRejectedValue(new Error('offline'));
    await syncNotificationBadge();
    expect(setBadgeCountAsync).not.toHaveBeenCalled();
  });

  it('clears the badge to zero and clamps bad values', async () => {
    await setAppBadgeCount(0);
    await setAppBadgeCount(-3);
    expect(setBadgeCountAsync.mock.calls).toEqual([[0], [0]]);
  });
});
