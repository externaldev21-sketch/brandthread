import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

export default function AutomationScreen() {
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Automation" />
      <View style={styles.body}>
        <EmptyState
          icon="cpu"
          title="Automations are coming"
          description="Soon you'll set restock alerts, win-backs and more."
          action={{
            label: 'Back to dashboard',
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // The label promises the dashboard, so go there rather than
              // popping to whichever screen pushed this one.
              router.navigate('/(tabs)' as never);
            },
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
});
