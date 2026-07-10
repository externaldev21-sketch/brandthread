import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import * as Haptics from 'expo-haptics';

export default function BiometricUnlockScreen() {
  const colors = useColors();
  const [faceId, setFaceId] = useState(false);

  function toggle() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFaceId((v) => !v);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Security" />
      <View style={[styles.row, { borderBottomColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.foreground }]}>Unlock with Face ID</Text>
        <Switch
          value={faceId}
          onValueChange={toggle}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
        />
      </View>
      <View style={[styles.body, { backgroundColor: colors.secondary }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  label: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  body: { flex: 1 },
});
