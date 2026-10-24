import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { EmptyState } from '@/components/layout';

/**
 * This screen used to show fabricated compliance status ("Brandthread
 * Network Intelligence — Enabled", cookie-banner region counts, a data
 * hosting location) with about 15 rows that only fired a haptic. None of
 * it reflected real settings, so per the honesty rules it's collapsed to
 * an honest "not configurable" state instead.
 */
export default function CustomerPrivacyScreen() {
  const router = useRouter();
  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer privacy" onBack={() => goBackOr(router, "/seller-settings")} />
      {/* Shared empty-state badge + copy, same as every other seller
          empty state (was a bespoke icon + hard-coded type sizes). */}
      <EmptyState
        icon="shield"
        title="Not configurable from the app"
        message="Privacy and data-sharing settings aren’t managed here."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
