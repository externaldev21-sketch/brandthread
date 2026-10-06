/**
 * Legacy route. It used to be a local-only mock (toggles in useState, never
 * saved, seller-only rows) reached from buyer Settings (QA-0057). The real,
 * persisted preferences live on /notifications-settings, which shows buyer or
 * seller toggles for the signed-in role plus the promotional opt-in.
 */
import { Redirect } from 'expo-router';

export default function PushNotificationsRedirect() {
  return <Redirect href="/notifications-settings" />;
}
