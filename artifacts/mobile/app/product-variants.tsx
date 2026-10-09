/**
 * Variants & stock — seller management screen for one product (?productId=).
 *
 * Modelled on Shopify admin mobile's product screens (Mobbin): an Options
 * section of value chips per option, a Variants list (name + SKU, stock pill
 * on the right, tap to expand price / SKU / low-stock level), then stock rules.
 * Size and colour stay on the variant columns; fit and custom options are
 * stored server-side per variant (see routes/product-variants.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, Alert, ActivityIndicator, Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import { useColors } from '@/hooks/useColors';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  BrandthreadCard, PrimaryButton, SectionHeader, HapticSwitch, EmptyState, PressableScale,
} from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';

interface Axis { name: string; values: string[] }
interface Variant {
  id: string; sku: string; size: string | null; color: string | null;
  options: Record<string, string>; priceCents: number; stock: number; lowStockThreshold: number;
}
interface Rules {
  lowStockThresholdDefault: number | null;
  soldOutBehavior: 'show' | 'hide' | 'archive';
  limitedQuantityEnabled: boolean; limitedQuantityTotal: number | null;
  showRemainingCounter: boolean; counterThreshold: number | null;
}
interface Edit { price?: string; stock?: string; sku?: string; low?: string }

const MAX_VARIANTS = 100;
const SUGGESTED_OPTIONS = ['Size', 'Colour', 'Fit', 'Material'];
const BEHAVIORS: Array<{ value: Rules['soldOutBehavior']; title: string; body: string }> = [
  { value: 'show', title: 'Keep listed', body: 'Buyers see Sold out on the product.' },
  { value: 'hide', title: 'Hide until restocked', body: 'Removed from the shop while sold out, back automatically on restock.' },
  { value: 'archive', title: 'Archive', body: 'Moved to Archived when the last unit sells.' },
];

function errText(err: unknown, fallback: string): string {
  const message = (err as { message?: string } | null)?.message;
  return message && message.length < 160 ? message : fallback;
}
const toCents = (text: string): number | null => {
  const n = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};
const toInt = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);
const centsToInput = (c: number) => (c / 100).toFixed(2);

function variantValues(v: Variant, axes: Axis[]): string[] {
  if (axes.length === 0) return [v.size, v.color, ...Object.values(v.options)].filter(Boolean) as string[];
  return axes.map((a) => {
    const key = a.name.trim().toLowerCase();
    if (key === 'size') return v.size ?? '';
    if (key === 'color' || key === 'colour') return v.color ?? '';
    return v.options[a.name] ?? '';
  });
}

export default function ProductVariantsScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const st = useMemo(() => makeStyles(colors), [colors]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [axes, setAxes] = useState<Axis[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sort, setSort] = useState<'name' | 'stock'>('name');
  const [newValue, setNewValue] = useState<Record<number, string>>({});
  const [addingAxis, setAddingAxis] = useState(false);
  const [newAxisName, setNewAxisName] = useState('');
  const [genPrice, setGenPrice] = useState('');
  const [genStock, setGenStock] = useState('0');
  const [busy, setBusy] = useState<null | 'generate' | 'save' | 'rules'>(null);
  const [lowDefaultText, setLowDefaultText] = useState('');
  const [editionText, setEditionText] = useState('');
  const [counterText, setCounterText] = useState('');
  const [applyLow, setApplyLow] = useState(false);

  const applyState = useCallback((data: any) => {
    if (data.product?.name) setProductName(data.product.name);
    setAxes(data.axes ?? []);
    setVariants(data.variants ?? []);
    if (data.stockRules) {
      const r = data.stockRules as Rules;
      setRules(r);
      setLowDefaultText(r.lowStockThresholdDefault != null ? String(r.lowStockThresholdDefault) : '');
      setEditionText(r.limitedQuantityTotal != null ? String(r.limitedQuantityTotal) : '');
      setCounterText(r.counterThreshold != null ? String(r.counterThreshold) : '');
    }
  }, []);

  const load = useCallback(async () => {
    if (!productId) { setLoadError('No product selected.'); setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      applyState(await api.productVariants.get(productId));
    } catch (err) {
      setLoadError(errText(err, "Couldn't load this product's variants."));
    } finally {
      setLoading(false);
    }
  }, [api, productId, applyState]);

  useEffect(() => { void load(); }, [load]);

  const matrix = axes.length === 0 ? 0 : axes.reduce((n, a) => n * Math.max(a.values.length, 0), 1);
  const overCap = matrix > MAX_VARIANTS;
  const dirtyIds = Object.keys(edits).filter((id) => Object.values(edits[id]).some((v) => v !== undefined));

  function setAxisAt(i: number, patch: Partial<Axis>) {
    setAxes((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function addValue(i: number) {
    const value = (newValue[i] ?? '').trim();
    if (!value) return;
    if (axes[i].values.some((v) => v.toLowerCase() === value.toLowerCase())) { setNewValue((p) => ({ ...p, [i]: '' })); return; }
    setAxisAt(i, { values: [...axes[i].values, value.slice(0, 40)] });
    setNewValue((p) => ({ ...p, [i]: '' }));
  }
  function addAxis(name: string) {
    const clean = name.trim();
    if (!clean) return;
    const key = clean.toLowerCase() === 'color' ? 'colour' : clean.toLowerCase();
    if (axes.some((a) => (a.name.toLowerCase() === 'color' ? 'colour' : a.name.toLowerCase()) === key)) {
      Alert.alert('Already added', `${clean} is already an option.`); return;
    }
    if (axes.length >= 5) { Alert.alert('Limit reached', 'A product can have up to 5 options.'); return; }
    setAxes((prev) => [...prev, { name: clean.slice(0, 40), values: [] }]);
    setAddingAxis(false); setNewAxisName('');
  }

  async function generate() {
    if (!productId) return;
    const usable = axes.filter((a) => a.values.length > 0);
    if (usable.length === 0) { Alert.alert('Add option values', 'Add at least one value to an option first.'); return; }
    const price = variants.length === 0 ? toCents(genPrice) : (toCents(genPrice) ?? undefined);
    if (price === null) { Alert.alert('Price needed', 'Enter the price each new variant starts with.'); return; }
    const stock = toInt(genStock);
    if (stock === null) { Alert.alert('Stock', 'Enter a whole number for starting stock.'); return; }
    setBusy('generate');
    try {
      await api.productVariants.putAxes(productId, usable);
      const result = await api.productVariants.generate(productId, { ...(price !== undefined ? { priceCents: price } : {}), stock });
      applyState(result);
      setEdits({});
      if (result.created === 0) Alert.alert('Up to date', 'Every combination already exists.');
    } catch (err) {
      Alert.alert("Couldn't generate variants", errText(err, 'Try again.'));
    } finally {
      setBusy(null);
    }
  }

  function setEdit(id: string, patch: Edit) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function saveVariants() {
    if (!productId || dirtyIds.length === 0) return;
    const updates: Array<{ variantId: string; priceCents?: number; stock?: number; sku?: string; lowStockThreshold?: number }> = [];
    for (const id of dirtyIds) {
      const e = edits[id]; const current = variants.find((v) => v.id === id);
      if (!current) continue;
      const u: (typeof updates)[number] = { variantId: id };
      if (e.price !== undefined) { const c = toCents(e.price); if (c === null) { Alert.alert('Price', 'Enter a price above 0.'); return; } if (c !== current.priceCents) u.priceCents = c; }
      if (e.stock !== undefined) { const n = toInt(e.stock); if (n === null) { Alert.alert('Stock', 'Stock must be a whole number.'); return; } if (n !== current.stock) u.stock = n; }
      if (e.low !== undefined) { const n = toInt(e.low); if (n === null) { Alert.alert('Low-stock level', 'Use a whole number.'); return; } if (n !== current.lowStockThreshold) u.lowStockThreshold = n; }
      if (e.sku !== undefined && e.sku.trim() !== current.sku) u.sku = e.sku.trim();
      if (Object.keys(u).length > 1) updates.push(u);
    }
    if (updates.length === 0) { setEdits({}); return; }
    setBusy('save');
    try {
      applyState(await api.productVariants.bulkUpdate(productId, updates));
      setEdits({});
    } catch (err) {
      Alert.alert("Couldn't save variants", errText(err, 'Nothing was changed. Try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function saveRules() {
    if (!productId || !rules) return;
    const low = lowDefaultText.trim() === '' ? null : toInt(lowDefaultText);
    const edition = editionText.trim() === '' ? null : toInt(editionText);
    const counter = counterText.trim() === '' ? null : toInt(counterText);
    if (lowDefaultText.trim() !== '' && low === null) { Alert.alert('Low-stock default', 'Use a whole number.'); return; }
    if (rules.limitedQuantityEnabled && (edition === null || edition < 1)) { Alert.alert('Edition size', 'Enter how many units the edition has.'); return; }
    setBusy('rules');
    try {
      const saved = await api.productVariants.putStockRules(productId, {
        ...rules, lowStockThresholdDefault: low, limitedQuantityTotal: edition, counterThreshold: counter,
        applyLowStockToVariants: applyLow && low !== null,
      });
      setRules(saved);
      if (applyLow && low !== null) setVariants((prev) => prev.map((v) => ({ ...v, lowStockThreshold: low })));
      setApplyLow(false);
      // A switch to hide/archive can change the product's status right away; refresh silently.
      api.productVariants.get(productId).then((d: any) => { setVariants(d.variants ?? []); }).catch(() => undefined);
      Alert.alert('Saved', 'Stock rules updated.');
    } catch (err) {
      Alert.alert("Couldn't save stock rules", errText(err, 'Try again.'));
    } finally {
      setBusy(null);
    }
  }

  const sorted = useMemo(() => {
    const rows = variants.map((v) => ({ v, label: variantValues(v, axes).join(' / ') || v.sku }));
    if (sort === 'stock') return rows.sort((a, b) => a.v.stock - b.v.stock);
    return rows;
  }, [variants, axes, sort]);

  const groupByFirst = sort === 'name' && axes.length >= 2;
  const groups = useMemo(() => {
    if (!groupByFirst) return [{ title: '', rows: sorted }];
    const map = new Map<string, typeof sorted>();
    for (const row of sorted) {
      const key = variantValues(row.v, axes)[0] || 'Other';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].map(([title, rows]) => ({ title, rows }));
  }, [sorted, groupByFirst, axes]);

  const header = (
    <Header
      title="Variants & stock"
      transparent
      dividerVariant="none"
      onBack={() => goBackOr(router)}
      rightElement={dirtyIds.length > 0
        ? <PrimaryButton label={busy === 'save' ? 'Saving...' : `Save ${dirtyIds.length}`} onPress={saveVariants} loading={busy === 'save'} small style={{ minWidth: 84 }} />
        : undefined}
    />
  );

  if (loading) {
    return (<View style={st.root}>{header}<View style={st.center}><ActivityIndicator color={colors.mutedForeground} /></View></View>);
  }
  if (loadError) {
    return (
      <View style={st.root}>{header}
        <EmptyState icon="alert-circle" title="Couldn't load variants" description={loadError} action={{ label: 'Try again', onPress: load }} />
      </View>
    );
  }

  return (
    <View style={st.root}>
      {header}
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={st.scroll}>
        {!!productName && <Text style={st.productName} numberOfLines={2}>{productName}</Text>}

        <SectionHeader title="OPTIONS" style={st.sh} />
        {axes.length === 0 && !addingAxis && (
          <BrandthreadCard style={st.card}>
            <Text style={st.emptyTitle}>No options yet</Text>
            <Text style={st.muted}>Add Size, Colour, Fit or your own option, then generate every combination.</Text>
          </BrandthreadCard>
        )}
        {axes.map((axis, i) => (
          <BrandthreadCard key={axis.name} style={st.card}>
            <View style={st.rowBetween}>
              <Text style={st.axisName}>{axis.name} ({axis.values.length})</Text>
              <Pressable hitSlop={10} accessibilityLabel={`Remove ${axis.name}`} onPress={() => setAxes((prev) => prev.filter((_, idx) => idx !== i))}>
                <Icon name="trash-2" size={ICON.sm} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={st.chips}>
              {axis.values.map((value) => (
                <Pressable key={value} style={st.chip} accessibilityLabel={`Remove ${value}`}
                  onPress={() => setAxisAt(i, { values: axis.values.filter((x) => x !== value) })}>
                  <Text style={st.chipText}>{value}</Text>
                  <Icon name="x" size={12} color={colors.mutedForeground} />
                </Pressable>
              ))}
            </View>
            <View style={st.addRow}>
              <TextInput
                style={[st.input, { flex: 1, minWidth: 0 }]} value={newValue[i] ?? ''} placeholder={`Add ${axis.name.toLowerCase()} value`}
                placeholderTextColor={colors.subtle} onChangeText={(t) => setNewValue((p) => ({ ...p, [i]: t }))}
                onSubmitEditing={() => addValue(i)} returnKeyType="done" maxLength={40}
              />
              <Pressable style={st.addBtn} onPress={() => addValue(i)} accessibilityRole="button" accessibilityLabel="Add value"><Text style={st.addBtnText}>Add</Text></Pressable>
            </View>
          </BrandthreadCard>
        ))}
        {addingAxis ? (
          <BrandthreadCard style={st.card}>
            <Text style={st.axisName}>New option</Text>
            <View style={st.chips}>
              {SUGGESTED_OPTIONS.filter((n) => !axes.some((a) => a.name.toLowerCase() === n.toLowerCase())).map((n) => (
                <Pressable key={n} style={st.chip} onPress={() => addAxis(n)}><Text style={st.chipText}>{n}</Text></Pressable>
              ))}
            </View>
            <View style={st.addRow}>
              <TextInput style={[st.input, { flex: 1, minWidth: 0 }]} value={newAxisName} onChangeText={setNewAxisName} placeholder="Or name your own"
                placeholderTextColor={colors.subtle} onSubmitEditing={() => addAxis(newAxisName)} returnKeyType="done" maxLength={40} />
              <Pressable style={st.addBtn} onPress={() => addAxis(newAxisName)} accessibilityRole="button" accessibilityLabel="Add option"><Text style={st.addBtnText}>Add</Text></Pressable>
            </View>
          </BrandthreadCard>
        ) : (
          <PressableScale style={st.addOption} onPress={() => setAddingAxis(true)} accessibilityLabel="Add option">
            <Icon name="plus-circle" size={ICON.sm} color={colors.foreground} />
            <Text style={st.addOptionText}>Add option</Text>
          </PressableScale>
        )}

        {axes.length > 0 && (
          <BrandthreadCard style={st.card}>
            <View style={st.rowBetween}>
              <Text style={st.axisName}>{matrix} variant{matrix === 1 ? '' : 's'}</Text>
              {overCap && <Text style={[st.muted, { color: colors.destructive }]}>Limit is {MAX_VARIANTS}</Text>}
            </View>
            <View style={st.addRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.fieldLabel}>{variants.length === 0 ? 'Price' : 'Price for new'}</Text>
                <TextInput style={st.input} value={genPrice} onChangeText={setGenPrice} keyboardType="decimal-pad"
                  placeholder={variants.length ? centsToInput(Math.min(...variants.map((v) => v.priceCents))) : '0.00'} placeholderTextColor={colors.subtle} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.fieldLabel}>Starting stock</Text>
                <TextInput style={st.input} value={genStock} onChangeText={setGenStock} keyboardType="number-pad" placeholderTextColor={colors.subtle} />
              </View>
            </View>
            <PrimaryButton label={variants.length ? 'Generate missing variants' : 'Generate variants'} onPress={generate} loading={busy === 'generate'} disabled={overCap} />
          </BrandthreadCard>
        )}

        <SectionHeader title={`VARIANTS (${variants.length})`} style={st.sh} />
        {variants.length === 0 ? (
          <BrandthreadCard style={st.card}>
            <Text style={st.emptyTitle}>No variants yet</Text>
            <Text style={st.muted}>Generate them from your options above.</Text>
          </BrandthreadCard>
        ) : (
          <>
            <View style={st.sortRow}>
              {(['name', 'stock'] as const).map((key) => (
                <Pressable key={key} onPress={() => setSort(key)} style={[st.sortChip, sort === key && st.sortChipOn]} accessibilityLabel={`Sort by ${key === 'name' ? 'option' : 'lowest stock'}`}>
                  <Text style={[st.sortText, sort === key && st.sortTextOn]}>{key === 'name' ? 'Options' : 'Lowest stock'}</Text>
                </Pressable>
              ))}
            </View>
            <BrandthreadCard style={[st.card, { paddingVertical: 0, gap: 0 }]}>
              {groups.map((group) => (
                <View key={group.title || 'all'}>
                  {!!group.title && <Text style={st.groupTitle}>{group.title}</Text>}
                  {group.rows.map(({ v, label }) => {
                    const e = edits[v.id] ?? {};
                    const open = expanded === v.id;
                    const stockText = e.stock ?? String(v.stock);
                    const shortLabel = groupByFirst ? variantValues(v, axes).slice(1).join(' / ') || label : label;
                    const out = v.stock === 0; const low = !out && v.stock <= v.lowStockThreshold;
                    return (
                      <View key={v.id} style={st.variantRow}>
                        <View style={st.rowBetween}>
                          <Pressable style={{ flex: 1 }} onPress={() => setExpanded(open ? null : v.id)} accessibilityLabel={`${label}, ${open ? 'collapse' : 'edit details'}`}>
                            <Text style={st.variantName} numberOfLines={1}>{shortLabel}</Text>
                            <Text style={st.muted} numberOfLines={1}>
                              {formatCents(v.priceCents)}{out ? ' · Sold out' : low ? ' · Low stock' : ''}
                            </Text>
                          </Pressable>
                          <TextInput style={st.stockPill} value={stockText} keyboardType="number-pad" selectTextOnFocus
                            onChangeText={(t) => setEdit(v.id, { stock: t.replace(/[^0-9]/g, '') })} accessibilityLabel={`Stock for ${label}`} />
                          <Pressable hitSlop={8} onPress={() => setExpanded(open ? null : v.id)}>
                            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={colors.mutedForeground} />
                          </Pressable>
                        </View>
                        {open && (
                          <View style={st.editGrid}>
                            <View style={{ flex: 1 }}>
                              <Text style={st.fieldLabel}>Price</Text>
                              <TextInput style={st.input} value={e.price ?? centsToInput(v.priceCents)} keyboardType="decimal-pad"
                                onChangeText={(t) => setEdit(v.id, { price: t })} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={st.fieldLabel}>Low-stock level</Text>
                              <TextInput style={st.input} value={e.low ?? String(v.lowStockThreshold)} keyboardType="number-pad"
                                onChangeText={(t) => setEdit(v.id, { low: t.replace(/[^0-9]/g, '') })} />
                            </View>
                            <View style={{ flexBasis: '100%' }}>
                              <Text style={st.fieldLabel}>SKU</Text>
                              <TextInput style={st.input} value={e.sku ?? v.sku} autoCapitalize="characters" autoCorrect={false}
                                onChangeText={(t) => setEdit(v.id, { sku: t })} />
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              ))}
            </BrandthreadCard>
            {dirtyIds.length > 0 && (
              <PrimaryButton label={`Save ${dirtyIds.length} change${dirtyIds.length === 1 ? '' : 's'}`} onPress={saveVariants} loading={busy === 'save'} style={st.fullBtn} />
            )}
          </>
        )}

        {rules && (
          <>
            <SectionHeader title="STOCK RULES" style={st.sh} />
            <BrandthreadCard style={st.card}>
              <Text style={st.axisName}>When a product sells out</Text>
              {BEHAVIORS.map((b) => {
                const on = rules.soldOutBehavior === b.value;
                return (
                  <Pressable key={b.value} style={st.radioRow} onPress={() => setRules({ ...rules, soldOutBehavior: b.value })} accessibilityRole="radio" accessibilityState={{ selected: on }}>
                    <View style={[st.radio, on && st.radioOn]}>{on && <View style={st.radioDot} />}</View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.variantName}>{b.title}</Text>
                      <Text style={st.muted}>{b.body}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Text style={st.muted}>Pre-orders and drops always stay listed.</Text>
            </BrandthreadCard>

            <BrandthreadCard style={st.card}>
              <Text style={st.axisName}>Low-stock alert</Text>
              <Text style={st.fieldLabel}>Default level for new variants</Text>
              <TextInput style={st.input} value={lowDefaultText} keyboardType="number-pad" placeholder="10" placeholderTextColor={colors.subtle}
                onChangeText={(t) => setLowDefaultText(t.replace(/[^0-9]/g, ''))} />
              <View style={st.switchRow}>
                <Text style={[st.variantName, { flex: 1 }]}>Apply to existing variants</Text>
                <HapticSwitch value={applyLow} onValueChange={setApplyLow} />
              </View>
            </BrandthreadCard>

            <BrandthreadCard style={st.card}>
              <View style={st.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.variantName}>Limited quantity</Text>
                  <Text style={st.muted}>Shows Limited edition with units left.</Text>
                </View>
                <HapticSwitch value={rules.limitedQuantityEnabled} onValueChange={(v) => setRules({ ...rules, limitedQuantityEnabled: v })} />
              </View>
              {rules.limitedQuantityEnabled && (
                <>
                  <Text style={st.fieldLabel}>Edition size</Text>
                  <TextInput style={st.input} value={editionText} keyboardType="number-pad" placeholder="50" placeholderTextColor={colors.subtle}
                    onChangeText={(t) => setEditionText(t.replace(/[^0-9]/g, ''))} />
                </>
              )}
              <View style={st.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.variantName}>Show units left</Text>
                  <Text style={st.muted}>Only shown once stock falls to this level.</Text>
                </View>
                <HapticSwitch value={rules.showRemainingCounter} onValueChange={(v) => setRules({ ...rules, showRemainingCounter: v })} />
              </View>
              {rules.showRemainingCounter && (
                <>
                  <Text style={st.fieldLabel}>Show when this many or fewer are left</Text>
                  <TextInput style={st.input} value={counterText} keyboardType="number-pad" placeholder="5" placeholderTextColor={colors.subtle}
                    onChangeText={(t) => setCounterText(t.replace(/[^0-9]/g, ''))} />
                </>
              )}
            </BrandthreadCard>
            <PrimaryButton label="Save stock rules" onPress={saveRules} loading={busy === 'rules'} style={st.fullBtn} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 140 },
  productName: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground, marginHorizontal: SP.md, marginTop: SP.sm },
  sh: { marginTop: SP.lg, marginBottom: SP.sm },
  card: { marginHorizontal: SP.md, marginBottom: SP.sm, gap: SP.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  axisName: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  muted: { fontFamily: FONT.regular, fontSize: FS.sm, color: c.mutedForeground, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
  chipText: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.foreground },
  addBtn: { minWidth: 72, height: 46, paddingHorizontal: 16, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  addRow: { flexDirection: 'row', alignItems: 'flex-end', gap: SP.sm },
  input: { fontFamily: FONT.regular, fontSize: FS.base, color: c.foreground, backgroundColor: c.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: c.border, paddingHorizontal: SP.md, paddingVertical: 10 },
  fieldLabel: { fontFamily: FONT.medium, fontSize: FS.xs, color: c.mutedForeground, marginBottom: 4 },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginHorizontal: SP.md, marginBottom: SP.sm, paddingVertical: 12, paddingHorizontal: SP.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed' },
  addOptionText: { fontFamily: FONT.medium, fontSize: FS.base, color: c.foreground },
  sortRow: { flexDirection: 'row', gap: SP.xs, marginHorizontal: SP.md, marginBottom: SP.sm },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border },
  sortChipOn: { backgroundColor: c.foreground, borderColor: c.foreground },
  sortText: { fontFamily: FONT.medium, fontSize: FS.sm, color: c.mutedForeground },
  sortTextOn: { color: c.background },
  groupTitle: { fontFamily: FONT.semibold, fontSize: FS.xs, color: c.mutedForeground, letterSpacing: 0.6, textTransform: 'uppercase', paddingTop: SP.md },
  variantRow: { paddingVertical: SP.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  variantName: { fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground },
  stockPill: { width: 68, flexShrink: 0, textAlign: 'center', fontFamily: FONT.semibold, fontSize: FS.base, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 8 },
  editGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  radioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingVertical: 6 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  radioOn: { borderColor: c.foreground },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.foreground },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  fullBtn: { marginHorizontal: SP.md, marginTop: SP.sm },
});
