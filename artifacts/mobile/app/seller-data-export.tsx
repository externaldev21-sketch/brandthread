/**
 * Seller Data Export — request a JSON/CSV export of products, orders, customers.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Icon, type IconName } from '@/components/ui/Icon';
import { FONT, FS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { saveTextFile } from '@/lib/saveCsvFile';

type IncludeKey = 'products' | 'orders' | 'customers';
type Format = 'json' | 'csv';

const INCLUDE_OPTIONS: { key: IncludeKey; label: string; icon: IconName; desc: string }[] = [
  { key: 'products',  label: 'Products',  icon: 'package',      desc: 'All product listings, variants, and pricing' },
  { key: 'orders',    label: 'Orders',    icon: 'shopping-bag', desc: 'Order history, status, and fulfillment data' },
  { key: 'customers', label: 'Customers', icon: 'users',        desc: 'Customer contacts and purchase history' },
];

export default function SellerDataExportScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const api = useApi();

  const [include, setInclude] = useState<IncludeKey[]>(['products', 'orders', 'customers']);
  const [format, setFormat] = useState<Format>('json');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ counts: Record<string, number>; exportedAt: string } | null>(null);

  function toggleInclude(key: IncludeKey) {
    setInclude((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  async function handleExport() {
    if (include.length === 0) {
      Alert.alert('Select data', 'Choose at least one category to export.');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const data = await api.sellerExport.request(format, include);

      // Web downloads the file; native opens the share sheet. CSV arrives
      // from the server as a string.
      const saved = format === 'json'
        ? await saveTextFile(JSON.stringify(data, null, 2), `brandthread-export-${Date.now()}.json`, {
          mimeType: 'application/json', uti: 'public.json', dialogTitle: 'Export data',
        })
        : await saveTextFile(typeof data === 'string' ? data : JSON.stringify(data), `brandthread-export-${Date.now()}.csv`, {
          mimeType: 'text/csv', uti: 'public.comma-separated-values-text', dialogTitle: 'Export CSV',
        });
      if (saved === 'unavailable') {
        // No share sheet: the file would only sit in the app's private cache.
        Alert.alert(
          "Can't save the file here",
          "This device can't open a share sheet, so the export couldn't be saved. Try again on another device or in a web browser.",
        );
        return;
      }
      setResult(format === 'json'
        ? { counts: data.counts ?? {}, exportedAt: data.exportedAt ?? new Date().toISOString() }
        : { counts: {}, exportedAt: new Date().toISOString() });
    } catch (err) {
      Alert.alert('Export failed', 'Could not generate export. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
      <View style={styles.root}>
      <ScreenHeader title="Download my data" />

       <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* What to include */}
        <Text style={styles.sectionLabel}>Include</Text>
        <View style={styles.card}>
          {INCLUDE_OPTIONS.map((opt, i) => {
            const checked = include.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
                onPress={() => toggleInclude(opt.key)}
                activeOpacity={0.8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={opt.label}
              >
                <View style={[styles.optIcon, { backgroundColor: checked ? theme.accentDim : theme.surface }]}>
                  <Icon name={opt.icon} size={16} color={checked ? theme.accentLight : theme.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optLabel}>{opt.label}</Text>
                  <Text style={styles.optDesc}>{opt.desc}</Text>
                </View>
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Icon name="check" size={13} color={theme.onAccent} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Format */}
        <Text style={styles.sectionLabel}>Format</Text>
        <View style={styles.formatRow}>
          {(['json', 'csv'] as Format[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.formatBtn, format === f && styles.formatBtnActive]}
              onPress={() => setFormat(f)}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected: format === f }}
            >
              <Icon
                name={f === 'json' ? 'code' : 'file-text'}
                size={16}
                color={format === f ? theme.accentLight : theme.muted}
              />
              <Text style={[styles.formatLabel, format === f && styles.formatLabelActive]}>
                {f.toUpperCase()}
              </Text>
              <Text style={styles.formatDesc}>
                {f === 'json' ? 'Structured data' : 'Spreadsheet-ready'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Privacy note */}
        <View style={styles.noteCard}>
          <Icon name="shield" size={14} color={theme.muted} />
          <Text style={styles.noteText}>
            Exports contain only your own store data, including customer names and contact details. Store the file securely and handle it according to your privacy policy.
          </Text>
        </View>

        {/* Generate button */}
        <PrimaryButton
          label={loading ? 'Generating…' : 'Generate export'}
          onPress={handleExport}
          disabled={loading || include.length === 0}
          loading={loading}
          icon="download"
        />

        {/* Result */}
        {result && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Icon name="check-circle" size={18} color={theme.success} />
              <Text style={styles.resultTitle}>Export ready</Text>
            </View>
            <Text style={styles.resultDate}>
              Generated {new Date(result.exportedAt).toLocaleString()}
            </Text>
            {Object.keys(result.counts).length > 0 && (
              <View style={styles.countsRow}>
                {Object.entries(result.counts).map(([k, v]) => (
                  <View key={k} style={styles.countChip}>
                    <Text style={styles.countVal}>{v}</Text>
                    <Text style={styles.countLabel}>{k}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root:         { flex: 1, backgroundColor: 'transparent' },
  scroll:       { padding: 16, paddingBottom: 100, gap: 16 },
  sectionLabel: { fontSize: 12, fontFamily: FONT.semibold, color: theme.muted, marginBottom: -8 },
  card:         { backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border },
  optRow:       { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  optIcon:      { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  optLabel:     { fontSize: 15, fontFamily: FONT.semibold, color: theme.text },
  optDesc:      { fontSize: 11, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  checkbox:     { width: 22, height: 22, borderRadius: 8, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  formatRow:    { flexDirection: 'row', gap: 12 },
  formatBtn:    { flex: 1, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 16, alignItems: 'center', gap: 8 },
  formatBtnActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  formatLabel:  { fontSize: 15, fontFamily: FONT.bold, color: theme.muted },
  formatLabelActive: { color: theme.accentLight },
  formatDesc:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
  noteCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: theme.surface, borderRadius: 8, padding: 12 },
  noteText:     { flex: 1, fontSize: 12, fontFamily: FONT.regular, color: theme.muted, lineHeight: 16 },
  resultCard:   { backgroundColor: theme.success + '1A', borderRadius: 12, borderWidth: 1, borderColor: theme.success + '4D', padding: 16, gap: 8 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle:  { fontSize: 15, fontFamily: FONT.bold, color: theme.text },
  resultDate:   { fontSize: 12, fontFamily: FONT.regular, color: theme.muted },
  countsRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  countChip:    { flex: 1, backgroundColor: theme.surface, borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  countVal:     { fontSize: 16, fontFamily: FONT.bold, color: theme.text },
  countLabel:   { fontVariant: ['tabular-nums'],  fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted },
});
