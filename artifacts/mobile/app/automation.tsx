import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function AutomationScreen() {
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Automation" subtitle="Set it and forget it — your brand runs itself" />
      <View style={styles.body}>
        <EmptyState
          icon="cpu"
          title="Automations are coming"
          description="Soon you'll set restock alerts, win-backs and more."
          action={{
            label: 'Back to dashboard',
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              goBackOr(router);
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
