/**
 * Export analytics — CSV or PDF of selected sections for a date range,
 * generated server-side and handed to the share sheet (web: download).
 * Pattern mirrors app/seller-data-export.tsx.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { SegmentedPills } from '@/components/analytics/InsightFrame';
import { INSIGHT_RANGES, requestExport, type ExportSectionKey, type InsightRange } from '@/services/sellerInsightsService';
import { saveExportFile } from '@/lib/saveExportFile';

const SECTIONS: { key: ExportSectionKey; label: string }[] = [
  { key: 'products', label: 'Product stats' },
  { key: 'content', label: 'Threads and videos' },
  { key: 'audience', label: 'Audience' },
  { key: 'best_time', label: 'Best time to post' },
  { key: 'goal', label: 'Monthly goal' },
];

export default function AnalyticsExportScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>('30d');
  const [format, setFormat] = useState<'csv' | 'pdf'>('pdf');
  const [picked, setPicked] = useState<ExportSectionKey[]>(SECTIONS.map(x => x.key));
  const [busy, setBusy] = useState(false);

  const toggle = (k: ExportSectionKey) => setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));

  async function onExport() {
    setBusy(true);
    try {
      const file = await requestExport(format, range, picked);
      const done = await saveExportFile(file);
      if (!done) Alert.alert('Export ready', 'Sharing is not available on this device.');
    } catch {
      Alert.alert('Export failed', 'Could not generate the export. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Export analytics" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm }} showsVerticalScrollIndicator={false}>
        <SegmentedPills options={INSIGHT_RANGES} value={range} onChange={setRange} />
        <SectionTitle>Sections</SectionTitle>
        <Card>
          {SECTIONS.map((sec, i) => {
            const on = picked.includes(sec.key);
            return (
              <View key={sec.key}>
                {i > 0 && <CardDivider />}
                <TouchableOpacity style={s.row} onPress={() => toggle(sec.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Text style={s.label}>{sec.label}</Text>
                  <View style={[s.box, on && s.boxOn]}>{on && <Feather name="check" size={13} color={colors.background} />}</View>
                </TouchableOpacity>
              </View>
            );
          })}
        </Card>
        <SectionTitle>Format</SectionTitle>
        <SegmentedPills<'csv' | 'pdf'> options={[{ key: 'pdf', label: 'PDF' }, { key: 'csv', label: 'CSV' }]} value={format} onChange={setFormat} />
        <PrimaryButton label={busy ? 'Generating...' : 'Export'} icon="download" onPress={onExport} loading={busy} disabled={busy || picked.length === 0} />
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
  box: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
