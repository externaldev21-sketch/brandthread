import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';

// Compatibility route for old links. The authenticated Manufacturer Hub is the
// only manufacturer dashboard and therefore the only source of displayed data.
export default function ManufacturerCompatibilityRoute() {
  const router = useRouter();
  const colors = useColors();

  useEffect(() => {
    router.replace('/manufacturer-hub' as never);
  }, [router]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color={colors.primary} />
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Opening Manufacturer Hub…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: 'transparent',
  },
  label: {
    fontFamily: FONT.medium,
    fontSize: 13,
  },
});

