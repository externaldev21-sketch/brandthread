import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

export default function CommunityChatScreen() {
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Community Chat" />
      <View style={styles.body}>
        <EmptyState
          icon="message-circle"
          title="Community chat opens soon"
          description="We're building a place for brand founders to talk shop."
          action={{
            label: 'Back to dashboard',
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
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
