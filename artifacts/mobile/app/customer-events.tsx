import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Event pixels / tracking have no real API yet (the old screen showed a
 * fake "Klaviyo" pixel, then a dead-end placeholder). Nothing in the app
 * links here; a stale deep link lands on seller settings instead.
 */
export default function CustomerEventsScreen() {
  return <Redirect href="/seller-settings" />;
}
