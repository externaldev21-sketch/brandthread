import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';

/**
 * This screen used to be a static Shopify-admin clone: fake sign-in-link
 * toggles, a fake account URL, and half a dozen "Customize"/"Manage" buttons
 * that only fired a haptic. None of it was backed by a real API, so per the
 * honesty rules it's collapsed to an honest "not available yet" state
 * instead of shipping fabricated settings. Bring the real UI back once
 * customer-account configuration has a real endpoint.
 */
export default function CustomerAccountsScreen() {
  const colors = useColors();
  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Customer accounts" />
      <View style={styles.empty}>
        <Feather name="user" size={28} color={colors.mutedForeground} />
        <Text style={[styles.title, { color: colors.foreground }]}>Not available yet</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Customer account settings aren{'’'}t configurable from the app yet.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  title: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  body: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 18 },
});
