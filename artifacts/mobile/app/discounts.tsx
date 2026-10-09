/**
 * Brandthread Seller Discounts
 * Route: /discounts
 * One page: create a real, working discount code (auto-generated or typed),
 * a live summary card, and the list of existing codes with status/uses and
 * pause/edit.
 *
 * The list follows Shopify iOS "Discounts": a search field, All / Active /
 * Scheduled / Expired chips, rows grouped under the day they were created,
 * each row the code, a status chip, a " • "-joined summary line and a usage
 * line. Tapping a row opens its actions (edit, copy, pause, delete).
 */
import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, Modal, ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { InlineSlider } from '@/components/InlineSlider';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useApi } from '@/hooks/useApi';
import { isSellerDevPreview } from '@/lib/devPreview';
import { usePreviewDemoMode } from '@/hooks/usePreviewDemoMode';
import { buildPreviewDemoDiscounts, isPreviewDemoDiscountId } from '@/lib/previewDiscounts';
import {
  DISCOUNT_FILTERS, DISCOUNT_STATUS_LABEL, discountSummaryLine, discountUsageLine, groupDiscountsByDay,
  matchesDiscountFilter, matchesDiscountSearch, type DiscountFilter,
} from '@/lib/discountList';
import { BottomSheet, Chip, ListRow } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { addPreviewDiscount, deletePreviewDiscount, getPreviewDiscounts, updatePreviewDiscount, whenPreviewSellerFreshStoreReady, type PreviewDiscount } from '@/lib/previewSellerFreshStore';
import {
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { PrimaryButton, HapticSwitch } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';

type DiscountType = 'percentage' | 'fixed' | 'free_shipping' | 'free_item';
type AppliesTo = 'entire_store' | 'specific_products' | 'collections';
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
  firstOrderOnly: boolean;
  collectionIds: string[];
  minQuantity: number;
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
    firstOrderOnly: !!raw.firstOrderOnly,
    collectionIds: Array.isArray(raw.collectionIds) ? raw.collectionIds : [],
    minQuantity: raw.minQuantity ?? 0,
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

/** Inputs are solid #1C1C1E app-wide (no translucent fills). */
const INPUT_BG = '#1C1C1E';

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
  const { muted: MUTED, border: BORDER } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const api = useApi();
  // The seller web preview (?bt_preview=seller) can't call the API — lib/api.ts
  // rejects every request there, signed in or not. Reads/writes go through
  // lib/previewSellerFreshStore.ts's local store instead, so "Create code"
  // still genuinely works in the preview; &demo=1 adds the local demo codes
  // from lib/previewDiscounts.ts. Fresh preview starts empty.
  const [previewOnly] = useState(() => isSellerDevPreview());
  const previewDemo = usePreviewDemoMode();
  const [filter, setFilter] = useState<DiscountFilter>('all');
  const [search, setSearch] = useState('');
  const [actionFor, setActionFor] = useState<DiscountCode | null>(null);

  const [discounts, setDiscounts] = useState<DiscountCode[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string; images?: string[] }>>([]);
  const [loading, setLoading] = useState(!previewOnly);
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
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [minQuantity, setMinQuantity] = useState('');
  const [collections, setCollections] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [hasEnd, setHasEnd] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const loadDiscounts = useCallback(async () => {
    if (previewOnly) {
      const read = () => setDiscounts([...getPreviewDiscounts(), ...buildPreviewDemoDiscounts(previewDemo)].map(normalizeDiscount));
      // Render what's in memory now, then again once a saved session has loaded.
      read();
      setProducts([]);
      setLoadError(false);
      setLoading(false);
      await whenPreviewSellerFreshStoreReady();
      read();
      return;
    }
    setLoading(true);
    try {
      const [data, prods, cols] = await Promise.all([
        api.discountCodes.list(),
        api.products.list().catch(() => []),
        api.discountCodes.collections().catch(() => []),
      ]);
      setCollections(Array.isArray(cols) ? cols : []);
      setDiscounts(Array.isArray(data) ? data.map(normalizeDiscount) : []);
      setProducts(Array.isArray(prods) ? prods : Array.isArray((prods as any)?.products) ? (prods as any).products : []);
      setLoadError(false);
    } catch {
      setDiscounts([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [api, previewOnly, previewDemo]);

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
    setFirstOrderOnly(false);
    setMinQuantity('');
    setSelectedCollectionIds([]);
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
    setFirstOrderOnly(d.firstOrderOnly);
    setMinQuantity(d.minQuantity ? String(d.minQuantity) : '');
    setSelectedCollectionIds(d.collectionIds);
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
    : appliesTo === 'collections'
      ? selectedCollectionIds.length > 0
        ? `${selectedCollectionIds.length} collection${selectedCollectionIds.length === 1 ? '' : 's'}`
        : 'Select collections'
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
    if (appliesTo === 'collections' && selectedCollectionIds.length === 0) {
      Alert.alert('Select collections', 'Choose at least one collection this code applies to.');
      return;
    }
    if (minQuantity && (!/^\d+$/.test(minQuantity.trim()) || Number(minQuantity) < 1)) {
      Alert.alert('Invalid minimum items', 'Enter a whole number of 1 or more.');
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
        firstOrderOnly,
        collectionIds: appliesTo === 'collections' ? selectedCollectionIds : [],
        minQuantity: minQuantity.trim() ? Number(minQuantity) : 0,
        startsAt: startDate ? new Date(startDate).toISOString() : null,
        expiresAt: hasEnd && endDate ? new Date(endDate).toISOString() : null,
      };
      if (previewOnly) {
        if (editingId) {
          // Demo codes (&demo=1) live only in screen state, never the persisted store.
          const updated = isPreviewDemoDiscountId(editingId) ? null : updatePreviewDiscount(editingId, payload);
          setDiscounts(prev => prev.map(d => d.id === editingId ? (updated ? normalizeDiscount(updated) : normalizeDiscount({ ...d, ...payload, code: d.code })) : d));
        } else {
          const created: PreviewDiscount = {
            id: 'preview_discount_' + Math.random().toString(36).slice(2, 11),
            code: (payload.code || randomCode()).toUpperCase(),
            type: payload.type,
            value: payload.value,
            minOrderCents: payload.minOrderCents,
            appliesTo: payload.appliesTo,
            productIds: payload.productIds,
            maxUses: payload.maxUses,
            usesCount: 0,
            oneUsePerCustomer: payload.oneUsePerCustomer,
            firstOrderOnly: payload.firstOrderOnly,
            collectionIds: payload.collectionIds,
            minQuantity: payload.minQuantity,
            startsAt: payload.startsAt,
            expiresAt: payload.expiresAt,
            active: true,
            status: 'active',
            createdAt: new Date().toISOString(),
          };
          addPreviewDiscount(created);
          setDiscounts(prev => [normalizeDiscount(created), ...prev]);
        }
      } else if (editingId) {
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
    if (previewOnly) {
      if (!isPreviewDemoDiscountId(d.id)) updatePreviewDiscount(d.id, { active: nextActive, status: nextActive ? 'active' : 'paused' });
      return;
    }
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
          if (previewOnly) {
            if (!isPreviewDemoDiscountId(d.id)) deletePreviewDiscount(d.id);
            return;
          }
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

  const visibleGroups = useMemo(
    () => groupDiscountsByDay(discounts.filter(d => matchesDiscountFilter(d.status, filter) && matchesDiscountSearch(d.code, search))),
    [discounts, filter, search],
  );

  return (
    <View style={s.root}>
      <ScreenHeader
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
              message="Pull to refresh."
              actionLabel="Try again"
              onAction={() => { void loadDiscounts(); }}
              variant="error"
            />
          ) : discounts.length === 0 ? (
            // Shopify's empty Discounts: title, one line, "Create discount".
            <EmptyState
              icon="tag"
              title="Manage discount codes"
              message="Create codes buyers enter at checkout for a percentage off, a fixed amount, free shipping or a free item."
              actionLabel="Create discount"
              onAction={openNewModal}
            />
          ) : (
            <>
              <View style={[s.searchWrap, { backgroundColor: INPUT_BG }]}>
                <Feather name="search" size={16} color={MUTED} />
                <TextInput
                  style={[s.searchInput, TYPE_SCALE.body, WEB_INPUT_RESET]}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search"
                  placeholderTextColor={MUTED}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  accessibilityLabel="Search discount codes"
                />
                {search ? (
                  <TouchableOpacity onPress={() => setSearch('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                    <Feather name="x-circle" size={16} color={MUTED} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={s.filterRow}>
                {DISCOUNT_FILTERS.map(f => (
                  <Chip key={f.id} label={f.label} selected={filter === f.id} onPress={() => setFilter(f.id)} testID={`discounts-filter-${f.id}`} />
                ))}
              </View>
              {visibleGroups.length === 0 ? (
                <EmptyState
                  icon="tag"
                  title={search.trim() ? 'No matching codes' : `No ${DISCOUNT_FILTERS.find(f => f.id === filter)?.label.toLowerCase()} codes`}
                  message={search.trim() ? 'Try a different code.' : 'Codes with this status will show up here.'}
                  compact
                />
              ) : visibleGroups.map(group => (
                <View key={group.label}>
                  <Text style={s.groupLabel}>{group.label}</Text>
                  {group.items.map((d, i) => (
                    <DiscountRow key={d.id} d={d} first={i === 0} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActionFor(d); }} />
                  ))}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Row actions — Shopify's discount "…" menu: edit, copy, deactivate, delete. */}
      <BottomSheet visible={!!actionFor} onClose={() => setActionFor(null)} testID="discount-actions">
        {actionFor && (
          <View style={{ paddingBottom: SP.sm }}>
            <View style={s.sheetHeader}>
              <Text style={[TYPE_SCALE.headline, { color: theme.text, letterSpacing: 1 }]}>{actionFor.code}</Text>
              <Text style={[TYPE_SCALE.footnote, { color: MUTED, marginTop: 2 }]} numberOfLines={2}>{discountSummaryLine(actionFor)}</Text>
            </View>
            <ListRow icon="edit-2" title="Edit" onPress={() => { const d = actionFor; setActionFor(null); openEditModal(d); }} testID="discount-action-edit" />
            <ListRow icon="copy" title="Copy code" onPress={() => { copyCode(actionFor.code); setActionFor(null); }} />
            <ListRow
              icon={actionFor.active ? 'pause-circle' : 'play-circle'}
              title={actionFor.active ? 'Pause' : 'Resume'}
              onPress={() => { const d = actionFor; setActionFor(null); void togglePause(d); }}
            />
            <ListRow icon="trash-2" title="Delete" destructive onPress={() => { const d = actionFor; setActionFor(null); void handleDelete(d); }} />
          </View>
        )}
      </BottomSheet>

      {/* Create / Edit Modal — one page */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowModal(false)}>
        <SafeAreaProvider style={s.modal}>
          <ScreenHeader
            title={editingId ? 'Edit Discount Code' : 'New Discount Code'}
            variant="modal"
            onBack={() => setShowModal(false)}
          />

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: 60 }}>

            {/* Live summary card */}
            <View style={[s.summaryCard, { borderColor: theme.accent + '55' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.summaryCode, { color: theme.accent }]}>{code.trim() || 'YOURCODE'}</Text>
                <Feather name="tag" size={16} color={theme.accent} />
              </View>
              <Text style={s.summaryValue}>{summaryValueLabel}</Text>
              <View style={s.summaryRow}><Feather name="shopping-bag" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryScopeLabel}</Text></View>
              {minQuantity.trim() ? <View style={s.summaryRow}><Feather name="layers" size={12} color={MUTED} /><Text style={s.summaryLine}>Min. {minQuantity.trim()} item{minQuantity.trim() === '1' ? '' : 's'}</Text></View> : null}
              {minOrderCents ? <View style={s.summaryRow}><Feather name="dollar-sign" size={12} color={MUTED} /><Text style={s.summaryLine}>Min. order {formatCents(minOrderCents)}</Text></View> : null}
              <View style={s.summaryRow}><Feather name="hash" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryUsageLabel}{oneUsePerCustomer ? ' · 1 per customer' : ''}{firstOrderOnly ? ' · First order only' : ''}</Text></View>
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
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {((collections.length > 0 || appliesTo === 'collections'
                  ? ['entire_store', 'specific_products', 'collections']
                  : ['entire_store', 'specific_products']) as AppliesTo[]).map(t => (
                  <TouchableOpacity key={t} style={[s.typeBtn, (collections.length > 0 || appliesTo === 'collections') && { flexGrow: 0, width: '48.5%' }, appliesTo === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAppliesTo(t); }}>
                    <Text style={[s.typeBtnText, appliesTo === t && { color: theme.accent }]}>{t === 'entire_store' ? 'Entire store' : t === 'collections' ? 'Collections' : 'Specific products'}</Text>
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

            {appliesTo === 'collections' && (
              <View style={{ gap: 8 }}>
                {collections.map(c => {
                  const selected = selectedCollectionIds.includes(c.id);
                  return (
                    <TouchableOpacity
                      key={c.id}
                      style={[s.productRow, selected && { borderColor: theme.accent, backgroundColor: theme.accent + '15' }]}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setSelectedCollectionIds(prev => selected ? prev.filter(id => id !== c.id) : [...prev, c.id]);
                      }}
                    >
                      <Text style={s.productName} numberOfLines={1}>{c.title}</Text>
                      <Feather name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? theme.accent : MUTED} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

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

            {/* Min quantity */}
            <View>
              <Text style={s.label}>Minimum items <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={minQuantity}
                onChangeText={t => setMinQuantity(t.replace(/[^0-9]/g, ''))}
                placeholder="2"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
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
              <View style={s.switchRow}>
                <Text style={s.switchLabel}>First order only</Text>
                <HapticSwitch value={firstOrderOnly} onValueChange={setFirstOrderOnly} />
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
        </SafeAreaProvider>
      </Modal>

      {/* Product picker sheet */}
      <Modal visible={showProductPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowProductPicker(false)}>
        <SafeAreaProvider style={s.modal}>
          <ScreenHeader
            title="Choose products"
            variant="modal"
            onBack={() => setShowProductPicker(false)}
            actions={[{ icon: 'check', onPress: () => setShowProductPicker(false), accessibilityLabel: 'Done choosing products' }]}
          />
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
        </SafeAreaProvider>
      </Modal>
    </View>
  );
}

function DiscountRow({ d, first, onPress }: { d: DiscountCode; first: boolean; onPress: () => void }) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  // Silver status chip: Active reads white, every other status quiet silver.
  const live = d.status === 'active';
  return (
    <TouchableOpacity
      style={[s.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${d.code}, ${DISCOUNT_STATUS_LABEL[d.status]}`}
      testID="discount-row"
    >
      <View style={s.rowTop}>
        <Text style={s.codeText} numberOfLines={1}>{d.code}</Text>
        <View style={[s.statusChip, { borderColor: live ? theme.text : theme.border }]}>
          <Text style={[TYPE_SCALE.caption, { color: live ? theme.text : theme.muted }]}>{DISCOUNT_STATUS_LABEL[d.status]}</Text>
        </View>
      </View>
      <Text style={s.metaText} numberOfLines={2}>{discountSummaryLine(d)}</Text>
      <Text style={s.metaText} numberOfLines={1}>{discountUsageLine(d)}</Text>
    </TouchableOpacity>
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
  searchWrap: { height: 44, flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: FG },
  filterRow:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: SP.sm, marginBottom: SP.xs },
  groupLabel: { ...TYPE_SCALE.footnote, color: MUTED, marginTop: SP.md, marginBottom: 2 },
  row:      { paddingVertical: 14, gap: 3 },
  rowTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  codeText: { ...TYPE_SCALE.headline, color: FG, letterSpacing: 1, flexShrink: 1 },
  metaText: { ...TYPE_SCALE.footnote, color: MUTED },
  statusChip: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 3 },
  sheetHeader: { paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: SP.sm },

  modal:       { flex: 1, backgroundColor: BG },

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
