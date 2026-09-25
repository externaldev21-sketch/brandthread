import React, { useState } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { hapticToggle } from '@/lib/haptics';
import { ListRow } from '@/components/ui/ListRow';
import { Card } from '@/components/ui/Card';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { FONT } from '@/lib/theme';

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
    hapticToggle();
    setValues((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Push notifications" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: SPACING.md + 4, paddingBottom: 60, paddingHorizontal: SPACING.md + 4 }}
        showsVerticalScrollIndicator={false}
      >
        {GROUPS.map((group) => (
          <View key={group.title} style={styles.group}>
            <Text style={[TYPE_SCALE.footnote, styles.groupTitle, { color: colors.foreground }]}>{group.title}</Text>
            {group.subtitle && (
              <Text style={[TYPE_SCALE.footnote, styles.groupSubtitle, { color: colors.mutedForeground }]}>{group.subtitle}</Text>
            )}
            <Card style={styles.card}>
              {group.rows.map((row, i) => (
                <React.Fragment key={row.key}>
                  <ListRow
                    title={row.label}
                    subtitle={row.description}
                    toggle={{ value: values[row.key], onChange: () => toggle(row.key) }}
                  />
                  {i !== group.rows.length - 1 && (
                    <View style={[styles.rowDivider, { backgroundColor: colors.border }]} />
                  )}
                </React.Fragment>
              ))}
            </Card>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  group: { marginBottom: SPACING.xl - 2 },
  groupTitle: { fontFamily: FONT.semibold, marginBottom: SPACING.xxs },
  groupSubtitle: { marginBottom: SPACING.sm - 2 },
  card: { padding: SPACING.sm },
  rowDivider: { height: StyleSheet.hairlineWidth },
});
