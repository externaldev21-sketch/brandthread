/**
 * Export analytics — CSV (or PDF) of orders, products, analytics, threads and
 * videos, audience and goals for a Dashboard range, generated server-side and
 * handed to the share sheet (web: download). Pattern mirrors
 * app/seller-data-export.tsx. Data: POST /api/analytics/insights/export.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { Card, CardDivider, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { SegmentedPills, useReportBottomInset } from '@/components/analytics/InsightFrame';
import { DEFAULT_INSIGHT_RANGE, INSIGHT_RANGES, previewMode, requestExport, type ExportSectionKey, type InsightRange } from '@/services/sellerInsightsService';
import { saveExportFile } from '@/lib/saveExportFile';
import { crispPx } from '@/lib/crispPixel';

const SECTIONS: { key: ExportSectionKey; label: string; detail: string }[] = [
  { key: 'orders', label: 'Orders', detail: 'One row per order with totals, refunds and location' },
  { key: 'products', label: 'Products', detail: 'Views, add-to-carts, purchases and revenue per product' },
  { key: 'analytics', label: 'Analytics', detail: 'Visits, orders, revenue and followers per day' },
  { key: 'content', label: 'Threads and videos', detail: 'Views, engagement and sales per post' },
  { key: 'audience', label: 'Audience', detail: 'Followers, new vs returning, locations, devices' },
  { key: 'goals', label: 'Goals', detail: 'Targets with progress and pace' },
];

export default function AnalyticsExportScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const bottom = useReportBottomInset();
  const [range, setRange] = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [picked, setPicked] = useState<ExportSectionKey[]>(['orders', 'products', 'analytics']);
  const [busy, setBusy] = useState(false);

  const toggle = (k: ExportSectionKey) => { Haptics.selectionAsync(); setPicked(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k])); };

  async function onExport() {
    if (previewMode()) { Alert.alert('Preview', 'Exports are generated for signed-in sellers.'); return; }
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
      <ScreenHeader title="Export" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: bottom }} showsVerticalScrollIndicator={false}>
        <SegmentedPills options={INSIGHT_RANGES} value={range} onChange={setRange} />
        <SectionTitle>Include</SectionTitle>
        <Card>
          {SECTIONS.map((sec, i) => {
            const on = picked.includes(sec.key);
            return (
              <View key={sec.key}>
                {i > 0 && <CardDivider />}
                <TouchableOpacity style={s.row} onPress={() => toggle(sec.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={sec.label}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.label}>{sec.label}</Text>
                    <Text style={s.detail}>{sec.detail}</Text>
                  </View>
                  <View style={[s.box, on && s.boxOn]}>{on && <Feather name="check" size={13} color={colors.primaryForeground} />}</View>
                </TouchableOpacity>
              </View>
            );
          })}
        </Card>
        <SectionTitle>Format</SectionTitle>
        <SegmentedPills<'csv' | 'pdf'> options={[{ key: 'csv', label: 'CSV' }, { key: 'pdf', label: 'PDF' }]} value={format} onChange={setFormat} />
        <PrimaryButton label={busy ? 'Preparing…' : `Export ${format.toUpperCase()}`} icon="download" onPress={onExport} loading={busy} disabled={busy || picked.length === 0} />
      </ScrollView>
    </View>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 56, paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  detail: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  box: { width: 22, height: 22, borderRadius: RADIUS.xs, borderWidth: crispPx(1.5), borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
});
