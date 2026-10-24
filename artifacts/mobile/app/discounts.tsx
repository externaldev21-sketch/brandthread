import * as Haptics from 'expo-haptics';
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
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, Modal, ActivityIndicator, Platform } from 'react-native';

import { Icon, Icon as AppIcon } from '@/components/ui/Icon';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { apiErrorMessage } from '@/lib/safety';

import { InlineSlider } from '@/components/InlineSlider';

import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';

import { useFocusEffect } from 'expo-router';

import { haptics, haptic } from '@/lib/haptics';


import * as Clipboard from 'expo-clipboard';
import { showToast } from '@/lib/toast';
import { useApi } from '@/hooks/useApi';

import { isSellerDevPreview } from '@/lib/devPreview';

import { usePreviewDemoMode } from '@/hooks/usePreviewDemoMode';

import { buildPreviewDemoDiscounts, isPreviewDemoDiscountId } from '@/lib/previewDiscounts';

import { DISCOUNT_FILTERS, DISCOUNT_STATUS_LABEL, discountSummaryLine, discountUsageLine, groupDiscountsByDay, matchesDiscountFilter, matchesDiscountSearch, type DiscountFilter } from '@/lib/discountList';

import { BottomSheet, Chip, EmptyState, ListRow } from '@/components/ui';

import { WEB_INPUT_RESET } from '@/lib/inputReset';

import { addPreviewDiscount, deletePreviewDiscount, getPreviewDiscounts, updatePreviewDiscount, whenPreviewSellerFreshStoreReady, type PreviewDiscount } from '@/lib/previewSellerFreshStore';

import { FILL_ELEVATED, FONT, FS, SP, RADIUS, TEXT } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { parseDecimalToCents } from '@/lib/money';

import { formatMoney as formatCents } from '@/lib/format';

import { PrimaryButton, HapticSwitch } from '@/components/BrandthreadUI';

import { displayPriceInput, sanitizePriceInput } from '@/lib/priceInput';

import { KeyboardStickyFooter } from '@/components/KeyboardStickyFooter';

import { ScreenHeader } from '@/components/ScreenHeader';

import { DayPickerSheet } from '@/components/DayPickerSheet';

import { formatDayKey, isoToDayKey, resolveDiscountDates, toDayKey } from '@/lib/discountDates';

import { NativeDateTimeField } from '@/components/ui/NativeDateTimeField';

import { dateToYmd, startOfToday, ymdToDate } from '@/lib/dateTimeField';

import { crispPx } from '@/lib/crispPixel';
import { ActiveDatesFields } from '@/components/discounts/ActiveDatesFields';
import { UsageLimitsFields, usageLimitsFromStored, usageLimitsPayload, usageSummary } from '@/components/discounts/UsageLimitsFields';
import { RedemptionsSheet } from '@/components/discounts/RedemptionsSheet';
import { formatScheduleInstant, scheduleFormFromStored, schedulePayload, scheduleSummary } from '@/lib/scheduleWindow';

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
  maxUsesPerCustomer: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  scheduleTimeZone: string | null;
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
    maxUsesPerCustomer: raw.maxUsesPerCustomer ?? null,
    startsAt: raw.startsAt ?? null,
    expiresAt: raw.expiresAt ?? null,
    scheduleTimeZone: raw.scheduleTimeZone ?? null,
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

