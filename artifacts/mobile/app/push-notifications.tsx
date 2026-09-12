import React, { useState } from 'react';
import { ScrollView, View, Text, Switch, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import * as Haptics from 'expo-haptics';

interface ToggleRow {
  key: string;
  label: string;
  description?: string;
  default: boolean;
}

interface ToggleGroup {
  title: string;
  subtitle?: string;
  rows: ToggleRow[];
}

const GROUPS: ToggleGroup[] = [
  {
    title: 'Mobile notifications',
    rows: [
      { key: 'criticalAlerts', label: 'Critical alerts', description: 'Issues like an expiring domain or a payment failure', default: true },
      { key: 'fulfillments', label: 'Fulfillments', default: true },
      { key: 'newOrders', label: 'New orders', default: true },
      { key: 'setupTips', label: 'Setup tips', default: true },
      { key: 'timelineMentions', label: 'Timeline mentions', default: true },
    ],
  },
  {
    title: 'Notification badge',
    subtitle: 'Only applies to unfulfilled orders.',
    rows: [
      { key: 'badgeNewOrders', label: 'New orders', default: false },
    ],
  },
  {
    title: 'Account notifications',
    rows: [
      { key: 'securityUpdates', label: 'Security updates', default: true },
      { key: 'mfa', label: 'Multi-factor authentication', default: true },
    ],
  },
];

export default function PushNotificationsScreen() {
  const colors = useColors();
  const [values, setValues] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    GROUPS.forEach((g) => g.rows.forEach((r) => { initial[r.key] = r.default; }));
    return initial;
  });

  function toggle(key: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Push notifications" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 60, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        {GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={[styles.groupTitle, { color: colors.foreground }]}>{group.title}</Text>
            {group.subtitle && (
              <Text style={[styles.groupSubtitle, { color: colors.mutedForeground }]}>{group.subtitle}</Text>
            )}
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {group.rows.map((row, i) => (
                <View
                  key={row.key}
                  style={[
                    styles.row,
                    i !== group.rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={[styles.rowLabel, { color: colors.foreground }]}>{row.label}</Text>
                    {row.description && (
                      <Text style={[styles.rowDescription, { color: colors.mutedForeground }]}>{row.description}</Text>
                    )}
                  </View>
                  <Switch
                    value={values[row.key]}
                    onValueChange={() => toggle(row.key)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  group: { marginBottom: 22 },
  groupTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  groupSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 10 },
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  rowDescription: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
});
