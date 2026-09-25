/**
 * Brandthread Seller Discounts
 * Route: /discounts
 * One page: create a real, working discount code (auto-generated or typed),
 * a live summary card, and the list of existing codes with status/uses and
 * pause/edit.
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ActivityIndicator, Switch, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { InlineSlider } from '@/components/InlineSlider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '@/hooks/useApi';
import {
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import {
  BrandthreadCard, PrimaryButton, SecondaryButton, TertiaryButton,
  StatusBadge, SectionHeader, EmptyState, HapticSwitch,
} from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';

type DiscountType = 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
type AppliesTo = 'entire_store' | 'specific_products';
type DiscountStatus = 'active' | 'scheduled' | 'paused' | 'expired' | 'exhausted';

interface DiscountCode {
  id: string;
  code: string;
  type: DiscountType;
  value: number;
  minOrderCents: number;
  appliesTo: AppliesTo;
  productIds: string[];
  maxUses: number | null;
  usesCount: number;
  oneUsePerCustomer: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  active: boolean;
  status: DiscountStatus;
  createdAt: string;
}

function normalizeDiscount(raw: any): DiscountCode {
  return {
    id: String(raw.id),
    code: raw.code,
    type: raw.type,
    value: Number(raw.value),
    minOrderCents: raw.minOrderCents ?? 0,
    appliesTo: raw.appliesTo ?? 'entire_store',
    productIds: Array.isArray(raw.productIds) ? raw.productIds : [],
    maxUses: raw.maxUses ?? null,
    usesCount: raw.usesCount ?? 0,
    oneUsePerCustomer: !!raw.oneUsePerCustomer,
    startsAt: raw.startsAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    active: !!raw.active,
    status: raw.status ?? (raw.active ? 'active' : 'paused'),
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

function fmtValue(d: Pick<DiscountCode, 'type' | 'value'>) {
  if (d.type === 'percentage') return `${d.value}% off`;
  if (d.type === 'fixed') return `${formatCents(Math.round(d.value * 100))} off`;
  if (d.type === 'free_shipping') return 'Free shipping';
  return 'Free item';
}

const STATUS_VARIANT: Record<DiscountStatus, 'success' | 'warning' | 'neutral' | 'error'> = {
  active: 'success',
  scheduled: 'neutral',
  paused: 'neutral',
  expired: 'error',
  exhausted: 'warning',
};
const STATUS_LABEL: Record<DiscountStatus, string> = {
  active: 'Active', scheduled: 'Scheduled', paused: 'Paused', expired: 'Expired', exhausted: 'Used up',
};

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DiscountsScreen() {
  const { theme } = useAppTheme();
  const { text: FG, muted: MUTED, border: BORDER } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; images?: string[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // ── Form state ──────────────────────────────────────────────────────────
  const [code, setCode] = useState('');
  const [discType, setDiscType] = useState<DiscountType>('percentage');
  const [percent, setPercent] = useState(20);
  const [fixedValue, setFixedValue] = useState('10.00');
  const [appliesTo, setAppliesTo] = useState<AppliesTo>('entire_store');
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [minOrder, setMinOrder] = useState('');
  const [usageMode, setUsageMode] = useState<'unlimited' | 'limited' | 'single'>('unlimited');
  const [usageLimit, setUsageLimit] = useState('100');
  const [oneUsePerCustomer, setOneUsePerCustomer] = useState(false);
  const [hasEnd, setHasEnd] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadDiscounts = useCallback(async () => {
    setLoading(true);
    try {
      const [data, prods] = await Promise.all([
        api.discountCodes.list(),
        api.products.list().catch(() => []),
      ]);
      setDiscounts(Array.isArray(data) ? data.map(normalizeDiscount) : []);
      setProducts(Array.isArray(prods) ? prods : Array.isArray((prods as any)?.products) ? (prods as any).products : []);
      setLoadError(false);
    } catch {
      setDiscounts([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { loadDiscounts(); }, [loadDiscounts]));

  function resetForm() {
    setCode('');
    setDiscType('percentage');
    setPercent(20);
    setFixedValue('10.00');
    setAppliesTo('entire_store');
    setSelectedProductIds([]);
    setMinOrder('');
    setUsageMode('unlimited');
    setUsageLimit('100');
    setOneUsePerCustomer(false);
    setHasEnd(false);
    setStartDate('');
    setEndDate('');
  }

  function openNewModal() {
    resetForm();
    setEditingId(null);
    setShowModal(true);
  }

  function openEditModal(d: DiscountCode) {
    setCode(d.code);
    setDiscType(d.type);
    if (d.type === 'percentage') setPercent(d.value);
    else setFixedValue(d.value.toFixed(2));
    setAppliesTo(d.appliesTo);
    setSelectedProductIds(d.productIds);
    setMinOrder(d.minOrderCents ? (d.minOrderCents / 100).toFixed(2) : '');
    setUsageMode(d.maxUses === 1 ? 'single' : d.maxUses != null ? 'limited' : 'unlimited');
    setUsageLimit(d.maxUses != null ? String(d.maxUses) : '100');
    setOneUsePerCustomer(d.oneUsePerCustomer);
    setHasEnd(!!d.expiresAt);
    setStartDate(d.startsAt ? d.startsAt.slice(0, 10) : '');
    setEndDate(d.expiresAt ? d.expiresAt.slice(0, 10) : '');
    setEditingId(d.id);
    setShowModal(true);
  }

  const minOrderCents = minOrder ? parseDecimalToCents(minOrder) : 0;
  const summaryValueLabel = discType === 'percentage'
    ? `${percent}% off`
    : discType === 'fixed'
      ? `${formatCents(Math.round((parseFloat(fixedValue) || 0) * 100))} off`
      : discType === 'free_shipping'
        ? 'Free shipping'
        : 'Free item (cheapest eligible)';
  const summaryScopeLabel = appliesTo === 'entire_store'
    ? 'Entire store'
    : selectedProductIds.length > 0
      ? `${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'}`
      : 'Select products';
  const summaryUsageLabel = usageMode === 'unlimited' ? 'Unlimited uses' : usageMode === 'single' ? 'Single use (1 total)' : `${usageLimit || '0'} total uses`;
  const summaryDatesLabel = !startDate && !hasEnd
    ? 'Active immediately, no end date'
    : `${startDate ? `Starts ${startDate}` : 'Starts immediately'}${hasEnd && endDate ? ` · Ends ${endDate}` : hasEnd ? '' : ' · No end date'}`;

  async function handleSave() {
    if (discType !== 'free_shipping' && discType !== 'free_item') {
      if (discType === 'percentage' && (percent < 1 || percent > 100)) {
        Alert.alert('Invalid percentage', 'Choose between 1% and 100%.');
        return;
      }
      if (discType === 'fixed') {
        const cents = parseDecimalToCents(fixedValue);
        if (cents == null || cents <= 0) {
          Alert.alert('Invalid amount', 'Enter a valid dollar amount.');
          return;
        }
      }
    }
    if (appliesTo === 'specific_products' && selectedProductIds.length === 0) {
      Alert.alert('Select products', 'Choose at least one product this code applies to.');
      return;
    }
    if (minOrder && minOrderCents == null) {
      Alert.alert('Invalid minimum', 'Enter a valid minimum order amount.');
      return;
    }
    if (usageMode === 'limited' && (!usageLimit.trim() || Number(usageLimit) < 1)) {
      Alert.alert('Invalid usage limit', 'Enter how many times this code can be used.');
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSaving(true);
    try {
      const payload: any = {
        code: code.trim() || undefined,
        type: discType,
        value: discType === 'percentage' ? percent : discType === 'fixed' ? parseFloat(fixedValue) : 0,
        minOrderCents: minOrderCents ?? 0,
        appliesTo,
        productIds: appliesTo === 'specific_products' ? selectedProductIds : [],
        maxUses: usageMode === 'unlimited' ? null : usageMode === 'single' ? 1 : Number(usageLimit),
        singleUse: usageMode === 'single',
        oneUsePerCustomer,
        startsAt: startDate ? new Date(startDate).toISOString() : null,
        expiresAt: hasEnd && endDate ? new Date(endDate).toISOString() : null,
      };
      if (editingId) {
        const updated = await api.discountCodes.update(editingId, payload);
        setDiscounts(prev => prev.map(d => d.id === editingId ? normalizeDiscount(updated) : d));
      } else {
        const created = await api.discountCodes.create(payload);
        setDiscounts(prev => [normalizeDiscount(created), ...prev]);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowModal(false);
    } catch (err: any) {
      Alert.alert("Couldn't save the code", err?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(d: DiscountCode) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextActive = !d.active;
    setDiscounts(prev => prev.map(x => x.id === d.id ? { ...x, active: nextActive, status: nextActive ? 'active' : 'paused' } : x));
    try {
      await api.discountCodes.update(d.id, { active: nextActive });
    } catch {
      setDiscounts(prev => prev.map(x => x.id === d.id ? d : x));
    }
  }

  async function handleDelete(d: DiscountCode) {
    Alert.alert('Delete discount?', `Remove code "${d.code}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setDiscounts(prev => prev.filter(x => x.id !== d.id));
          try { await api.discountCodes.delete(d.id); }
          catch { loadDiscounts(); }
        },
      },
    ]);
  }

  function copyCode(codeValue: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Clipboard.setStringAsync(codeValue);
  }

  return (
    <View style={s.root}>
      <Header
        title="Discounts"
        actions={[{ icon: 'plus', onPress: openNewModal, accessibilityLabel: 'New discount' }]}
      />

      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: SP.md, paddingBottom: insets.bottom + 40 }}>

          {loadError ? (
            <EmptyState
              icon="alert-circle"
              title="Couldn't load your codes"
              description="Pull to refresh."
              action={{ label: 'Try again', onPress: () => { void loadDiscounts(); }, icon: 'refresh-cw' }}
            />
          ) : discounts.length === 0 && (
            <EmptyState
              icon="tag"
              title="No discount codes yet"
              description="Create a code to offer buyers a percentage off, a fixed amount, free shipping or a free item."
              action={{ label: 'Create code', onPress: openNewModal }}
            />
          )}

          {discounts.length > 0 && <SectionHeader title="Your codes" />}
          {discounts.map(d => (
            <DiscountCard
              key={d.id}
              d={d}
              onEdit={() => openEditModal(d)}
              onTogglePause={() => togglePause(d)}
              onDelete={() => handleDelete(d)}
              onCopy={() => copyCode(d.code)}
            />
          ))}
        </ScrollView>
      )}

      {/* Create / Edit Modal — one page */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <View style={[s.modal, { paddingTop: 20 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{editingId ? 'Edit Discount Code' : 'New Discount Code'}</Text>
            <TouchableOpacity onPress={() => setShowModal(false)} style={s.modalClose}>
              <Feather name="x" size={18} color={FG} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: 60 }}>

            {/* Live summary card */}
            <View style={[s.summaryCard, { borderColor: theme.accent + '55' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.summaryCode, { color: theme.accent }]}>{code.trim() || 'YOURCODE'}</Text>
                <Feather name="tag" size={16} color={theme.accent} />
              </View>
              <Text style={s.summaryValue}>{summaryValueLabel}</Text>
              <View style={s.summaryRow}><Feather name="shopping-bag" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryScopeLabel}</Text></View>
              {minOrderCents ? <View style={s.summaryRow}><Feather name="dollar-sign" size={12} color={MUTED} /><Text style={s.summaryLine}>Min. order {formatCents(minOrderCents)}</Text></View> : null}
              <View style={s.summaryRow}><Feather name="hash" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryUsageLabel}{oneUsePerCustomer ? ' · 1 per customer' : ''}</Text></View>
              <View style={s.summaryRow}><Feather name="calendar" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryDatesLabel}</Text></View>
            </View>

            {/* Code */}
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={s.label}>Code <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional — auto-generated if blank)</Text></Text>
                <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setCode(randomCode()); }}>
                  <Text style={[s.linkText, { color: theme.accent }]}>Generate</Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={s.input}
                value={code}
                onChangeText={t => setCode(t.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                placeholder="e.g. SAVE20"
                placeholderTextColor={MUTED}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!editingId}
              />
            </View>

            {/* Type */}
            <View>
              <Text style={s.label}>Type</Text>
              <View style={s.typeGrid}>
                {([
                  ['percentage', '% Percent off'],
                  ['fixed', '$ Fixed amount'],
                  ['free_shipping', 'Free shipping'],
                  ['free_item', 'Free item'],
                ] as const).map(([t, label]) => (
                  <TouchableOpacity key={t} style={[s.typeBtn, discType === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setDiscType(t); }}>
                    <Text style={[s.typeBtnText, discType === t && { color: theme.accent }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {discType === 'percentage' && (
              <View>
                <Text style={s.label}>Percentage off — {percent}%</Text>
                <InlineSlider
                  min={1}
                  max={100}
                  step={1}
                  value={percent}
                  onChange={setPercent}
                  accessibilityLabel="Percentage off"
                  accentColor={theme.accent}
                  trackColor={BORDER}
                />
                <TextInput
                  style={s.input}
                  value={String(percent)}
                  onChangeText={t => { const n = parseInt(t, 10); if (!isNaN(n)) setPercent(Math.max(1, Math.min(100, n))); else if (t === '') setPercent(1); }}
                  keyboardType="number-pad"
                  placeholder="20"
                  placeholderTextColor={MUTED}
                />
              </View>
            )}

            {discType === 'fixed' && (
              <View>
                <Text style={s.label}>Amount off ($)</Text>
                <TextInput
                  style={s.input}
                  value={fixedValue}
                  onChangeText={setFixedValue}
                  placeholder="10.00"
                  placeholderTextColor={MUTED}
                  keyboardType="decimal-pad"
                />
              </View>
            )}

            {/* Applies to */}
            <View>
              <Text style={s.label}>Applies to</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['entire_store', 'specific_products'] as const).map(t => (
                  <TouchableOpacity key={t} style={[s.typeBtn, { flex: 1 }, appliesTo === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAppliesTo(t); }}>
                    <Text style={[s.typeBtnText, appliesTo === t && { color: theme.accent }]}>{t === 'entire_store' ? 'Entire store' : 'Specific products'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {appliesTo === 'specific_products' && (
                <TouchableOpacity style={s.pickerRow} onPress={() => setShowProductPicker(true)}>
                  <Text style={s.pickerRowText}>
                    {selectedProductIds.length === 0 ? 'Choose products…' : `${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} selected`}
                  </Text>
                  <Feather name="chevron-right" size={16} color={MUTED} />
                </TouchableOpacity>
              )}
            </View>

            {/* Min order */}
            <View>
              <Text style={s.label}>Minimum order ($) <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={minOrder}
                onChangeText={setMinOrder}
                placeholder="50.00"
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Usage limits */}
            <View>
              <Text style={s.label}>Usage limits</Text>
              <View style={s.typeGrid}>
                {([
                  ['unlimited', 'Unlimited'],
                  ['limited', 'Limited total'],
                  ['single', 'Single-use'],
                ] as const).map(([t, label]) => (
                  <TouchableOpacity key={t} style={[s.typeBtn, discType === discType && usageMode === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setUsageMode(t); }}>
                    <Text style={[s.typeBtnText, usageMode === t && { color: theme.accent }]}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {usageMode === 'limited' && (
                <TextInput
                  style={[s.input, { marginTop: 8 }]}
                  value={usageLimit}
                  onChangeText={setUsageLimit}
                  placeholder="100"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                />
              )}
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>One use per customer</Text>
                <HapticSwitch value={oneUsePerCustomer} onValueChange={setOneUsePerCustomer} />
              </View>
            </View>

            {/* Active dates */}
            <View>
              <Text style={s.label}>Active dates</Text>
              <Text style={s.subLabel}>Start date <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional — blank starts immediately)</Text></Text>
              <TextInput
                style={s.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={MUTED}
                autoCorrect={false}
              />
              <View style={[s.switchRow, { marginTop: SP.sm }]}>
                <Text style={s.switchLabel}>Set an end date</Text>
                <HapticSwitch value={hasEnd} onValueChange={setHasEnd} />
              </View>
              {hasEnd && (
                <TextInput
                  style={s.input}
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={MUTED}
                  autoCorrect={false}
                />
              )}
            </View>

            <PrimaryButton
              label={saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Code'}
              onPress={handleSave}
              disabled={saving}
              style={{ marginTop: SP.sm }}
            />
          </ScrollView>
        </View>
      </Modal>

      {/* Product picker sheet */}
      <Modal visible={showProductPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProductPicker(false)}>
        <View style={[s.modal, { paddingTop: 20 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Choose products</Text>
            <TouchableOpacity onPress={() => setShowProductPicker(false)} style={s.modalClose}>
              <Feather name="check" size={18} color={FG} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: SP.md, gap: 8 }}>
            {products.length === 0 ? (
              <Text style={{ color: MUTED, fontSize: FS.sm, textAlign: 'center', marginTop: 30 }}>No products found.</Text>
            ) : products.map(p => {
              const selected = selectedProductIds.includes(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[s.productRow, selected && { borderColor: theme.accent, backgroundColor: theme.accent + '15' }]}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedProductIds(prev => selected ? prev.filter(id => id !== p.id) : [...prev, p.id]);
                  }}
                >
                  <Text style={s.productName} numberOfLines={1}>{p.name}</Text>
                  <Feather name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? theme.accent : MUTED} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function DiscountCard({ d, onEdit, onTogglePause, onDelete, onCopy }: {
  d: DiscountCode;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const { theme } = useAppTheme();
  const { muted: MUTED, border: BORDER, success: SUCCESS, warning: ORANGE, error: RED } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const pctUsed = d.maxUses ? Math.round((d.usesCount / d.maxUses) * 100) : null;

  return (
    <BrandthreadCard style={s.card}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onCopy} activeOpacity={0.7}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.codeText}>{d.code}</Text>
            <Feather name="copy" size={12} color={MUTED} />
          </View>
          <Text style={[s.valueText, { color: theme.accentLight }]}>{fmtValue(d)}</Text>
          <Text style={s.metaText}>{d.appliesTo === 'entire_store' ? 'Entire store' : `${d.productIds.length} product${d.productIds.length === 1 ? '' : 's'}`}</Text>
          {d.minOrderCents > 0 && <Text style={s.metaText}>Min. order {formatCents(d.minOrderCents)}</Text>}
          <Text style={s.metaText}>
            {d.startsAt && new Date(d.startsAt).getTime() > Date.now() ? `Starts ${fmtDate(d.startsAt)}` : d.expiresAt ? `Ends ${fmtDate(d.expiresAt)}` : 'No end date'}
          </Text>
        </TouchableOpacity>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <StatusBadge label={STATUS_LABEL[d.status]} variant={STATUS_VARIANT[d.status]} small />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onEdit}><Feather name="edit-2" size={15} color={MUTED} /></TouchableOpacity>
            <TouchableOpacity onPress={onTogglePause}><Feather name={d.active ? 'pause-circle' : 'play-circle'} size={15} color={d.active ? ORANGE : SUCCESS} /></TouchableOpacity>
            <TouchableOpacity onPress={onDelete}><Feather name="trash-2" size={15} color={RED} /></TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER }}>
        <View style={s.statPill}>
          <Feather name="users" size={11} color={MUTED} />
          <Text style={s.statText}>{d.usesCount} use{d.usesCount === 1 ? '' : 's'}</Text>
        </View>
        {d.maxUses != null && (
          <View style={s.statPill}>
            <Feather name="sliders" size={11} color={MUTED} />
            <Text style={s.statText}>Limit {d.maxUses}</Text>
          </View>
        )}
        {d.oneUsePerCustomer && (
          <View style={s.statPill}>
            <Feather name="user-check" size={11} color={MUTED} />
            <Text style={s.statText}>1/customer</Text>
          </View>
        )}
        {pctUsed !== null && (
          <View style={{ flex: 1, height: 3, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' }}>
            <View style={{ width: `${Math.min(pctUsed, 100)}%`, height: '100%', backgroundColor: pctUsed >= 90 ? RED : pctUsed >= 60 ? ORANGE : SUCCESS }} />
          </View>
        )}
      </View>
    </BrandthreadCard>
  );
}

const createStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, onAccent: ON_ACCENT } = theme;
  const FG = theme.text;
  const MUTED = theme.muted;
  const BORDER = theme.border;
  const CARD_ELEVATED = theme.cardElevated;
  const BG = theme.background;
  return StyleSheet.create({
  root:       { flex: 1, backgroundColor: 'transparent' },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card:     { marginBottom: SP.sm },
  codeText: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, letterSpacing: 1.5 },
  valueText:{ fontSize: FS.sm, fontFamily: FONT.semibold, marginTop: 2, marginBottom: 2 },
  metaText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  statPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, paddingHorizontal: 6, paddingVertical: 3 },
  statText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  modal:       { flex: 1, backgroundColor: BG },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  modalTitle:  { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  modalClose:  { width: 36, height: 36, backgroundColor: CARD_ELEVATED, borderRadius: 10, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  summaryCard: { backgroundColor: CARD_ELEVATED, borderWidth: 1.5, borderRadius: RADIUS.md, padding: SP.md, gap: 6 },
  summaryCode: { fontSize: FS.md, fontFamily: FONT.bold, letterSpacing: 1.5 },
  summaryValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginTop: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  summaryLine: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  label:       { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  subLabel:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6 },
  linkText:    { fontSize: FS.xs, fontFamily: FONT.semibold },
  input:       { backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  typeGrid:    { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn:     { minWidth: '47%', flexGrow: 1, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  typeBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  switchRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.sm },
  switchLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  pickerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, marginTop: 8 },
  pickerRowText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  productRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12 },
  productName: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginRight: 8 },
  });
};
