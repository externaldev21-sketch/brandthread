/**
 * "Compare all features": every plan difference in one table, one row each.
 * Rows and values come from the shared plan config (lib/planTiers.ts
 * compareRows); a row the config doesn't define isn't shown.
 */
import React from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { compareRows, type CompareValue, type PlanTier } from '@/lib/planTiers';

function Cell({ value, color, muted }: { value: CompareValue; color: string; muted: string }) {
  if (value === true) return <Icon name="check" size={17} color={color} />;
  if (value === false) return <Text style={[styles.cellText, { color: muted }]} accessibilityLabel="Not included">—</Text>;
  return <Text style={[styles.cellText, { color }]}>{value}</Text>;
}

export function CompareFeaturesSheet({
  visible, onClose, tiers, commissionPercent,
}: {
  visible: boolean;
  onClose: () => void;
  tiers: PlanTier[];
  commissionPercent: number | null;
}) {
  const palette = useColors();
  const rows = compareRows(tiers, commissionPercent);
  const { height } = Dimensions.get('window');
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="plan-compare-sheet">
      <View style={styles.body}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>Compare all features</Text>
      <View style={[styles.row, styles.headRow, { borderBottomColor: palette.border }]}>
        <View style={styles.labelCol} />
        {tiers.map((t) => (
          <Text key={t.id} style={[styles.headCell, { color: palette.foreground }]}>{t.name}</Text>
        ))}
      </View>
      <ScrollView style={{ maxHeight: Math.max(240, height * 0.55) }} showsVerticalScrollIndicator={false}>
        {rows.map((row) => (
          <View key={row.label} testID={`plan-compare-row-${row.label}`} style={[styles.row, { borderBottomColor: palette.border }]}>
            <Text style={[styles.labelCol, styles.label, { color: palette.mutedForeground }]}>{row.label}</Text>
            {row.values.map((v, i) => (
              <View key={tiers[i]?.id ?? i} style={styles.cell}>
                <Cell value={v} color={palette.foreground} muted={palette.mutedForeground} />
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...TEXT.headline, marginBottom: SPACING.sm },
  body: { paddingHorizontal: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  headRow: { paddingTop: 0 },
  labelCol: { flex: 1.6, paddingRight: SPACING.xs },
  label: { ...TEXT.footnote },
  headCell: { ...TEXT.footnote, fontFamily: FONT.semibold, flex: 1, textAlign: 'center' },
  cell: { flex: 1, alignItems: 'center' },
  cellText: { ...TEXT.footnote, textAlign: 'center' },
});
