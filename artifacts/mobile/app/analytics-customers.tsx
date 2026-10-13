import React from 'react';
import { Redirect } from 'expo-router';

/** Customer analytics stays in the consolidated Reports implementation. */
export default function CustomerAnalyticsRedirect() {
  return <Redirect href="/reports" />;
}
