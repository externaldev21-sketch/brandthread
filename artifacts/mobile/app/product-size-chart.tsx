/**
 * Product Size Chart Editor
 *
 * Sellers add/edit a size chart (measurement table) for a specific product.
 * Saved as structured JSON to products.sizeChart via PUT /api/products/:id.
 *
 * Route: /product-size-chart?productId=<uuid>
 */
import React, { useState, useEffect, useMemo } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { BrandthreadHeader, PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SizeChartRow { size: string; values: string[] }
interface SizeChart {
  columns: string[];   // measurement labels: ['Chest', 'Waist', 'Hip', 'Length']
  rows:    SizeChartRow[];  // one row per size: {size:'M', values:['38','30','40','28']}
  unit?:   string;     // 'inches' | 'cm'
  notes?:  string;
}

const DEFAULT_COLUMNS = ['Chest', 'Waist', 'Hip', 'Length'];
const DEFAULT_SIZES   = ['XS', 'S', 'M', 'L', 'XL'];

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ProductSizeChartScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const t = useMemo(() => makeTableStyles(theme), [theme]);
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const router = useRouter();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api    = useApi();

  const [loading, setLoading]     = useState(true);
  const [saving,  setSaving]      = useState(false);

  const [columns, setColumns]   = useState<string[]>(DEFAULT_COLUMNS);
  const [rows,    setRows]      = useState<SizeChartRow[]>(
    DEFAULT_SIZES.map(size => ({ size, values: new Array(DEFAULT_COLUMNS.length).fill('') }))
  );
  const [unit,    setUnit]      = useState<'inches' | 'cm'>('inches');
  const [notes,   setNotes]     = useState('');
  const [newColName, setNewColName] = useState('');
  const [newSizeName, setNewSizeName] = useState('');

  // Load existing chart from product
  function loadProduct() {
    if (!productId || !userId) { setLoading(false); return; }
    setLoading(true);
    const req = (api as any).products?.get?.(productId);
    if (!req) { setLoading(false); return; }
    req
      .then((p: any) => {
        const chart: SizeChart | null = p?.sizeChart ?? null;
        if (chart?.columns?.length) {
          setColumns(chart.columns);
          setRows(chart.rows ?? []);
          setUnit((chart.unit as any) ?? 'inches');
          setNotes(chart.notes ?? '');
        } else {
          // No existing chart — start with blank defaults (not an error)
          setColumns(DEFAULT_COLUMNS);
          setRows(DEFAULT_SIZES.map(size => ({ size, values: new Array(DEFAULT_COLUMNS.length).fill('') })));
        }
      })
      .catch(() => {
        // A failed read leaves the editor in its blank, editable state.
        setColumns(DEFAULT_COLUMNS);
        setRows(DEFAULT_SIZES.map(size => ({ size, values: new Array(DEFAULT_COLUMNS.length).fill('') })));
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadProduct(); }, [productId, userId]);

  // ── Cell edit ───────────────────────────────────────────────────────────────
  function updateCell(rowIdx: number, colIdx: number, value: string) {
    setRows(prev => prev.map((r, ri) => ri !== rowIdx ? r : {
      ...r,
      values: r.values.map((v, ci) => ci !== colIdx ? v : value),
    }));
  }

  function updateSizeLabel(rowIdx: number, value: string) {
    setRows(prev => prev.map((r, ri) => ri !== rowIdx ? r : { ...r, size: value }));
  }

  // ── Add / remove columns ────────────────────────────────────────────────────
  function addColumn() {
    const name = newColName.trim();
    if (!name) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setColumns(prev => [...prev, name]);
    setRows(prev => prev.map(r => ({ ...r, values: [...r.values, ''] })));
    setNewColName('');
  }

  function removeColumn(idx: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setColumns(prev => prev.filter((_, i) => i !== idx));
    setRows(prev => prev.map(r => ({ ...r, values: r.values.filter((_, i) => i !== idx) })));
  }

  // ── Add / remove rows ────────────────────────────────────────────────────────
  function addRow() {
    const size = newSizeName.trim();
    if (!size) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRows(prev => [...prev, { size, values: new Array(columns.length).fill('') }]);
    setNewSizeName('');
  }

  function removeRow(idx: number) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRows(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Save ─────────────────────────────────────────────────────────────────────
  async function save() {
    if (!productId) return;
    if (columns.length === 0) { Alert.alert('Add at least one measurement column'); return; }
    if (rows.length === 0)    { Alert.alert('Add at least one size row'); return; }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const chart: SizeChart = {
        columns,
        rows: rows.filter(r => r.size.trim()),
        unit,
        notes: notes.trim() || undefined,
      };
      await (api as any).products.update(productId, { sizeChart: chart });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', 'Size chart updated successfully.', [
        { text: 'OK', onPress: () => goBackOr(router) },
      ]);
    } catch {
      Alert.alert('Error', 'Could not save size chart. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function clearChart() {
    Alert.alert('Remove size chart?', 'This will remove the size chart from this product.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => {
          setSaving(true);
          try {
            await (api as any).products.update(productId, { sizeChart: null });
            goBackOr(router);
          } catch { Alert.alert('Error', 'Could not remove size chart.'); }
          finally { setSaving(false); }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: headerTopInset, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.accentLight} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: headerTopInset }]}>
      <BrandthreadHeader
        title="Size Chart"
        subtitle={productName ?? undefined}
        onBack={() => goBackOr(router)}
      />

      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        horizontal={false}
      >
        {/* Unit toggle */}
        <View style={s.unitRow}>
          <Text style={s.label}>Measurement unit</Text>
          <View style={s.unitToggle}>
            {(['inches', 'cm'] as const).map(u => (
              <TouchableOpacity
                key={u}
                style={[s.unitBtn, u === 'inches' ? s.unitBtnFirst : s.unitBtnLast, unit === u && s.unitBtnActive]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUnit(u); }}
                activeOpacity={0.7}
                hitSlop={UNIT_BTN_HIT_SLOP}
                accessibilityRole="button"
                accessibilityState={{ selected: unit === u }}
              >
                <Text style={[s.unitBtnText, unit === u && { color: theme.accentLight }]}>{u}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Measurement columns */}
        <Text style={s.sectionTitle}>Measurement columns</Text>
        <View style={s.chipRow}>
          {columns.map((col, idx) => (
            <View key={idx} style={s.chip}>
              <Text style={s.chipText}>{col}</Text>
              <TouchableOpacity
                onPress={() => removeColumn(idx)}
                hitSlop={COLUMN_REMOVE_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${col} column`}
              >
                <Feather name="x" size={12} color={theme.muted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
        <View style={s.addRow}>
          <TextInput
            style={s.addInput}
            value={newColName}
            onChangeText={setNewColName}
            placeholder="e.g. Shoulder"
            placeholderTextColor={theme.subtle}
            onSubmitEditing={addColumn}
          />
          <TouchableOpacity style={s.addBtn} onPress={addColumn} activeOpacity={0.8} hitSlop={ADD_BTN_HIT_SLOP} accessibilityRole="button" accessibilityLabel="Add measurement column">
            <Feather name="plus" size={ICON.sm} color={theme.accentLight} />
          </TouchableOpacity>
        </View>

        {/* Table */}
        {rows.length > 0 && columns.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: SP.md }}>
            <View>
              {/* Header row */}
              <View style={t.headerRow}>
                <View style={[t.cell, t.sizeCell, t.headerCell]}>
                  <Text style={t.headerText}>Size</Text>
                </View>
                {columns.map((col, ci) => (
                  <View key={ci} style={[t.cell, t.headerCell]}>
                    <Text style={t.headerText}>{col}</Text>
                  </View>
                ))}
                <View style={[t.cell, t.actionCell]} />
              </View>

              {/* Data rows */}
              {rows.map((row, ri) => (
                <View key={ri} style={t.dataRow}>
                  <View style={[t.cell, t.sizeCell]}>
                    <TextInput
                      style={t.sizeInput}
                      value={row.size}
                      onChangeText={v => updateSizeLabel(ri, v)}
                      placeholder="M"
                      placeholderTextColor={theme.subtle}
                    />
                  </View>
                  {columns.map((_, ci) => (
                    <View key={ci} style={t.cell}>
                      <TextInput
                        style={t.cellInput}
                        value={row.values[ci] ?? ''}
                        onChangeText={v => updateCell(ri, ci, v)}
                        placeholder="—"
                        placeholderTextColor={theme.subtle}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  ))}
                  <View style={[t.cell, t.actionCell]}>
                    <TouchableOpacity
                      onPress={() => removeRow(ri)}
                      hitSlop={ROW_REMOVE_HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel={row.size ? `Remove size ${row.size}` : 'Remove size row'}
                    >
                      <Feather name="trash-2" size={14} color={theme.error} />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        )}

        {/* Add row */}
        <View style={[s.addRow, { marginTop: SP.sm }]}>
          <TextInput
            style={s.addInput}
            value={newSizeName}
            onChangeText={setNewSizeName}
            placeholder="Add size (e.g. XXL)"
            placeholderTextColor={theme.subtle}
            onSubmitEditing={addRow}
          />
          <TouchableOpacity style={s.addBtn} onPress={addRow} activeOpacity={0.8} hitSlop={ADD_BTN_HIT_SLOP} accessibilityRole="button" accessibilityLabel="Add size">
            <Feather name="plus" size={ICON.sm} color={theme.accentLight} />
          </TouchableOpacity>
        </View>

        {/* Notes */}
        <Text style={[s.sectionTitle, { marginTop: SP.lg }]}>Notes (optional)</Text>
        <TextInput
          style={s.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder={'e.g. Measurements are of the garment laid flat. Add 2" for ease of fit.'}
          placeholderTextColor={theme.subtle}
          multiline
          numberOfLines={3}
        />

        {/* Actions */}
        <PrimaryButton
          label={saving ? 'Saving…' : 'Save Size Chart'}
          onPress={save}
          loading={saving}
          disabled={saving}
          style={{ marginTop: SP.xl }}
        />
        {rows.length > 0 && (
          <TouchableOpacity style={s.clearBtn} onPress={clearChart} activeOpacity={0.7}>
            <Text style={s.clearBtnText}>Remove size chart</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Theme-aware factories (re-derived per render via useMemo) so every color
// reacts to all 12 themes instead of a fixed static palette.

// Tap-area padding (hitSlop) for this screen's small controls — the drawn
// controls are unchanged.
// • inches/cm segments: 24pt tall → 44pt.
const UNIT_BTN_HIT_SLOP = { top: 10, bottom: 10, left: 0, right: 0 };
// • Column chip "x" (12×14): out to the chip's edge plus half the 8pt gap on
//   the right, back over its own (non-interactive) label on the left.
const COLUMN_REMOVE_HIT_SLOP = { top: 16, bottom: 14, left: 19, right: 13 };
// • 40×40 add buttons → 44×44.
const ADD_BTN_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };
// • Table row trash (14×15): fills its 36pt cell; rows sit only 24pt apart,
//   so vertically it stops at half the gap to the neighbouring rows' buttons.
const ROW_REMOVE_HIT_SLOP = { top: 4, bottom: 5, left: 11, right: 11 };

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root:          { flex: 1, backgroundColor: 'transparent' },
  content:       { padding: SP.lg, gap: SP.md },
  sectionTitle:  { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  label:         { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
  unitRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The segments carry the toggle's outer corner radii themselves instead of
  // the toggle clipping them (overflow: hidden) — same look, but it no longer
  // clips the segments' hitSlop on web.
  unitToggle:    { flexDirection: 'row', gap: 1, backgroundColor: theme.border, borderRadius: RADIUS.sm },
  unitBtn:       { paddingHorizontal: SP.md, paddingVertical: SP.xs, backgroundColor: theme.card },
  unitBtnFirst:  { borderTopLeftRadius: RADIUS.sm, borderBottomLeftRadius: RADIUS.sm },
  unitBtnLast:   { borderTopRightRadius: RADIUS.sm, borderBottomRightRadius: RADIUS.sm },
  unitBtnActive: { backgroundColor: theme.accentDim },
  unitBtnText:   { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted },
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.card, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: SP.xs, borderWidth: 1, borderColor: theme.border },
  chipText:      { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.text },
  addRow:        { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  addInput:      { flex: 1, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, paddingHorizontal: SP.sm, fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text },
  addBtn:        { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' },
  notesInput:    { borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, padding: SP.sm, fontFamily: FONT.regular, fontSize: FS.sm, color: theme.text, minHeight: 72, textAlignVertical: 'top' },
  clearBtn:      { alignItems: 'center', paddingVertical: SP.md, marginTop: SP.sm },
  clearBtnText:  { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.error },
});

const makeTableStyles = (theme: AppThemePreset) => StyleSheet.create({
  headerRow:  { flexDirection: 'row', backgroundColor: theme.accentDim, borderTopLeftRadius: RADIUS.sm, borderTopRightRadius: RADIUS.sm },
  dataRow:    { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.border },
  cell:       { width: 80, justifyContent: 'center', paddingHorizontal: SP.xs, paddingVertical: SP.xs },
  sizeCell:   { width: 60, backgroundColor: theme.card },
  actionCell: { width: 36, alignItems: 'center' },
  headerCell: { paddingVertical: SP.sm },
  headerText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.accentLight, textAlign: 'center' },
  sizeInput:  { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.text, textAlign: 'center' },
  cellInput:  { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.text, textAlign: 'center' },
});
