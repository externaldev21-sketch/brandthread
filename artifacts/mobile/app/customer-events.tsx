import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/layout';

/**
 * This screen used to show a hardcoded fake "Klaviyo" pixel with fake
 * "Server/Web · Optimized" status and dead search/sort/more-menu controls.
 * None of it was backed by a real events-tracking API, so per the honesty
 * rules it's collapsed to an honest "not configurable" state instead.
 */
export default function CustomerEventsScreen() {
  const router = useRouter();
  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer events" onBack={() => goBackOr(router, "/seller-settings")} />
      {/* Shared empty-state badge + copy, same as every other seller
          empty state (was a bespoke icon + hard-coded type sizes). */}
      <EmptyState
        icon="activity"
        title="Not configurable from the app"
        message="Event pixels and customer-event tracking aren’t managed here."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
