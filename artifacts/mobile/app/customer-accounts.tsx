import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/layout';

/**
 * This screen used to be a static Shopify-admin clone: fake sign-in-link
 * toggles, a fake account URL, and half a dozen "Customize"/"Manage" buttons
 * that only fired a haptic. None of it was backed by a real API, so per the
 * honesty rules it's collapsed to an honest "not configurable" state
 * instead of shipping fabricated settings. Bring the real UI back once
 * customer-account configuration has a real endpoint.
 */
export default function CustomerAccountsScreen() {
  const router = useRouter();
  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer accounts" onBack={() => goBackOr(router, "/seller-settings")} />
      {/* Shared empty-state badge + copy, same as every other seller
          empty state (was a bespoke icon + hard-coded type sizes). */}
      <EmptyState
        icon="user"
        title="Not configurable from the app"
        message="Customer account settings aren’t editable here. Your customer list and order history are under Customers."
        actionLabel="View customers"
        onAction={() => router.push('/customers' as never)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