/** Splits option buttons into rows of two for the equal-width grids. */
function pairs<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
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
  const [usage, setUsage] = useState(() => usageLimitsFromStored(null));
  const [minQuantity, setMinQuantity] = useState('');
  const [collections, setCollections] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [schedule, setSchedule] = useState(() => scheduleFormFromStored(null, null, null));
  const [redemptionsFor, setRedemptionsFor] = useState<DiscountCode | null>(null);

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
    setUsage(usageLimitsFromStored(null));
    setMinQuantity('');
    setSelectedCollectionIds([]);
    setSchedule(scheduleFormFromStored(null, null, null));
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
    setUsage(usageLimitsFromStored(d));
    setMinQuantity(d.minQuantity ? String(d.minQuantity) : '');
    setSelectedCollectionIds(d.collectionIds);
    setSchedule(scheduleFormFromStored(d.startsAt, d.expiresAt, d.scheduleTimeZone));
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
  const summaryUsageLabel = usageSummary(usage);
  const summaryDatesLabel = scheduleSummary(schedule);

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
    const limits = usageLimitsPayload(usage);
    if ('error' in limits) {
      Alert.alert('Check the usage limits', limits.error);
      return;
    }
    const dates = schedulePayload(schedule);
    if ('error' in dates) {
      Alert.alert('Check the active dates', dates.error);
      return;
    }
    // Start = start of the local start day, end = END of the local end day
    // (inclusive), and end must come after start.

    setSaving(true);
    try {
      const payload: any = {
        code: code.trim() || undefined,
        type: discType,
        value: discType === 'percentage' ? percent : discType === 'fixed' ? parseFloat(fixedValue) : 0,
        minOrderCents: minOrderCents ?? 0,
        appliesTo,
        productIds: appliesTo === 'specific_products' ? selectedProductIds : [],
        ...limits.values,
        collectionIds: appliesTo === 'collections' ? selectedCollectionIds : [],
        minQuantity: minQuantity.trim() ? Number(minQuantity) : 0,
        // Untouched dates send nothing, so editing other fields never shifts a saved start/end.
        ...(dates.values.startsAt !== undefined && { startsAt: dates.values.startsAt }),
        ...(dates.values.endsAt !== undefined && { expiresAt: dates.values.endsAt }),
        ...(dates.values.scheduleTimeZone !== undefined && { scheduleTimeZone: dates.values.scheduleTimeZone }),
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
            maxUsesPerCustomer: payload.maxUsesPerCustomer,
            firstOrderOnly: payload.firstOrderOnly,
            collectionIds: payload.collectionIds,
            minQuantity: payload.minQuantity,
            startsAt: payload.startsAt ?? null,
            expiresAt: payload.expiresAt ?? null,
            scheduleTimeZone: payload.scheduleTimeZone ?? null,
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
      setShowModal(false);
    } catch (err: any) {
      Alert.alert("Couldn't save the code", apiErrorMessage(err, 'Check your connection and try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(d: DiscountCode) {
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
      Alert.alert("Couldn't update the code", 'Check your connection and try again.');
    }
  }

  async function handleDelete(d: DiscountCode) {
    Alert.alert('Delete discount?', `Remove code "${d.code}"?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete code', style: 'destructive',
        onPress: async () => {
          setDiscounts(prev => prev.filter(x => x.id !== d.id));
          if (previewOnly) {
            if (!isPreviewDemoDiscountId(d.id)) deletePreviewDiscount(d.id);
            return;
          }
          try { await api.discountCodes.delete(d.id); }
          catch {
            loadDiscounts();
            Alert.alert("Couldn't delete the code", 'Check your connection and try again.');
          }
        },
      },
    ]);
  }

  function copyCode(codeValue: string) {
    void Clipboard.setStringAsync(codeValue).then(() => showToast('Code copied', codeValue));
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
        <View style={{ padding: SP.md, gap: SP.sm }}>
          {[0, 1, 2].map(i => <SkeletonBlock key={i} width="100%" height={136} radius={RADIUS.md} />)}
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          // Empty/error: centre the shared EmptyState in the visible area like
          // every other list screen, instead of pinning it under the header.
          contentContainerStyle={[{ padding: SP.md, paddingBottom: insets.bottom + 40 }, (loadError || discounts.length === 0) && { flexGrow: 1, justifyContent: 'center' }]}
        >

          {loadError ? (
            <EmptyState
              title="Couldn't load your codes."
              action={{ label: 'Try again', onPress: () => { void loadDiscounts(); } }}
              style={{ marginTop: 96 }}
            />
          ) : discounts.length === 0 ? (
            // Shopify's empty Discounts pattern, as one line + "Create discount".
            <EmptyState
              title="No discount codes yet."
              action={{ label: 'Create discount', onPress: openNewModal }}
              style={{ marginTop: 96 }}
              testID="discounts-empty"
            />
          ) : (
            <>
              <View style={[s.searchWrap, { backgroundColor: FILL_ELEVATED }]}>
                <Icon name="search" size={16} color={MUTED} />
                <TextInput
                  style={[s.searchInput, TEXT.body, WEB_INPUT_RESET]}
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
                    <Icon name="x-circle" size={16} color={MUTED} />
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
                  title={search.trim() ? 'No codes match your search.' : `No ${DISCOUNT_FILTERS.find(f => f.id === filter)?.label.toLowerCase()} codes.`}
                />
              ) : visibleGroups.map(group => (
                <View key={group.label}>
                  <Text style={s.groupLabel}>{group.label}</Text>
                  {group.items.map((d, i) => (
            <DiscountRow key={d.id} d={d} first={i === 0} onPress={() => { haptic('sheet'); setActionFor(d); }} onViewUses={() => setRedemptionsFor(d)} />
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
              <Text style={[TEXT.headline, { color: theme.text }]}>{actionFor.code}</Text>
              <Text style={[TEXT.footnote, { color: MUTED, marginTop: 2 }]} numberOfLines={2}>{discountSummaryLine(actionFor)}</Text>
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
            title={editingId ? 'Edit discount code' : 'New discount code'}
            variant="modal"
            onBack={() => setShowModal(false)}
          />

          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: SP.lg }} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled">

            {/* Live summary card */}
            <View style={[s.summaryCard, { borderColor: theme.accent + '55' }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={[s.summaryCode, { color: theme.accent }]}>{code.trim() || 'YOURCODE'}</Text>
                <Icon name="tag" size={16} color={theme.accent} />
              </View>
              <Text style={s.summaryValue}>{summaryValueLabel}</Text>
              <View style={s.summaryRow}><Icon name="shopping-bag" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryScopeLabel}</Text></View>
              {minQuantity.trim() ? <View style={s.summaryRow}><Icon name="layers" size={12} color={MUTED} /><Text style={s.summaryLine}>Min. {minQuantity.trim()} item{minQuantity.trim() === '1' ? '' : 's'}</Text></View> : null}
              {minOrderCents ? <View style={s.summaryRow}><Icon name="dollar-sign" size={12} color={MUTED} /><Text style={s.summaryLine}>Min. order {formatCents(minOrderCents)}</Text></View> : null}
              <View style={s.summaryRow}><Icon name="hash" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryUsageLabel}</Text></View>
              <View style={s.summaryRow}><Icon name="calendar" size={12} color={MUTED} /><Text style={s.summaryLine}>{summaryDatesLabel}</Text></View>
            </View>

            {/* Code */}
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={s.label}>Code <Text style={{ color: MUTED, fontSize: FS.xs }}>(optional — auto-generated if blank)</Text></Text>
                <TouchableOpacity onPress={() => setCode(randomCode())}>
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
                {pairs([
                  ['percentage', '% Percent off'],
                  ['fixed', '$ Fixed amount'],
                  ['free_shipping', 'Free shipping'],
                  ['free_item', 'Free item'],
                ] as const).map((row, ri) => (
                  <View key={ri} style={s.typeRow}>
                    {row.map(([t, label]) => (
                      <TouchableOpacity key={t} style={[s.typeBtn, discType === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { haptic('select'); setDiscType(t); }}>
                        <Text style={[s.typeBtnText, discType === t && { color: theme.accent }]}>{label}</Text>
                      </TouchableOpacity>
                    ))}
                    {row.length === 1 && <View style={s.typeCellSpacer} />}
                  </View>
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
                  value={displayPriceInput(fixedValue)}
                  onChangeText={t => setFixedValue(sanitizePriceInput(t))}
                  placeholder="10.00"
                  placeholderTextColor={MUTED}
                  keyboardType="decimal-pad"
                />
              </View>
            )}

            {/* Applies to */}
            <View>
              <Text style={s.label}>Applies to</Text>
              <View style={s.typeGrid}>
                {pairs((collections.length > 0 || appliesTo === 'collections'
                  ? ['entire_store', 'specific_products', 'collections']
                  : ['entire_store', 'specific_products']) as AppliesTo[]).map((row, ri) => (
                  <View key={ri} style={s.typeRow}>
                    {row.map(t => (
                      <TouchableOpacity key={t} style={[s.typeBtn, appliesTo === t && { borderColor: theme.accent, backgroundColor: theme.accent + '22' }]} onPress={() => { haptic('select'); setAppliesTo(t); }}>
                        <Text style={[s.typeBtnText, appliesTo === t && { color: theme.accent }]}>{t === 'entire_store' ? 'Entire store' : t === 'collections' ? 'Collections' : 'Specific products'}</Text>
                      </TouchableOpacity>
                    ))}
                    {row.length === 1 && <View style={s.typeCellSpacer} />}
                  </View>
                ))}
              </View>
              {appliesTo === 'specific_products' && (
                <TouchableOpacity style={s.pickerRow} onPress={() => setShowProductPicker(true)}>
                  <Text style={s.pickerRowText}>
                    {selectedProductIds.length === 0 ? 'Choose products…' : `${selectedProductIds.length} product${selectedProductIds.length === 1 ? '' : 's'} selected`}
                  </Text>
                  <Icon name="chevron-right" size={16} color={MUTED} />
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
                        haptic('select');
                        setSelectedCollectionIds(prev => selected ? prev.filter(id => id !== c.id) : [...prev, c.id]);
                      }}
                    >
                      <Text style={s.productName} numberOfLines={1}>{c.title}</Text>
                      <Icon name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? theme.accent : MUTED} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Min order */}
            <View>
              <Text style={s.label}>Minimum order ($) <Text style={s.labelHint}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={displayPriceInput(minOrder)}
                onChangeText={t => setMinOrder(sanitizePriceInput(t))}
                placeholder="50.00"
                placeholderTextColor={MUTED}
                keyboardType="decimal-pad"
              />
            </View>

            {/* Min quantity */}
            <View>
              <Text style={s.label}>Minimum items <Text style={s.labelHint}>(optional)</Text></Text>
              <TextInput
                style={s.input}
                value={minQuantity}
                onChangeText={t => setMinQuantity(t.replace(/[^0-9]/g, ''))}
                placeholder="2"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
              />
            </View>

            <UsageLimitsFields value={usage} onChange={setUsage} />

            <ActiveDatesFields value={schedule} onChange={setSchedule} />

            <PrimaryButton
              label={saving ? 'Saving…' : editingId ? 'Save changes' : 'Create code'}
              onPress={handleSave}
              disabled={saving}
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
                    haptic('select');
                    setSelectedProductIds(prev => selected ? prev.filter(id => id !== p.id) : [...prev, p.id]);
                  }}
                >
                  <Text style={s.productName} numberOfLines={1}>{p.name}</Text>
                  <Icon name={selected ? 'check-circle' : 'circle'} size={18} color={selected ? theme.accent : MUTED} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </SafeAreaProvider>
      </Modal>

      <RedemptionsSheet code={redemptionsFor} onClose={() => setRedemptionsFor(null)} previewOnly={previewOnly} />
    </View>
  );
}

function DiscountRow({ d, first, onPress, onViewUses }: {
  d: DiscountCode;
  first?: boolean;
  onPress: () => void;
  onViewUses: () => void;
}) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  // Status chip on the one #1C1C1E fill: Active reads white, every other status silver.
  const live = d.status === 'active';
  return (
<View>
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
        <View style={s.statusChip}>
          <Text style={[TEXT.caption, { color: live ? theme.text : theme.muted }]}>{DISCOUNT_STATUS_LABEL[d.status]}</Text>
        </View>
      </View>
      <Text style={s.metaText} numberOfLines={2}>{discountSummaryLine(d)}</Text>
      <Text style={s.metaText} numberOfLines={1}>{discountUsageLine(d)}</Text>
    </TouchableOpacity>
<TouchableOpacity onPress={onViewUses} accessibilityLabel={`View redemptions for ${d.code}`}><Text style={s.metaText}>View redemptions · {d.usesCount} uses</Text></TouchableOpacity></View>
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
  groupLabel: { ...TEXT.footnote, color: MUTED, marginTop: SP.md, marginBottom: 2 },
  row:      { paddingVertical: 14, gap: 3 },
  rowTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  codeText: { ...TEXT.headline, color: FG, flexShrink: 1 },
  metaText: { ...TEXT.footnote, color: MUTED },
  statusChip: { backgroundColor: FILL_ELEVATED, borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 3 },
  sheetHeader: { paddingHorizontal: SP.md, paddingTop: SP.xs, paddingBottom: SP.sm },

  modal:       { flex: 1, backgroundColor: BG },

  summaryCard: { backgroundColor: CARD_ELEVATED, borderWidth: crispPx(1.5), borderRadius: RADIUS.md, padding: SP.md, gap: 6 },
  summaryCode: { fontSize: FS.md, fontFamily: FONT.bold },
  summaryValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginTop: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  summaryLine: { flexShrink: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  label:       { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6 },
  labelHint:   { textTransform: 'none' },
  subLabel:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginBottom: 6 },
  linkText:    { fontSize: FS.xs, fontFamily: FONT.semibold },
  input:       { backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  // Rows of two equal cells (flex: 1 each, an empty spacer for an odd last
  // one), so no button grows wider than its neighbour or stretches alone.
  typeGrid:    { gap: 8 },
  typeRow:     { flexDirection: 'row', gap: 8 },
  typeCellSpacer: { flex: 1 },
  typeBtn:     { flex: 1, flexBasis: 0, minWidth: 0, justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  typeBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  pickerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12, marginTop: 8 },
  pickerRowText: { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  productRow:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: CARD_ELEVATED, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 12 },
  productName: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: FG, marginRight: 8 },
  });
};
