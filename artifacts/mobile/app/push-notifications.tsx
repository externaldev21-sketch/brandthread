import { Redirect } from 'expo-router';

// Redirect-only route: it never paints, so it has no ScreenHeader of its own.

/**
 * Push notification preferences live in one place: /notifications-settings,
 * which loads and saves the account's real categories, master switch and
 * quiet hours (GET/PUT /api/notification-prefs). This route used to render
 * its own hard-coded toggles that were never saved and reset on every visit,
 * so it now opens that screen.
 */
export default function PushNotificationsScreen() {
  return <Redirect href={'/notifications-settings' as never} />;
}
