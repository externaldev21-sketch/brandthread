/**
 * Brandthread Seller Sales
 * Route: /sales
 * Automatic sales: a percentage or fixed amount off the whole store, selected
 * products or a collection for a date range. Buyers see the sale price with
 * the original struck through; discount codes apply on top of the sale price.
 * Layout follows Shopify's "Create discount" (Value segmented control,
 * Applies to, Active dates, Summary).
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/hooks/useApi';
import { isSellerDevPreview } from '@/lib/devPreview';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { BrandthreadCard, PrimaryButton, StatusBadge, SectionHeader, HapticSwitch } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';

type DiscountType = 'percent' | 'fixed';
type Scope = 'store' | 'products' | 'collection';
type SaleStatus = 'live' | 'scheduled' | 'paused' | 'ended';

interface Sale {
  id: string;
  name: string;
  discountType: DiscountType;
  value: number;
  scope: Scope;
  collection: string | null;
  productIds: string[];
  startsAt: string;
  endsAt: string | null;
  active: boolean;
  status: SaleStatus;
}

function normalizeSale(raw: any): Sale {
  return {
    id: String(raw.id),
    name: raw.name ?? '',
    discountType: raw.discountType === 'fixed' ? 'fixed' : 'percent',
    value: Number(raw.value) || 0,
    scope: raw.scope === 'products' || raw.scope === 'collection' ? raw.scope : 'store',
    collection: raw.collection ?? null,
    productIds: Array.isArray(raw.productIds) ? raw.productIds : [],
    startsAt: raw.startsAt ?? new Date().toISOString(),
    endsAt: raw.endsAt ?? null,
    active: !!raw.active,
    status: raw.status ?? (raw.active ? 'live' : 'paused'),
  };
}

const STATUS_VARIANT: Record<SaleStatus, 'success' | 'neutral' | 'error'> = {
  live: 'success', scheduled: 'neutral', paused: 'neutral', ended: 'error',
};
const STATUS_LABEL: Record<SaleStatus, string> = {
  live: 'Live', scheduled: 'Scheduled', paused: 'Paused', ended: 'Ended',
};

function fmtValue(s: Pick<Sale, 'discountType' | 'value'>) {
  return s.discountType === 'percent' ? `${s.value}% off` : `${formatCents(s.value)} off`;
}
function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function scopeLabel(s: Pick<Sale, 'scope' | 'collection' | 'productIds'>) {
  if (s.scope === 'store') return 'Entire store';
  if (s.scope === 'collection') return s.collection ? `Collection: ${s.collection}` : 'Collection';
  return `${s.productIds.length} product${s.productIds.length === 1 ? '' : 's'}`;
}

export default function SalesScreen() {
  const { theme } = useAppTheme();
  const { muted: MUTED } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const api = useApi();
  // Signed-out seller preview: never call the API; changes live in this session only.
  const [isPreviewMode] = useState(() => isSellerDevPreview());
  const previewOnly = isPreviewMode && (!authLoaded || !isSignedIn || !userId);

  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [loading, setLoading] = useState(!previewOnly);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [discType, setDiscType] = useState<DiscountType>('percent');
  const [percent, setPercent] = useState('20');
  const [fixedValue, setFixedValue] = useState('10.00');
  const [scope, setScope] = useState<Scope>('store');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [collection, setCollection] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [hasEnd, setHasEnd] = useState(false);
  const [endDate, setEndDate] = useState('');

  const load = useCallback(async () => {
    if (previewOnly) { setLoading(false); return; }
    setLoading(true);
    try {
      const [data, prods, cols] = await Promise.all([
        api.sales.list(),
        api.products.list().catch(() => []),
        api.sales.collections().catch(() => []),
      ]);
      setSales(Array.isArray(data) ? data.map(normalizeSale) : []);
      setProducts(Array.isArray(prods) ? prods : Array.isArray((prods as any)?.products) ? (prods as any).products : []);
      setCollections(Array.isArray(cols) ? cols : []);
      setLoadError(false);
    } catch {
      setSales([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, previewOnly]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  function resetForm() {
    setName(''); setDiscType('percent'); setPercent('20'); setFixedValue('10.00');
    setScope('store'); setSelectedProductIds([]); setCollection(null);
    setStartDate(''); setHasEnd(false); setEndDate('');
  }
  function openNew() { resetForm(); setEditingId(null); setShowModal(true); }
  function openEdit(x: Sale) {
    setName(x.name); setDiscType(x.discountType);
    if (x.discountType === 'percent') setPercent(String(x.value)); else setFixedValue((x.value / 100).toFixed(2));
    setScope(x.scope); setSelectedProductIds(x.productIds); setCollection(x.collection);
    setStartDate(x.startsAt.slice(0, 10)); setHasEnd(!!x.endsAt); setEndDate(x.endsAt ? x.endsAt.slice(0, 10) : '');
    setEditingId(x.id); setShowModal(true);
  }

  const valueCents = discType === 'fixed' ? parseDecimalToCents(fixedValue) : null;
  const pct = parseInt(percent, 10);
  const summaryValue = discType === 'percent' ? `${Number.isFinite(pct) ? pct : 0}% off` : `${formatCents(valueCents ?? 0)} off`;
  const summaryScope = scopeLabel({ scope, collection, productIds: selectedProductIds });
  const summaryDates = `${startDate ? `Starts ${startDate}` : 'Starts immediately'}${hasEnd && endDate ? ` · Ends ${endDate}` : ' · No end date'}`;

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Name your sale', 'Give the sale a name so you can find it later.'); return; }
    if (discType === 'percent' && !(pct >= 1 && pct <= 90)) { Alert.alert('Invalid percentage', 'Choose between 1% and 90%.'); return; }
    if (discType === 'fixed' && (valueCents == null || valueCents <= 0)) { Alert.alert('Invalid amount', 'Enter a valid dollar amount.'); return; }
    if (scope === 'products' && selectedProductIds.length === 0) { Alert.alert('Select products', 'Choose at least one product.'); return; }
    if (scope === 'collection' && !collection) { Alert.alert('Select a collection', 'Choose the collection this sale applies to.'); return; }
    const start = startDate ? new Date(startDate) : null;
    const end = hasEnd && endDate ? new Date(endDate) : null;
    if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime()))) { Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.'); return; }
    if (start && end && end <= start) { Alert.alert('Invalid dates', 'The end date must be after the start date.'); return; }
    if (previewOnly) { Alert.alert('Sign in required', 'Sign in to your seller account to create sales.'); return; }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), discountType: discType,
        value: discType === 'percent' ? pct : (valueCents as number),
        scope,
        productIds: scope === 'products' ? selectedProductIds : [],
        collection: scope === 'collection' ? collection : null,
        startsAt: start ? start.toISOString() : null,
        endsAt: end ? end.toISOString() : null,
      };
      if (editingId) {
        const updated = await api.sales.update(editingId, { ...payload, startsAt: payload.startsAt ?? new Date().toISOString() });
        setSales(prev => prev.map(x => x.id === editingId ? normalizeSale(updated) : x));
      } else {
        const created = await api.sales.create(payload);
        setSales(prev => [normalizeSale(created), ...prev]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowModal(false);
    } catch (err: any) {
      Alert.alert("Couldn't save the sale", err?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(x: Sale) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextActive = !x.active;
    setSales(prev => prev.map(r => r.id === x.id ? { ...r, active: nextActive, status: nextActive ? 'live' : 'paused' } : r));
    try { await api.sales.update(x.id, { active: nextActive }); }
    catch { void load(); }
  }

  function handleDelete(x: Sale) {
    Alert.alert('Delete sale?', `Remove "${x.name}"? Prices go back to normal immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setSales(prev => prev.filter(r => r.id !== x.id));
          try { await api.sales.delete(x.id); } catch { void load(); }
        },
      },
    ]);
  }

  const Seg = ({ on, label, onPress, flex = true }: { on: boolean; label: string; onPress: () => void; flex?: boolean }) => (
    <TouchableOpacity
      style={[s.seg, flex && { flex: 1 }, on && { backgroundColor: theme.accent, borderColor: theme.accent }]}
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      accessibilityRole="button" accessibilityState={{ selected: on }}
    >
      <Text style={[s.segText, on && { color: theme.onAccent }]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={s.root}>
      <ScreenHeader title="Sales" actions={[{ icon: 'plus', onPress: openNew, accessibilityLabel: 'New sale' }]} />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>
          {loadError ? (
            <EmptyState icon="alert-circle" title="Couldn't load your sales" message="Pull to refresh." actionLabel="Try again" onAction={() => { void load(); }} variant="error" />
          ) : sales.length === 0 && (
            <EmptyState
              icon="percent"
              title="No sales yet"
              message="Put your store, selected products or a collection on sale for a date range. Buyers see the new price with the original struck through."
              actionLabel="Create sale"
              onAction={openNew}
            />
          )}
          {sales.length > 0 && <SectionHeader title="Your sales" />}
          {sales.map(x => (
            <BrandthreadCard key={x.id} style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: SP.sm }}>
                  <Text style={s.cardName} numberOfLines={1}>{x.name}</Text>
                  <Text style={s.cardValue}>{fmtValue(x)}</Text>
                  <Text style={s.metaText}>{scopeLabel(x)}</Text>
                  <Text style={s.metaText}>
                    {x.status === 'scheduled' ? `Starts ${fmtDate(x.startsAt)}` : x.endsAt ? `Ends ${fmtDate(x.endsAt)}` : 'No end date'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 8 }}>
                  <StatusBadge label={STATUS_LABEL[x.status]} variant={STATUS_VARIANT[x.status]} small />
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity onPress={() => openEdit(x)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel={`Edit ${x.name}`}>
                      <Feather name="edit-2" size={15} color={MUTED} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => togglePause(x)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel={x.active ? `Pause ${x.name}` : `Resume ${x.name}`}>
                      <Feather name={x.active ? 'pause-circle' : 'play-circle'} size={15} color={MUTED} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDelete(x)} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }} accessibilityRole="button" accessibilityLabel={`Delete ${x.name}`}>
                      <Feather name="trash-2" size={15} color={MUTED} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </BrandthreadCard>
          ))}
        </ScrollView>
      )}

      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <SafeAreaProvider style={s.modal}>
          <ScreenHeader title={editingId ? 'Edit sale' : 'Create sale'} variant="modal" onBack={() => setShowModal(false)} />
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SP.md, gap: SP.lg, paddingBottom: 60 }}>
            <View>
              <Text style={s.label}>Sale name</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Summer sale" placeholderTextColor={MUTED} maxLength={80} />
            </View>

            <View>
              <Text style={s.label}>Discount value</Text>
              <View style={s.segRow}>
                <Seg on={discType === 'percent'} label="Percentage" onPress={() => setDiscType('percent')} />
                <Seg on={discType === 'fixed'} label="Fixed amount" onPress={() => setDiscType('fixed')} />
              </View>
              {discType === 'percent' ? (
                <TextInput style={[s.input, { marginTop: SP.sm }]} value={percent} onChangeText={t => setPercent(t.replace(/[^0-9]/g, '').slice(0, 2))} keyboardType="number-pad" placeholder="20" placeholderTextColor={MUTED} />
              ) : (
                <TextInput style={[s.input, { marginTop: SP.sm }]} value={fixedValue} onChangeText={setFixedValue} keyboardType="decimal-pad" placeholder="10.00" placeholderTextColor={MUTED} />
              )}
            </View>

            <View>
              <Text style={s.label}>Applies to</Text>
              <View style={s.segRow}>
                <Seg on={scope === 'store'} label="Entire store" onPress={() => setScope('store')} />
                <Seg on={scope === 'products'} label="Products" onPress={() => setScope('products')} />
                <Seg on={scope === 'collection'} label="Collection" onPress={() => setScope('collection')} />
              </View>
              {scope === 'products' && (
                <TouchableOpacity style={s.pickerRow} onPress={() => setShowProductPicker(true)}>
                  <Text style={s.pickerRowText}>{selectedProductIds.length === 0 ? 'Add products' : `${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} selected`}</Text>
                  <Feather name="chevron-right" size={16} color={MUTED} />
                </TouchableOpacity>
              )}
              {scope === 'collection' && (
                <TouchableOpacity style={s.pickerRow} onPress={() => setShowCollectionPicker(true)}>
                  <Text style={s.pickerRowText}>{collection ?? 'Choose a collection'}</Text>
                  <Feather name="chevron-right" size={16} color={MUTED} />
                </TouchableOpacity>
              )}
            </View>

            <View>
              <Text style={s.label}>Active dates</Text>
              <TextInput style={s.input} value={startDate} onChangeText={setStartDate} placeholder="Start date (YYYY-MM-DD)" placeholderTextColor={MUTED} autoCorrect={false} />
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>Set end date</Text>
                <HapticSwitch value={hasEnd} onValueChange={setHasEnd} />
              </View>
              {hasEnd && (
                <TextInput style={[s.input, { marginTop: SP.sm }]} value={endDate} onChangeText={setEndDate} placeholder="End date (YYYY-MM-DD)" placeholderTextColor={MUTED} autoCorrect={false} />
              )}
            </View>

            <View style={s.summaryCard}>
              <Text style={s.label}>Summary</Text>
              <Text style={s.summaryName}>{name.trim() || 'Untitled sale'}</Text>
              <Text style={s.summaryLine}>{summaryValue}</Text>
              <Text style={s.summaryLine}>{summaryScope}</Text>
              <Text style={s.summaryLine}>{summaryDates}</Text>
              <Text style={s.summaryLine}>Discount codes apply on top of the sale price</Text>
            </View>

            <PrimaryButton label={saving ? 'Saving…' : editingId ? 'Save changes' : 'Create sale'} onPress={handleSave} disabled={saving} />
          </ScrollView>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={showProductPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProductPicker(false)}>
        <SafeAreaProvider style={s.modal}>
          <ScreenHeader title="Choose products" variant="modal" onBack={() => setShowProductPicker(false)} actions={[{ icon: 'check', onPress: () => setShowProductPicker(false), accessibilityLabel: 'Done choosing products' }]} />
          <ScrollView contentContainerStyle={{ padding: SP.md, gap: 8 }}>
            {products.length === 0 ? (
              <Text style={{ color: MUTED, fontSize: FS.sm, textAlign: 'center', marginTop: 30 }}>No products found.</Text>
            ) : products.map(p => {
              const on = selectedProductIds.includes(p.id);
              return (
                <TouchableOpacity key={p.id} style={[s.pickRow, on && { borderColor: theme.accent }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedProductIds(prev => on ? prev.filter(id => id !== p.id) : [...prev, p.id]); }}>
                  <Text style={s.pickName} numberOfLines={1}>{p.name}</Text>
                  <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? theme.accent : MUTED} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaProvider>
      </Modal>

      <Modal visible={showCollectionPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowCollectionPicker(false)}>
        <SafeAreaProvider style={s.modal}>
          <ScreenHeader title="Choose a collection" variant="modal" onBack={() => setShowCollectionPicker(false)} />
          <ScrollView contentContainerStyle={{ padding: SP.md, gap: 8 }}>
            {collections.length === 0 ? (
              <Text style={{ color: MUTED, fontSize: FS.sm, textAlign: 'center', marginTop: 30 }}>No categories or tags on your products yet.</Text>
            ) : collections.map(c => {
              const on = collection === c;
              return (
                <TouchableOpacity key={c} style={[s.pickRow, on && { borderColor: theme.accent }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCollection(c); setShowCollectionPicker(false); }}>
                  <Text style={s.pickName} numberOfLines={1}>{c}</Text>
                  <Feather name={on ? 'check-circle' : 'circle'} size={18} color={on ? theme.accent : MUTED} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const FG = theme.text, MUTED = theme.muted, BORDER = theme.border, CARD = theme.cardElevated;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    modal: { flex: 1, backgroundColor: theme.background },
    card: { marginBottom: SP.sm },
    cardName: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
    cardValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginTop: 2, marginBottom: 2 },
    metaText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
    label: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
    input: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
    segRow: { flexDirection: 'row', gap: 8 },
    seg: { paddingVertical: 11, paddingHorizontal: 10, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
    segText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.sm },
    switchLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
    pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, marginTop: 8 },
    pickerRowText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
    pickRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12 },
    pickName: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginRight: 8 },
    summaryCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.md, gap: 4 },
    summaryName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
    summaryLine: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  });
};
