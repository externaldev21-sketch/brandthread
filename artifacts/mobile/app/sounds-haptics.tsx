/**
 * Settings › Sounds & haptics — the on/off switch every haptic in the app
 * respects (lib/haptics.ts). Modeled on iOS Settings › Sounds & Haptics:
 * one grouped card, a switch per row, same header as the rest of Settings.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { ListRow } from '@/components/ui';
import { Card } from '@/components/ui/Card';
import { SPACING } from '@/constants/spacing';
import { useHapticsEnabled } from '@/lib/hapticsPreference';

export default function SoundsHapticsScreen() {
  const router = useRouter();
  const [hapticsOn, setHapticsOn] = useHapticsEnabled();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Sounds & haptics" divider={false} onBack={() => goBackOr(router, '/(tabs)/more')} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 140 }} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Card>
            <ListRow
              icon="smartphone"
              title="Haptics"
              toggle={{ value: hapticsOn, onChange: setHapticsOn }}
              testID="haptics-toggle"
            />
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  section: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.md + 2 },
});
