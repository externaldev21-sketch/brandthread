import React from 'react';
import { Redirect } from 'expo-router';

/**
 * Customer-account configuration has no real endpoint yet, so there is
 * nothing to configure here (the old screen was a fake Shopify-admin clone,
 * then a dead-end "not configurable" message). Its entry points ("Customers —
 * Browse your customer list") now open the real customer list; any stale
 * link to this route lands there too.
 */
export default function CustomerAccountsScreen() {
  return <Redirect href="/customers" />;
}
