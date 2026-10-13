/**
 * Notification categories (action buttons) registered with the OS at
 * startup. The server sets `categoryId` on matching pushes:
 *   new_order → "Ship now" (seller new-order push, routes/webhooks.ts)
 * Native only; on web this is a no-op.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { NEW_ORDER_CATEGORY_ID, SHIP_NOW_ACTION_ID } from './notificationNavigation';

export async function registerNotificationCategories(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setNotificationCategoryAsync(NEW_ORDER_CATEGORY_ID, [
      {
        identifier: SHIP_NOW_ACTION_ID,
        buttonTitle: 'Ship now',
        // Fulfilling needs the signed-in app (and on iOS an unlocked device).
        options: { opensAppToForeground: true },
      },
    ]);
  } catch {
    // Without the category the push still arrives and opens the order.
  }
}
