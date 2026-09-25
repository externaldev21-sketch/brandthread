/**
 * Manufacturer Compare — pick 2-4 saved/favorited manufacturers and see them
 * side by side (MOQ, lead time, price range, rating, verified, response
 * time). Same layout family as rfq-compare.tsx, but for directory data.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';
import { formatCents } from '@/lib/money';
import { getFavoriteManufacturerIds, getManufacturer } from '@/services/manufacturerService';
import { Manufacturer } from '@/services/manufacturerTypes';

const MAX_COMPARE = 4;
const MIN_COMPARE = 2;
const COL_WIDTH = 180;
const LABEL_WIDTH = 110;

type Row = { label: string; format: (m: Manufacturer) => string; numeric?: (m: Manufacturer) => number; lowerIsBetter?: boolean };

const ROWS: Row[] = [
  { label: 'MOQ', format: (m) => m.moq > 0 ? `${m.moq} units` : 'Contact', numeric: (m) => m.moq || Infinity, lowerIsBetter: true },
  { label: 'Unit price', format: (m) => m.unitPriceMinCents > 0 ? `${formatCents(m.unitPriceMinCents)}–${formatCents(m.unitPriceMaxCents)}` : '—', numeric: (m) => m.unitPriceMinCents || Infinity, lowerIsBetter: true },
  { label: 'Lead time', format: (m) => m.leadTimeDays > 0 ? `${m.leadTimeDays} days` : '—', numeric: (m) => m.leadTimeDays || Infinity, lowerIsBetter: true },
  { label: 'Rating', format: (m) => m.reviewCount > 0 ? `★ ${m.rating.toFixed(1)} (${m.reviewCount})` : 'Not rated', numeric: (m) => m.reviewCount > 0 ? m.rating : 0, lowerIsBetter: false },
  { label: 'Response time', format: (m) => m.responseTimeHours > 0 ? `~${m.responseTimeHours}h` : '—', numeric: (m) => m.responseTimeHours || Infinity, lowerIsBetter: true },
  { label: 'Years active', format: (m) => m.yearsInBusiness > 0 ? `${m.yearsInBusiness} yrs` : '—', numeric: (m) => m.yearsInBusiness, lowerIsBetter: false },
  { label: 'Verified', format: (m) => m.isVerified ? '✓ Verified' : '✗ Unverified' },
];

export default function ManufacturerCompareScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();

  const [saved, setSaved] = useState<Manufacturer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const ids = await getFavoriteManufacturerIds();
      const profiles = await Promise.all(ids.map((id) => getManufacturer(id)));
      const list = profiles.filter((m): m is Manufacturer => !!m);
      setSaved(list);
      setSelected(new Set(list.slice(0, MIN_COMPARE).map((m) => m.id)));
    } catch {
      setSaved([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      if (next.size >= MAX_COMPARE) return prev;
      next.add(id);
      return next;
    });
  };

  const compared = saved.filter((m) => selected.has(m.id));

  return (
    <View style={s.root}>
      <Header title="Compare Suppliers" onBack={() => router.back()} />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : saved.length === 0 ? (
        <EmptyState icon="heart" title="No saved manufacturers yet" description="Save manufacturers from Discover, then compare them here." action={{ label: 'Browse manufacturers', onPress: () => router.push('/manufacturer-hub' as never) }} />
      ) : (
        <>
          <View style={s.pickerWrap}>
            <Text style={s.pickerLabel}>Pick {MIN_COMPARE}–{MAX_COMPARE} to compare</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pickerRow}>
              {saved.map((m) => {
                const active = selected.has(m.id);
                return (
                  <TouchableOpacity key={m.id} style={[s.pickerChip, active && s.pickerChipActive]} onPress={() => toggle(m.id)} testID={`compare-pick-${m.id}`}>
                    <Text style={[s.pickerChipText, active && s.pickerChipTextActive]} numberOfLines={1}>{m.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {compared.length < MIN_COMPARE ? (
            <EmptyState icon="git-branch" title={`Select at least ${MIN_COMPARE} manufacturers`} description="Choose which saved suppliers to compare side by side." />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
              <View style={s.labelCol}>
                <View style={s.labelHeader} />
                {ROWS.map((row) => <View key={row.label} style={s.labelCell}><Text style={s.labelText}>{row.label}</Text></View>)}
              </View>
              {compared.map((m) => {
                const bestValues = ROWS.filter((r) => r.numeric).map((row) => {
                  const vals = compared.map((mm) => row.numeric!(mm));
                  return row.lowerIsBetter ? Math.min(...vals) : Math.max(...vals);
                });
                return (
                  <View key={m.id} style={s.col}>
                    <TouchableOpacity style={s.colHeader} onPress={() => router.push(`/manufacturer-profile?id=${m.id}` as never)} activeOpacity={0.85}>
                      <Text style={s.mfgName} numberOfLines={2}>{m.name}</Text>
                      <Text style={s.location} numberOfLines={1}>{[m.city, m.country].filter(Boolean).join(', ')}</Text>
                    </TouchableOpacity>
                    {ROWS.map((row, idx) => {
                      const val = row.format(m);
                      const isBest = row.numeric && compared.length > 1 && row.numeric(m) === bestValues[ROWS.filter((r) => r.numeric).indexOf(row)];
                      return (
                        <View key={row.label} style={[s.cell, isBest && s.cellBest]}>
                          <Text style={[s.cellText, isBest && s.cellTextBest]} numberOfLines={2}>{val}</Text>
                        </View>
                      );
                    })}
                    <TouchableOpacity style={s.quoteBtn} onPress={() => router.push(`/quote-request?manufacturerId=${m.id}` as never)}>
                      <Feather name="file-text" size={13} color={theme.onAccent} />
                      <Text style={s.quoteBtnText}>Request quote</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pickerWrap: { paddingTop: SP.sm, borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: SP.sm },
  pickerLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginLeft: SP.md, marginBottom: SP.xs },
  pickerRow: { paddingHorizontal: SP.md, gap: SP.sm },
  pickerChip: { paddingHorizontal: SP.md, height: 34, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center', maxWidth: 160 },
  pickerChipActive: { backgroundColor: theme.accentDim, borderColor: theme.accent },
  pickerChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  pickerChipTextActive: { color: theme.accentLight, fontFamily: FONT.semibold },
  scrollContent: { paddingHorizontal: SP.md, paddingVertical: SP.md, paddingBottom: 40 },
  labelCol: { width: LABEL_WIDTH, marginRight: 1 },
  labelHeader: { height: 72 },
  labelCell: { height: 44, justifyContent: 'center', borderTopWidth: 1, borderTopColor: theme.border, paddingRight: SP.sm },
  labelText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  col: { width: COL_WIDTH, marginLeft: SP.sm, backgroundColor: theme.cardGlass, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  colHeader: { height: 72, padding: SP.sm, justifyContent: 'center', backgroundColor: theme.cardElevated },
  mfgName: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },
  location: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
  cell: { height: 44, justifyContent: 'center', paddingHorizontal: SP.sm, borderTopWidth: 1, borderTopColor: theme.border },
  cellBest: { backgroundColor: theme.accentDim },
  cellText: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  cellTextBest: { color: theme.accentLight, fontFamily: FONT.bold },
  quoteBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 40, margin: SP.sm, borderRadius: RADIUS.sm, backgroundColor: theme.accent },
  quoteBtnText: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.onAccent },
});
