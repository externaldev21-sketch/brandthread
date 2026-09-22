/**
 * Seller Data Export — request a JSON/CSV export of products, orders, customers.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Share, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';

type IncludeKey = 'products' | 'orders' | 'customers';
type Format = 'json' | 'csv';

const INCLUDE_OPTIONS: { key: IncludeKey; label: string; icon: keyof typeof Feather.glyphMap; desc: string }[] = [
  { key: 'products',  label: 'Products',  icon: 'package',      desc: 'All product listings, variants, and pricing' },
  { key: 'orders',    label: 'Orders',    icon: 'shopping-bag', desc: 'Order history, status, and fulfillment data' },
  { key: 'customers', label: 'Customers', icon: 'users',        desc: 'Customer contacts and purchase history' },
];

export default function SellerDataExportScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

      if (format === 'json') {
        // Write JSON to a temp file and share
        const json = JSON.stringify(data, null, 2);
        const file = new File(Paths.cache, `brandthread-export-${Date.now()}.json`);
        file.write(json);
        const uri = file.uri;
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Export Data' });
        } else {
          Alert.alert('Export ready', `Saved to ${uri}`);
        }
        setResult({ counts: data.counts ?? {}, exportedAt: data.exportedAt ?? new Date().toISOString() });
      } else {
        // CSV: data is a string from server
        const csv = typeof data === 'string' ? data : JSON.stringify(data);
        const file = new File(Paths.cache, `brandthread-export-${Date.now()}.csv`);
        file.write(csv);
        const uri = file.uri;
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export CSV' });
        } else {
          Alert.alert('Export ready', `Saved to ${uri}`);
        }
        setResult({ counts: {}, exportedAt: new Date().toISOString() });
      }
    } catch (err) {
      Alert.alert('Export failed', 'Could not generate export. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
      <View style={[styles.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Export My Data</Text>
        <View style={{ width: 22 }} />
      </View>

       <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* What to include */}
        <Text style={styles.sectionLabel}>What to include</Text>
        <View style={styles.card}>
          {INCLUDE_OPTIONS.map((opt, i) => {
            const checked = include.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optRow, i > 0 && { borderTopWidth: 1, borderTopColor: theme.border }]}
                onPress={() => toggleInclude(opt.key)}
                activeOpacity={0.8}
              >
                <View style={[styles.optIcon, { backgroundColor: checked ? theme.accentDim : theme.surface }]}>
                  <Feather name={opt.icon} size={16} color={checked ? theme.accentLight : theme.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.optLabel}>{opt.label}</Text>
                  <Text style={styles.optDesc}>{opt.desc}</Text>
                </View>
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <Feather name="check" size={13} color={theme.onAccent} />}
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
            >
              <Feather
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
          <Feather name="shield" size={14} color={theme.muted} />
          <Text style={styles.noteText}>
            Exports contain only your own seller data. Customer PII is included — store securely and handle per your privacy policy.
          </Text>
        </View>

        {/* Generate button */}
        <PrimaryButton
          label={loading ? 'Generating…' : 'Generate Export'}
          onPress={handleExport}
          disabled={loading || include.length === 0}
          loading={loading}
          icon="download"
        />

        {/* Result */}
        {result && (
          <View style={styles.resultCard}>
            <View style={styles.resultHeader}>
              <Feather name="check-circle" size={18} color={theme.success} />
              <Text style={styles.resultTitle}>Export ready!</Text>
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
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.border },
  headerTitle:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: theme.text },
  scroll:       { padding: 16, paddingBottom: 100, gap: 16 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: -8 },
  card:         { backgroundColor: theme.card, borderRadius: 14, borderWidth: 1, borderColor: theme.border },
  optRow:       { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  optIcon:      { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optLabel:     { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: theme.text },
  optDesc:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: theme.muted, marginTop: 2 },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: theme.accent, borderColor: theme.accent },
  formatRow:    { flexDirection: 'row', gap: 10 },
  formatBtn:    { flex: 1, backgroundColor: theme.card, borderRadius: 12, borderWidth: 1, borderColor: theme.border, padding: 14, alignItems: 'center', gap: 6 },
  formatBtnActive: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  formatLabel:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: theme.muted },
  formatLabelActive: { color: theme.accentLight },
  formatDesc:   { fontSize: FS.xs, fontFamily: 'Inter_400Regular', color: theme.muted },
  noteCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: theme.surface, borderRadius: 10, padding: 12 },
  noteText:     { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: theme.muted, lineHeight: 18 },
  resultCard:   { backgroundColor: theme.success + '1A', borderRadius: 14, borderWidth: 1, borderColor: theme.success + '4D', padding: 16, gap: 8 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: theme.text },
  resultDate:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: theme.muted },
  countsRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  countChip:    { flex: 1, backgroundColor: theme.surface, borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  countVal:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: theme.text },
  countLabel:   { fontSize: FS.xs, fontFamily: 'Inter_400Regular', color: theme.muted },
});
