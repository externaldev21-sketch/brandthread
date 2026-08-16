/**
 * Product Size Chart Editor
 *
 * Sellers add/edit a size chart (measurement table) for a specific product.
 * Saved as structured JSON to products.sizeChart via PUT /api/products/:id.
 *
 * Route: /product-size-chart?productId=<uuid>
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, BORDER,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
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
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();

  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);

  const [columns, setColumns]   = useState<string[]>(DEFAULT_COLUMNS);
  const [rows,    setRows]      = useState<SizeChartRow[]>(
    DEFAULT_SIZES.map(size => ({ size, values: new Array(DEFAULT_COLUMNS.length).fill('') }))
  );
  const [unit,    setUnit]      = useState<'inches' | 'cm'>('inches');
  const [notes,   setNotes]     = useState('');
  const [newColName, setNewColName] = useState('');
  const [newSizeName, setNewSizeName] = useState('');

  // Load existing chart from product
  useEffect(() => {
    if (!productId) { setLoading(false); return; }
    (api as any).products?.get?.(productId)
      ?.then((p: any) => {
        const chart: SizeChart | null = p?.sizeChart ?? null;
        if (chart?.columns?.length) {
          setColumns(chart.columns);
          setRows(chart.rows ?? []);
          setUnit((chart.unit as any) ?? 'inches');
          setNotes(chart.notes ?? '');
        }
      })
      ?.catch(() => {})
      ?.finally(() => setLoading(false));
  }, [productId]);

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
        { text: 'OK', onPress: () => router.back() },
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
            router.back();
          } catch { Alert.alert('Error', 'Could not remove size chart.'); }
          finally { setSaving(false); }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={PURPLE_LIGHT} />
      </View>
    );
  }

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <BrandthreadHeader
        title="Size Chart"
        subtitle={productName ?? undefined}
        onBack={() => router.back()}
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
                style={[s.unitBtn, unit === u && s.unitBtnActive]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUnit(u); }}
                activeOpacity={0.7}
              >
                <Text style={[s.unitBtnText, unit === u && { color: PURPLE_LIGHT }]}>{u}</Text>
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
              <TouchableOpacity onPress={() => removeColumn(idx)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Feather name="x" size={12} color={MUTED} />
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
            placeholderTextColor={SUBTLE}
            onSubmitEditing={addColumn}
          />
          <TouchableOpacity style={s.addBtn} onPress={addColumn} activeOpacity={0.8}>
            <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
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
                      placeholderTextColor={SUBTLE}
                    />
                  </View>
                  {columns.map((_, ci) => (
                    <View key={ci} style={t.cell}>
                      <TextInput
                        style={t.cellInput}
                        value={row.values[ci] ?? ''}
                        onChangeText={v => updateCell(ri, ci, v)}
                        placeholder="—"
                        placeholderTextColor={SUBTLE}
                        keyboardType="decimal-pad"
                      />
                    </View>
                  ))}
                  <View style={[t.cell, t.actionCell]}>
                    <TouchableOpacity onPress={() => removeRow(ri)}>
                      <Feather name="trash-2" size={14} color={RED} />
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
            placeholderTextColor={SUBTLE}
            onSubmitEditing={addRow}
          />
          <TouchableOpacity style={s.addBtn} onPress={addRow} activeOpacity={0.8}>
            <Feather name="plus" size={ICON.sm} color={PURPLE_LIGHT} />
          </TouchableOpacity>
        </View>

        {/* Notes */}
        <Text style={[s.sectionTitle, { marginTop: SP.lg }]}>Notes (optional)</Text>
        <TextInput
          style={s.notesInput}
          value={notes}
          onChangeText={setNotes}
          placeholder={'e.g. Measurements are of the garment laid flat. Add 2" for ease of fit.'}
          placeholderTextColor={SUBTLE}
          multiline
          numberOfLines={3}
        />

        {/* Actions */}
        <PrimaryButton
          title={saving ? 'Saving…' : 'Save Size Chart'}
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

const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: BG },
  content:       { padding: SP.lg, gap: SP.md },
  sectionTitle:  { fontFamily: FONT.semibold, fontSize: FS.xs, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8 },
  label:         { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  unitRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  unitToggle:    { flexDirection: 'row', gap: 1, backgroundColor: BORDER, borderRadius: RADIUS.sm, overflow: 'hidden' },
  unitBtn:       { paddingHorizontal: SP.md, paddingVertical: SP.xs, backgroundColor: CARD },
  unitBtnActive: { backgroundColor: PURPLE_DIM },
  unitBtnText:   { fontFamily: FONT.medium, fontSize: FS.sm, color: MUTED },
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CARD, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: SP.xs, borderWidth: 1, borderColor: BORDER },
  chipText:      { fontFamily: FONT.medium, fontSize: FS.xs, color: FG },
  addRow:        { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  addInput:      { flex: 1, height: 40, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, paddingHorizontal: SP.sm, fontFamily: FONT.regular, fontSize: FS.sm, color: FG },
  addBtn:        { width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  notesInput:    { borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, padding: SP.sm, fontFamily: FONT.regular, fontSize: FS.sm, color: FG, minHeight: 72, textAlignVertical: 'top' },
  clearBtn:      { alignItems: 'center', paddingVertical: SP.md, marginTop: SP.sm },
  clearBtnText:  { fontFamily: FONT.regular, fontSize: FS.sm, color: RED },
});

const t = StyleSheet.create({
  headerRow:  { flexDirection: 'row', backgroundColor: PURPLE_DIM, borderTopLeftRadius: RADIUS.sm, borderTopRightRadius: RADIUS.sm },
  dataRow:    { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  cell:       { width: 80, justifyContent: 'center', paddingHorizontal: SP.xs, paddingVertical: SP.xs },
  sizeCell:   { width: 60, backgroundColor: CARD },
  actionCell: { width: 36, alignItems: 'center' },
  headerCell: { paddingVertical: SP.sm },
  headerText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: PURPLE_LIGHT, textAlign: 'center' },
  sizeInput:  { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG, textAlign: 'center' },
  cellInput:  { fontFamily: FONT.regular, fontSize: FS.xs, color: FG, textAlign: 'center' },
});
