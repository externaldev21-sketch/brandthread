/**
 * Brandthread Inventory Detail — Per-variant item detail screen.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { formatCents } from '@/lib/money';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getInventoryItem, getAdjustments, getEvents, getRestockRecommendations, updateThreshold, updateOversellPolicy } from '@/services/inventoryService';
import { InventoryItem, InventoryAdjustment, InventoryEvent, RestockRecommendation, OversellPolicy } from '@/services/inventoryTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(cents: number): string { return formatCents(cents); }

function statusVariant(status: string): 'success' | 'warning' | 'error' | 'info' | 'purple' | 'neutral' {
  switch (status) {
    case 'available':    return 'success';
    case 'low_stock':    return 'warning';
    case 'out_of_stock': return 'error';
    case 'pre_order':    return 'info';
    case 'incoming':     return 'info';
    case 'reserved':     return 'purple';
    case 'damaged':      return 'error';
    default:             return 'neutral';
  }
}

function statusGlowColors(status: string, theme: ReturnType<typeof useAppTheme>['theme']): readonly [string, string] {
  switch (status) {
    case 'available':    return [`${theme.success}26`, `${theme.success}05`] as const;
    case 'low_stock':    return [`${theme.warning}26`, `${theme.warning}05`] as const;
    case 'out_of_stock': return [`${theme.error}26`, `${theme.error}05`] as const;
    case 'pre_order':    return [`${theme.accentLight}26`, `${theme.accentLight}05`] as const;
    default:             return [theme.glowGradient[0], theme.glowGradient[1]] as const;
  }
}

function adjustmentLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function eventTypeLabel(type: string): string {
  switch (type) {
    case 'adjustment':           return 'Adjustment';
    case 'reservation':          return 'Reserved';
    case 'reservation_released': return 'Released';
    case 'fulfillment':          return 'Fulfilled';
    case 'return_restock':       return 'Return Restocked';
    case 'transfer_in':          return 'Transfer In';
    case 'transfer_out':         return 'Transfer Out';
    case 'production_received':  return 'Production Received';
    case 'incoming_received':    return 'Incoming Received';
    case 'count_adjustment':     return 'Count Adjustment';
    case 'oversell':             return 'Oversell';
    case 'pre_order_committed':  return 'Pre-order Committed';
    default:                     return type.replace(/_/g, ' ');
  }
}

function eventTypeColor(type: string, theme: ReturnType<typeof useAppTheme>['theme']): string {
  switch (type) {
    case 'adjustment':           return theme.accent;
    case 'reservation':          return theme.warning;
    case 'reservation_released': return theme.success;
    case 'fulfillment':          return theme.secondary;
    case 'return_restock':       return theme.success;
    case 'transfer_in':          return theme.accentLight;
    case 'transfer_out':         return theme.warning;
    case 'production_received':  return theme.success;
    case 'count_adjustment':     return theme.secondary;
    default:                     return theme.muted;
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function InventoryDetailScreen() {
  const { theme } = useAppTheme();
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
  } = theme;
  const SUCCESS_DIM = `${SUCCESS}26`;
  const BORDER_ACTIVE = theme.accentLight;
  const ORANGE_DIM = `${ORANGE}26`;
  const RED_DIM = `${RED}26`;
  const BLUE = theme.accentLight;
  const BLUE_DIM = `${theme.accentLight}26`;
  const GOLD = theme.accent;
  const GRAD_CARD_GLOW = theme.glowGradient;
  const d = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string }>();
  const itemId = params.id ?? '';

  const [item, setItem] = useState<InventoryItem | null>(null);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [events, setEvents] = useState<InventoryEvent[]>([]);
  const [recommendation, setRecommendation] = useState<RestockRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [thresholdInput, setThresholdInput] = useState('');
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);

  const loadData = useCallback(async () => {
    if (!itemId) return;
    try {
      const [itm, adjs, evts] = await Promise.all([
        getInventoryItem(itemId),
        getAdjustments(itemId),
        getEvents(itemId),
      ]);
      if (itm) {
        setItem(itm);
        setThresholdInput(String(itm.lowStockThreshold));
        const recs = getRestockRecommendations([itm]);
        setRecommendation(recs[0] ?? null);
      }
      setAdjustments(adjs.slice(0, 10));
      setEvents(evts.slice(0, 10));
    } catch {
      setItem(null);
      setAdjustments([]);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const handleSaveThreshold = useCallback(async () => {
    if (!item) return;
    const val = parseInt(thresholdInput, 10);
    if (isNaN(val) || val < 0) {
      Alert.alert('Invalid', 'Enter a valid threshold (0 or more).');
      return;
    }
    setSavingThreshold(true);
    try {
      await updateThreshold(item.id, val);
      await loadData();
    } finally {
      setSavingThreshold(false);
    }
  }, [item, thresholdInput, loadData]);

  const handleSetPolicy = useCallback(async (policy: OversellPolicy) => {
    if (!item) return;
    Haptics.selectionAsync();
    setSavingPolicy(true);
    try {
      await updateOversellPolicy(item.id, policy);
      await loadData();
    } finally {
      setSavingPolicy(false);
    }
  }, [item, loadData]);

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={d.loadingWrap}>
        <ActivityIndicator color={PURPLE} size="large" />
        <Text style={d.loadingText}>Loading item…</Text>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={d.loadingWrap}>
        <EmptyState
          icon="package"
          title="Item not found"
          description="This inventory item could not be loaded."
          action={{ label: 'Go Back', onPress: () => router.back() }}
        />
      </View>
    );
  }

  // ─── Status Card ────────────────────────────────────────────────────────────

  const renderStatusCard = () => (
        <GradientCard colors={statusGlowColors(item.status, theme)} glow style={d.statusCard}>
      <View style={d.statusCardRow}>
        <View style={{ flex: 1 }}>
          <Text style={d.statusProductName}>{item.productName}</Text>
          <Text style={d.statusVariant}>{item.variantLabel}</Text>
          <Text style={d.statusSku}>SKU: {item.sku}</Text>
          {item.barcode ? <Text style={d.statusBarcode}>Barcode: {item.barcode}</Text> : null}
        </View>
        <StatusBadge
          label={item.status.replace(/_/g, ' ').toUpperCase()}
          variant={statusVariant(item.status)}
        />
      </View>
    </GradientCard>
  );

  // ─── Inventory Summary ───────────────────────────────────────────────────────

  const renderSummary = () => {
    const summaryItems = [
      { label: 'On Hand',   value: item.onHand,     color: FG      },
      { label: 'Available', value: item.available,  color: SUCCESS },
      { label: 'Reserved',  value: item.reserved,   color: ORANGE  },
      { label: 'Incoming',  value: item.incoming,   color: CYAN    },
      { label: 'Pre-order', value: item.committed,  color: BLUE    },
      { label: 'Damaged',   value: item.damaged,    color: RED     },
    ];
    return (
      <BrandthreadCard style={d.sectionCard}>
        <Text style={d.sectionTitle}>Inventory Summary</Text>
        <View style={d.summaryGrid}>
          {summaryItems.map(si => (
            <View key={si.label} style={d.summaryCell}>
              <Text style={[d.summaryValue, { color: si.color }]}>{si.value}</Text>
              <Text style={d.summaryLabel}>{si.label}</Text>
            </View>
          ))}
        </View>
        <View style={d.summaryDivider} />
        <View style={d.inventoryValueRow}>
          <Text style={d.inventoryValueLabel}>Inventory Value</Text>
          <Text style={[d.inventoryValueAmount, { color: GOLD }]}>{fmtMoney(item.inventoryValueCents)}</Text>
        </View>
        <Text style={d.inventoryValueNote}>Uses cost price ({formatCents(item.costCents)}/unit), not retail.</Text>
      </BrandthreadCard>
    );
  };

  // ─── Locations ───────────────────────────────────────────────────────────────

  const renderLocations = () => {
    if (!item.levels || item.levels.length === 0) {
      return (
        <BrandthreadCard style={d.sectionCard}>
          <Text style={d.sectionTitle}>Locations</Text>
          <Text style={d.emptyMeta}>No location data available.</Text>
        </BrandthreadCard>
      );
    }
    return (
      <BrandthreadCard style={d.sectionCard}>
        <Text style={d.sectionTitle}>Locations</Text>
        {item.levels.map((level, idx) => (
          <View key={level.locationId} style={[d.levelRow, idx > 0 && d.levelRowBorder]}>
            <Text style={d.levelName}>{level.locationName}</Text>
            <View style={d.levelStats}>
              <Text style={d.levelStat}>On Hand: <Text style={{ color: FG }}>{level.onHand}</Text></Text>
              <Text style={d.levelStat}>Available: <Text style={{ color: SUCCESS }}>{level.available}</Text></Text>
              <Text style={d.levelStat}>Reserved: <Text style={{ color: ORANGE }}>{level.reserved}</Text></Text>
              <Text style={d.levelStat}>Incoming: <Text style={{ color: CYAN }}>{level.incoming}</Text></Text>
            </View>
          </View>
        ))}
      </BrandthreadCard>
    );
  };

  // ─── Settings ────────────────────────────────────────────────────────────────

  const OVERSELL_POLICIES: { key: OversellPolicy; label: string }[] = [
    { key: 'block',                label: 'Block'               },
    { key: 'allow',                label: 'Allow'               },
    { key: 'convert_to_preorder',  label: 'Convert to pre-order' },
  ];

  const renderSettings = () => (
    <BrandthreadCard style={d.sectionCard}>
      <Text style={d.sectionTitle}>Settings</Text>

      {/* Threshold */}
      <View style={d.settingRow}>
        <Text style={d.settingLabel}>Low-stock threshold</Text>
        <View style={d.thresholdRow}>
          <TextInput
            style={d.thresholdInput}
            value={thresholdInput}
            onChangeText={setThresholdInput}
            keyboardType="numeric"
            placeholder="10"
            placeholderTextColor={SUBTLE}
            selectTextOnFocus
          />
          <TouchableOpacity
            style={[d.saveBtn, savingThreshold && d.saveBtnDisabled]}
            onPress={handleSaveThreshold}
            disabled={savingThreshold}
            activeOpacity={0.8}
          >
            {savingThreshold
              ? <ActivityIndicator size="small" color={PURPLE} />
              : <Text style={d.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* Oversell policy */}
      <View style={d.settingRow}>
        <Text style={d.settingLabel}>Oversell policy</Text>
        <View style={d.policyChips}>
          {OVERSELL_POLICIES.map(p => (
            <TouchableOpacity
              key={p.key}
              style={[d.policyChip, item.oversellPolicy === p.key && d.policyChipActive]}
              onPress={() => handleSetPolicy(p.key)}
              disabled={savingPolicy}
              activeOpacity={0.8}
            >
              <Text style={[d.policyChipText, item.oversellPolicy === p.key && d.policyChipTextActive]}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Track inventory */}
      <View style={d.settingRowInline}>
        <Text style={d.settingLabel}>Track inventory</Text>
        <Switch
          value={item.trackInventory}
          onValueChange={() => {}}
          trackColor={{ false: BORDER, true: PURPLE_DIM }}
          thumbColor={item.trackInventory ? PURPLE : SUBTLE}
          disabled
        />
      </View>
      <Text style={d.settingNote}>Tracking enabled</Text>
    </BrandthreadCard>
  );

  // ─── Restock Recommendation ──────────────────────────────────────────────────

  const renderRecommendation = () => {
    if (!recommendation) return null;
    const urgencyVariant =
      recommendation.urgency === 'critical' ? 'error' :
      recommendation.urgency === 'urgent'   ? 'warning' : 'info';
    return (
      <GradientCard
        colors={[theme.secondaryDim, theme.accentDim]}
        style={d.sectionCard}
      >
        <View style={d.recHeader}>
          <Text style={d.sectionTitle}>Restock Recommendation</Text>
          <StatusBadge label={recommendation.urgency.toUpperCase()} variant={urgencyVariant} small />
        </View>
        <Text style={d.recSuggested}>
          Suggested restock:{' '}
          <Text style={{ color: CYAN, fontFamily: FONT.bold }}>{recommendation.suggestedQty} units</Text>
          {' '}(estimate only)
        </Text>
        <Text style={d.recNote}>{recommendation.note}</Text>
        <View style={d.recActions}>
          <SecondaryButton
            label="Request Quote"
            small
            icon="send"
            onPress={() => router.push('/manufacturer-hub' as never)}
            accent={CYAN}
            style={d.recBtn}
          />
          <SecondaryButton
            label="Adjust Stock"
            small
            icon="edit-3"
            onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
            accent={PURPLE}
            style={d.recBtn}
          />
        </View>
      </GradientCard>
    );
  };

  // ─── Adjustment History ──────────────────────────────────────────────────────

  const renderAdjustmentHistory = () => (
    <View style={d.sectionBlock}>
      <SectionHeader title="Adjustment History" />
      {adjustments.length === 0 ? (
        <Text style={d.emptyMeta}>No adjustments recorded.</Text>
      ) : (
        adjustments.map(adj => {
          const isPositive = adj.quantityChange >= 0;
          const changeColor = isPositive ? SUCCESS : RED;
          const changeStr = (isPositive ? '+' : '') + adj.quantityChange;
          return (
            <View key={adj.id} style={d.adjRow}>
              <View style={[d.adjDot, { backgroundColor: isPositive ? SUCCESS : RED }]} />
              <View style={d.adjBody}>
                <View style={d.adjTopRow}>
                  <Text style={d.adjType}>{adjustmentLabel(adj.type)}</Text>
                  <Text style={[d.adjChange, { color: changeColor }]}>{changeStr}</Text>
                </View>
                <Text style={d.adjReason}>{adj.reason}</Text>
                <Text style={d.adjMeta}>{adj.locationName} · {fmtDate(adj.createdAt)}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );

  // ─── Recent Events ───────────────────────────────────────────────────────────

  const renderRecentEvents = () => (
    <View style={d.sectionBlock}>
      <SectionHeader title="Recent Events" />
      {events.length === 0 ? (
        <Text style={d.emptyMeta}>No events recorded.</Text>
      ) : (
        events.map(evt => {
          const dotColor = eventTypeColor(evt.type, theme);
          const qChange = evt.quantityChanged;
          const changeColor = qChange >= 0 ? SUCCESS : RED;
          const changeStr = (qChange >= 0 ? '+' : '') + qChange;
          return (
            <View key={evt.id} style={d.eventRow}>
              <View style={[d.eventDot, { backgroundColor: dotColor }]} />
              <View style={d.eventBody}>
                <View style={d.eventTopRow}>
                  <Text style={d.eventType}>{eventTypeLabel(evt.type)}</Text>
                  <Text style={[d.eventChange, { color: changeColor }]}>{changeStr}</Text>
                </View>
                <Text style={d.eventBeforeAfter}>{evt.quantityBefore} → {evt.quantityAfter}</Text>
                <Text style={d.eventMeta}>{evt.reason} · {evt.source}</Text>
                <Text style={d.eventDate}>{fmtDate(evt.createdAt)}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );

  // ─── Actions Row ─────────────────────────────────────────────────────────────

  const renderActionsRow = () => (
    <View style={[d.actionsRow, { paddingBottom: insets.bottom + SP.md }]}>
      <PrimaryButton
        label="Adjust Stock"
        onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
        icon="edit-3"
        small
        style={d.actionBtn}
      />
      <SecondaryButton
        label="Transfer"
        onPress={() => router.push('/inventory-transfer' as never)}
        icon="shuffle"
        small
        style={d.actionBtn}
        accent={CYAN}
      />
      <SecondaryButton
        label="Orders"
        onPress={() => router.push(('/(tabs)/orders?productId=' + (item?.productId ?? item?.id ?? '')) as never)}
        icon="shopping-bag"
        small
        style={d.actionBtn}
        accent={BLUE}
      />
    </View>
  );

  // ─── Main render ─────────────────────────────────────────────────────────────

  return (
    <View style={[d.root, { backgroundColor: 'transparent' }]}>
      {/* Header */}
      <View style={[d.header, { paddingTop: insets.top + SP.xs }]}>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={d.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={d.headerTitles}>
          <Text style={d.headerTitle} numberOfLines={1}>{item.productName}</Text>
          <Text style={d.headerSubtitle} numberOfLines={1}>{item.variantLabel}</Text>
        </View>
        <IconButton
          name="edit-3"
          onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
          color={PURPLE_LIGHT}
        />
      </View>

      {/* Body */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={d.scrollContent}
      >
        {renderStatusCard()}
        {renderSummary()}
        {renderLocations()}
        {renderSettings()}
        {renderRecommendation()}
        {renderAdjustmentHistory()}
        {renderRecentEvents()}
        <View style={{ height: SP.xl + 80 }} />
      </ScrollView>

      {/* Bottom actions */}
      {renderActionsRow()}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const {
    background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE,
    accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM,
    secondary: CYAN, secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
  } = theme as typeof theme & Record<string, string>;
  const SUCCESS_DIM = `${SUCCESS}26`;
  const BORDER_ACTIVE = (theme as any).accentLight;
  const ORANGE_DIM = `${ORANGE}26`;
  const RED_DIM = `${RED}26`;
  const BLUE = PURPLE_LIGHT;
  const BLUE_DIM = `${PURPLE_LIGHT}26`;
  const GOLD = PURPLE;
  const GRAD_CARD_GLOW = (theme as any).glowGradient;
  return StyleSheet.create({
  root:             { flex: 1 },
  loadingWrap:      { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: SP.md },
  loadingText:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', gap: SP.sm,
                      paddingHorizontal: SP.md, paddingBottom: SP.sm,
                      backgroundColor: BG, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:          { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
                      borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitles:     { flex: 1 },
  headerTitle:      { fontSize: FS.md, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  headerSubtitle:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  scrollContent:    { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.md },

  // Status card
  statusCard:       { marginBottom: 0 },
  statusCardRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  statusProductName:{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  statusVariant:    { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, marginTop: 3 },
  statusSku:        { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },
  statusBarcode:    { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 1 },

  // Section cards
  sectionCard:      { gap: SP.sm },
  sectionTitle:     { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },

  // Summary grid
  summaryGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  summaryCell:      { width: '30%', alignItems: 'center', paddingVertical: SP.sm,
                      backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER },
  summaryValue:     { fontSize: FS.xl, fontFamily: FONT.bold, letterSpacing: -0.5 },
  summaryLabel:     { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE, marginTop: 2 },
  summaryDivider:   { height: 1, backgroundColor: BORDER, marginVertical: SP.xs },
  inventoryValueRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inventoryValueLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  inventoryValueAmount:{ fontSize: FS.lg, fontFamily: FONT.bold },
  inventoryValueNote:  { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Locations
  levelRow:         { paddingVertical: SP.sm },
  levelRowBorder:   { borderTopWidth: 1, borderTopColor: BORDER },
  levelName:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: SP.xs },
  levelStats:       { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  levelStat:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },

  // Settings
  settingRow:       { gap: SP.sm, marginBottom: SP.sm },
  settingRowInline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingLabel:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  settingNote:      { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: -SP.xs },
  thresholdRow:     { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  thresholdInput:   { flex: 1, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1,
                      borderColor: BORDER, paddingHorizontal: SP.md, height: 42,
                      fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  saveBtn:          { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, borderWidth: 1,
                      borderColor: BORDER_ACTIVE, paddingHorizontal: SP.md, height: 42,
                      alignItems: 'center', justifyContent: 'center', minWidth: 64 },
  saveBtnDisabled:  { opacity: 0.5 },
  saveBtnText:      { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  policyChips:      { flexDirection: 'row', gap: SP.xs, flexWrap: 'wrap' },
  policyChip:       { paddingHorizontal: SP.md, paddingVertical: SP.xs + 2, borderRadius: RADIUS.pill,
                      backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  policyChipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  policyChipText:   { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  policyChipTextActive: { color: PURPLE_LIGHT, fontFamily: FONT.semibold },

  // Recommendation
  recHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
  recSuggested:     { fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  recNote:          { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  recActions:       { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  recBtn:           { flex: 1 },

  // Section blocks
  sectionBlock:     { gap: SP.sm },
  emptyMeta:        { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, paddingHorizontal: SP.sm },

  // Adjustment rows
  adjRow:           { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm,
                      borderBottomWidth: 1, borderBottomColor: BORDER },
  adjDot:           { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  adjBody:          { flex: 1, gap: 2 },
  adjTopRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  adjType:          { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  adjChange:        { fontSize: FS.sm, fontFamily: FONT.bold },
  adjReason:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  adjMeta:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Event rows
  eventRow:         { flexDirection: 'row', gap: SP.sm, paddingVertical: SP.sm,
                      borderBottomWidth: 1, borderBottomColor: BORDER },
  eventDot:         { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  eventBody:        { flex: 1, gap: 2 },
  eventTopRow:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventType:        { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  eventChange:      { fontSize: FS.sm, fontFamily: FONT.bold },
  eventBeforeAfter: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  eventMeta:        { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  eventDate:        { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Bottom actions
  actionsRow:       { flexDirection: 'row', gap: SP.sm, padding: SP.md, paddingTop: SP.sm,
                      backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER },
  actionBtn:        { flex: 1 },
  });
};
