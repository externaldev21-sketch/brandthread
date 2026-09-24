/**
 * App icon badge count, kept in sync with the unread count of the in-app
 * notification feed (services/socialService.ts's getNotifications is the
 * single place that feed is fetched, so hooking in there keeps every mutation
 * — mark read, mark all read, delete — automatically reflected here too).
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export function countUnreadNotifications(notifications: { isRead: boolean }[]): number {
  return notifications.reduce((count, n) => count + (n.isRead ? 0 : 1), 0);
}

export async function syncNotificationBadge(notifications: { isRead: boolean }[]): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(countUnreadNotifications(notifications));
  } catch {
    // Badge sync is best-effort — a failure here must never block the feed.
  }
}
