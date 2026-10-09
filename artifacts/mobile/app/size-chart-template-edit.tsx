/**
 * Size chart template editor — create from a preset / blank, or edit a saved template.
 *
 * Route: /size-chart-template-edit
 *   ?id=<uuid>         edit a saved template
 *   ?preset=<key>      start from a starter preset (unsaved)
 *   ?fromProductId=<uuid>  start from that product's current chart (unsaved)
 *   ?productId=<uuid>  save, then copy the chart onto this product and return to it
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Header } from '@/components/layout';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, GUTTER, ICON, RADIUS, SP } from '@/lib/theme';
import { convertSizeChartUnit } from '@/lib/sizeChartUnits';
import type { SizeChartData } from '@/lib/sizeChartTypes';

const BLANK: SizeChartData = {
  unit: 'inches',
  columns: ['Chest', 'Length'],
  rows: ['S', 'M', 'L'].map((size) => ({ size, values: ['', ''] })),
};

const SIZE_COL = 56;
const ACTION_COL = 32;
const MIN_CELL_COL = 64;

export default function SizeChartTemplateEditScreen() {
  const colors = useColors();
  const router = useRouter();
  const tabBar = useTabBarMetrics();
  const api = useApi();
  const { id, preset, productId, fromProductId } = useLocalSearchParams<{ id?: string; preset?: string; productId?: string; fromProductId?: string }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [chart, setChart] = useState<SizeChartData>(BLANK);
  const [productCount, setProductCount] = useState(0);
  const [newColumn, setNewColumn] = useState('');
  const [newSize, setNewSize] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (id) {
          const t = await api.sizeChartTemplates.get(id);
          if (!live) return;
          setName(t.name); setChart(t.chart); setProductCount(t.products.length);
        } else if (fromProductId) {
          const p = (await api.products.get(fromProductId)) as { name?: string; sizeChart?: SizeChartData | null };
          if (live && p?.sizeChart?.columns?.length) { setChart(p.sizeChart); if (p.name) setName(`${p.name} size chart`); }
        } else if (preset) {
          const list = await api.sizeChartTemplates.list();
          const p = list.presets.find((x) => x.key === preset);
          if (live && p) { setName(p.name); setChart(p.chart); }
        }
      } catch {
        if (live) Alert.alert('Could not load', 'Go back and try again.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [api, id, preset, fromProductId]);

  const unit = chart.unit === 'cm' ? 'cm' : 'inches';
  const { width } = useWindowDimensions();
  // Columns share the row evenly so up to four measurements fit without scrolling.
  const CELL_COL = Math.max(MIN_CELL_COL, Math.floor((width - GUTTER * 2 - SIZE_COL - ACTION_COL) / Math.max(chart.columns.length, 1)));

  function setCell(ri: number, ci: number, v: string) {
    setChart((c) => ({ ...c, rows: c.rows.map((r, i) => i !== ri ? r : { ...r, values: r.values.map((x, j) => j === ci ? v : x) }) }));
  }
  function setSizeLabel(ri: number, v: string) {
    setChart((c) => ({ ...c, rows: c.rows.map((r, i) => i === ri ? { ...r, size: v } : r) }));
  }
  function addColumn() {
    const label = newColumn.trim();
    if (!label || chart.columns.length >= 12) return;
    setChart((c) => ({ columns: [...c.columns, label], rows: c.rows.map((r) => ({ ...r, values: [...r.values, ''] })), unit: c.unit, notes: c.notes }));
    setNewColumn('');
  }
  function removeColumn(ci: number) {
    setChart((c) => ({ ...c, columns: c.columns.filter((_, i) => i !== ci), rows: c.rows.map((r) => ({ ...r, values: r.values.filter((_, i) => i !== ci) })) }));
  }
  function addSize() {
    const label = newSize.trim();
    if (!label || chart.rows.length >= 24) return;
    setChart((c) => ({ ...c, rows: [...c.rows, { size: label, values: c.columns.map(() => '') }] }));
    setNewSize('');
  }
  function removeSize(ri: number) {
    setChart((c) => ({ ...c, rows: c.rows.filter((_, i) => i !== ri) }));
  }

  async function save() {
    if (!name.trim()) { Alert.alert('Name this size chart'); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      let templateId = id;
      if (id) {
        await api.sizeChartTemplates.update(id, { name: name.trim(), chart });
      } else {
        const created = await api.sizeChartTemplates.create({ name: name.trim(), chart });
        templateId = created.id;
      }
      if (productId && templateId) {
        await api.sizeChartTemplates.apply(templateId, [productId]);
        // Pop the editor and the template list back to the product's chart editor.
        if (typeof (router as any).dismiss === 'function') (router as any).dismiss(2);
        else goBackOr(router);
        return;
      }
      if (id && productCount > 0) {
        Alert.alert('Saved', `Update the ${productCount} product${productCount === 1 ? '' : 's'} using this chart?`, [
          { text: 'Not now', style: 'cancel', onPress: () => goBackOr(router) },
          {
            text: 'Update',
            onPress: async () => {
              try { await api.sizeChartTemplates.sync(id); } catch { Alert.alert('Could not update products'); }
              goBackOr(router);
            },
          },
        ]);
        return;
      }
      goBackOr(router);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message?.includes('409') || /already/i.test(String(e?.message)) ? 'You already have a chart with that name.' : 'Check the chart and try again.');
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!id) return;
    Alert.alert('Delete this size chart?', 'Products keep the chart they already have.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try { await api.sizeChartTemplates.delete(id); goBackOr(router); }
          catch { Alert.alert('Could not delete'); }
        },
      },
    ]);
  }

  const s = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={s.screen}>
      <Header title={id ? 'Edit size chart' : 'New size chart'} onBack={() => goBackOr(router)} dividerVariant="none" />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[s.content, { paddingBottom: tabBar.occupiedHeight + SP.xxl }]}
          >
            <Text style={s.label}>Name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Tops & tees"
              placeholderTextColor={colors.mutedForeground}
              maxLength={60}
            />

            <View style={s.segment} accessibilityRole="tablist">
              {(['inches', 'cm'] as const).map((u) => (
                <TouchableOpacity
                  key={u}
                  style={[s.segmentItem, unit === u && s.segmentItemOn]}
                  onPress={() => setChart((c) => convertSizeChartUnit(c, u))}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: unit === u }}
                >
                  <Text style={[s.segmentText, unit === u && s.segmentTextOn]}>{u === 'cm' ? 'Centimeters' : 'Inches'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {chart.columns.length > 0 && (
              <View style={s.chips}>
                {chart.columns.map((col, ci) => (
                  <TouchableOpacity key={ci} style={s.chip} onPress={() => removeColumn(ci)} accessibilityRole="button" accessibilityLabel={`Remove ${col}`}>
                    <Text style={s.chipText}>{col}</Text>
                    <Feather name="x" size={14} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tableWrap}>
              <View>
                <View style={[s.tr, s.trHead]}>
                  <Text style={[s.th, { width: SIZE_COL }]}>Size</Text>
                  {chart.columns.map((col, ci) => (
                    <Text key={ci} style={[s.th, s.thCol, { width: CELL_COL }]}>{col}</Text>
                  ))}
                  <View style={{ width: ACTION_COL }} />
                </View>
                {chart.rows.map((row, ri) => (
                  <View key={ri} style={[s.tr, ri % 2 === 1 && s.trAlt]}>
                    <TextInput style={[s.td, s.tdSize, { width: SIZE_COL }]} value={row.size} onChangeText={(v) => setSizeLabel(ri, v)} maxLength={20} />
                    {chart.columns.map((_, ci) => (
                      <TextInput
                        key={ci}
                        style={[s.td, { width: CELL_COL }]}
                        value={row.values[ci] ?? ''}
                        onChangeText={(v) => setCell(ri, ci, v)}
                        placeholder="—"
                        placeholderTextColor={colors.mutedForeground}
                        maxLength={20}
                      />
                    ))}
                    <TouchableOpacity style={s.trash} onPress={() => removeSize(ri)} accessibilityLabel={`Remove size ${row.size}`}>
                      <Feather name="trash-2" size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </ScrollView>

            <View style={s.addRow}>
              <TextInput style={s.addInput} value={newSize} onChangeText={setNewSize} placeholder="Add a size, e.g. XXL" placeholderTextColor={colors.mutedForeground} onSubmitEditing={addSize} maxLength={20} />
              <TouchableOpacity style={s.addBtn} onPress={addSize} accessibilityLabel="Add size"><Feather name="plus" size={ICON.sm} color={colors.foreground} /></TouchableOpacity>
            </View>
            <View style={s.addRow}>
              <TextInput style={s.addInput} value={newColumn} onChangeText={setNewColumn} placeholder="Add a measurement, e.g. Shoulder" placeholderTextColor={colors.mutedForeground} onSubmitEditing={addColumn} maxLength={40} />
              <TouchableOpacity style={s.addBtn} onPress={addColumn} accessibilityLabel="Add measurement"><Feather name="plus" size={ICON.sm} color={colors.foreground} /></TouchableOpacity>
            </View>

            <Text style={[s.label, { marginTop: SP.lg }]}>Notes</Text>
            <TextInput
              style={[s.input, s.notes]}
              value={chart.notes ?? ''}
              onChangeText={(v) => setChart((c) => ({ ...c, notes: v }))}
              placeholder="Measured flat. Allow 1 inch either way."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={500}
            />

            <PrimaryButton
              label={productId ? 'Save and use on this product' : 'Save'}
              onPress={save}
              loading={saving}
              disabled={saving}
              style={{ marginTop: SP.lg }}
            />
            {id ? (
              <>
                <TouchableOpacity style={s.linkRow} onPress={() => router.push(`/size-chart-template-apply?id=${id}` as never)} accessibilityRole="button">
                  <Text style={s.linkText}>Apply to products</Text>
                  <Feather name="chevron-right" size={ICON.sm} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity style={s.linkRow} onPress={remove} accessibilityRole="button">
                  <Text style={[s.linkText, { color: colors.destructive }]}>Delete size chart</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: GUTTER, paddingTop: SP.sm },
    label: { fontFamily: FONT.semibold, fontSize: FS.meta, color: c.mutedForeground, marginBottom: SP.sm },
    input: { minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground },
    notes: { minHeight: 84, paddingTop: SP.sm, textAlignVertical: 'top' },
    segment: { flexDirection: 'row', backgroundColor: c.card, borderRadius: RADIUS.pill, padding: 3, marginTop: SP.md, borderWidth: 1, borderColor: c.border },
    segmentItem: { flex: 1, height: 38, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
    segmentItemOn: { backgroundColor: c.foreground },
    segmentText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: c.mutedForeground },
    segmentTextOn: { color: c.background },
    tableWrap: { marginTop: SP.md, marginHorizontal: -GUTTER, paddingHorizontal: GUTTER },
    tr: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
    trHead: { minHeight: 44, backgroundColor: c.card, borderTopLeftRadius: RADIUS.sm, borderTopRightRadius: RADIUS.sm },
    trAlt: { backgroundColor: c.card },
    th: { fontFamily: FONT.semibold, fontSize: FS.meta, color: c.foreground, paddingHorizontal: SP.sm },
    thCol: { paddingVertical: SP.sm },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.md },
    chip: { width: '48.5%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 40, paddingHorizontal: 14, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border },
    chipText: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: FS.sm, color: c.foreground },
    td: { height: 48, paddingHorizontal: SP.sm, fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground },
    tdSize: { fontFamily: FONT.semibold },
    trash: { width: ACTION_COL, height: 48, alignItems: 'center', justifyContent: 'center' },
    addRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md },
    addInput: { flex: 1, minHeight: 44, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: SP.md, fontFamily: FONT.regular, fontSize: FS.sm, color: c.foreground },
    addBtn: { width: 44, height: 44, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
    linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
    linkText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  });
}
