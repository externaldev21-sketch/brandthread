import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-notifications', () => ({ setBadgeCountAsync: vi.fn() }));

import { countUnreadNotifications } from './notificationBadge';

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
