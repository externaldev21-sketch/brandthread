import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Privacy / data-sharing settings have no real API yet (the old screen
 * showed fabricated compliance status, then a dead-end placeholder).
 * Nothing in the app links here; a stale deep link lands on seller
 * settings instead.
 */
export default function CustomerPrivacyScreen() {
  return <Redirect href="/seller-settings" />;
}
