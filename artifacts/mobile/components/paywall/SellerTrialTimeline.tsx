/**
 * Compact 3-step vertical trial timeline (Blinkist-style): Today / reminder
 * day / billing day. `steps` is passed in so the labels always match the
 * real trial length instead of being hard-coded here.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { useAppTheme } from '@/contexts/AppThemeContext';

export interface TrialTimelineStep {
  key: string;
  label: string;
  detail: string;
  icon: keyof typeof Feather.glyphMap;
}

export interface SellerTrialTimelineProps {
  theme: ReturnType<typeof useAppTheme>['theme'];
  steps: TrialTimelineStep[];
}

export function SellerTrialTimeline({ theme, steps }: SellerTrialTimelineProps) {
  return (
    <View style={[styles.timeline, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {steps.map((step, index) => (
        <View key={step.key} style={styles.row}>
          <View style={styles.iconCol}>
            <View style={[styles.iconCircle, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
              <Feather name={step.icon} size={13} color={theme.text} />
            </View>
            {index < steps.length - 1 && <View style={[styles.connector, { backgroundColor: theme.border }]} />}
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.label, { color: theme.text }]}>{step.label}</Text>
            <Text style={[styles.detail, { color: theme.muted }]}>{step.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md },
  row: { flexDirection: 'row', gap: 12 },
  iconCol: { alignItems: 'center' },
  iconCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  connector: { width: 1, flex: 1, minHeight: 18, marginVertical: 2 },
  textCol: { flex: 1, paddingBottom: 16 },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold },
  detail: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 1 },
});
