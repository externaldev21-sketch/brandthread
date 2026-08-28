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
import { BG, CARD, SURFACE, BORDER, FG, MUTED, SUBTLE, FONT, FS, SP, RADIUS, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
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
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM } = theme;
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
    <View style={[s.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Export My Data</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* What to include */}
        <Text style={s.sectionLabel}>What to include</Text>
        <View style={s.card}>
          {INCLUDE_OPTIONS.map((opt, i) => {
            const checked = include.includes(opt.key);
            return (
              <TouchableOpacity
                key={opt.key}
                style={[s.optRow, i > 0 && { borderTopWidth: 1, borderTopColor: BORDER }]}
                onPress={() => toggleInclude(opt.key)}
                activeOpacity={0.8}
              >
                <View style={[s.optIcon, { backgroundColor: checked ? PURPLE_DIM : SURFACE }]}>
                  <Feather name={opt.icon} size={16} color={checked ? PURPLE_LIGHT : MUTED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.optLabel}>{opt.label}</Text>
                  <Text style={s.optDesc}>{opt.desc}</Text>
                </View>
                <View style={[s.checkbox, checked && s.checkboxChecked]}>
                  {checked && <Feather name="check" size={13} color="#000" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Format */}
        <Text style={s.sectionLabel}>Format</Text>
        <View style={s.formatRow}>
          {(['json', 'csv'] as Format[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[s.formatBtn, format === f && s.formatBtnActive]}
              onPress={() => setFormat(f)}
              activeOpacity={0.8}
            >
              <Feather
                name={f === 'json' ? 'code' : 'file-text'}
                size={16}
                color={format === f ? PURPLE_LIGHT : MUTED}
              />
              <Text style={[s.formatLabel, format === f && s.formatLabelActive]}>
                {f.toUpperCase()}
              </Text>
              <Text style={s.formatDesc}>
                {f === 'json' ? 'Structured data' : 'Spreadsheet-ready'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Privacy note */}
        <View style={s.noteCard}>
          <Feather name="shield" size={14} color={MUTED} />
          <Text style={s.noteText}>
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
          <View style={s.resultCard}>
            <View style={s.resultHeader}>
              <Feather name="check-circle" size={18} color="#34D399" />
              <Text style={s.resultTitle}>Export ready!</Text>
            </View>
            <Text style={s.resultDate}>
              Generated {new Date(result.exportedAt).toLocaleString()}
            </Text>
            {Object.keys(result.counts).length > 0 && (
              <View style={s.countsRow}>
                {Object.entries(result.counts).map(([k, v]) => (
                  <View key={k} style={s.countChip}>
                    <Text style={s.countVal}>{v}</Text>
                    <Text style={s.countLabel}>{k}</Text>
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

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  scroll:       { padding: 16, paddingBottom: 100, gap: 16 },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: -8 },
  card:         { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  optRow:       { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  optIcon:      { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optLabel:     { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  optDesc:      { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  checkbox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: PURPLE, borderColor: PURPLE },
  formatRow:    { flexDirection: 'row', gap: 10 },
  formatBtn:    { flex: 1, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 14, alignItems: 'center', gap: 6 },
  formatBtnActive: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  formatLabel:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: MUTED },
  formatLabelActive: { color: PURPLE_LIGHT },
  formatDesc:   { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  noteCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: SURFACE, borderRadius: 10, padding: 12 },
  noteText:     { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },
  resultCard:   { backgroundColor: 'rgba(52,211,153,0.10)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(52,211,153,0.30)', padding: 16, gap: 8 },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultTitle:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  resultDate:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  countsRow:    { flexDirection: 'row', gap: 10, marginTop: 4 },
  countChip:    { flex: 1, backgroundColor: SURFACE, borderRadius: 8, padding: 10, alignItems: 'center', gap: 2 },
  countVal:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  countLabel:   { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
});
