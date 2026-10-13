/**
 * App icon badge count = the server's unread, unmuted feed count
 * (GET /api/buyer/notifications/unread-count). Every push the server sends
 * through publishNotification carries the same count as its `badge`, so the
 * icon is exact whether the app is open or not; these helpers keep it exact
 * while the app runs (feed loads, foreground pushes, mark read, mark all read).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { serviceRequest } from '@/lib/serviceConfig';

export function countUnreadNotifications(notifications: { isRead: boolean }[]): number {
  return notifications.reduce((count, n) => count + (n.isRead ? 0 : 1), 0);
}

/** Sets the icon badge directly (e.g. 0 right after "Mark all read"). Best-effort. */
export async function setAppBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'web' || !Number.isFinite(count)) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.floor(count)));
  } catch {
    // Badge sync is best-effort — a failure here must never block the feed.
  }
}

/** The server's unread count, or null when it cannot be read (signed out, offline). */
export async function fetchServerUnreadCount(): Promise<number | null> {
  try {
    const result = await serviceRequest<{ count?: unknown }>('/api/buyer/notifications/unread-count', {}, false);
    return typeof result?.count === 'number' ? result.count : null;
  } catch {
    return null;
  }
}

/**
 * Re-reads the server count and applies it. A failed read leaves the badge
 * as it is rather than clearing it on a guess.
 */
export async function syncNotificationBadge(): Promise<void> {
  if (Platform.OS === 'web') return;
  const count = await fetchServerUnreadCount();
  if (count !== null) await setAppBadgeCount(count);
}
