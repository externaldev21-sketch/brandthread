import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getIncoming, createIncoming, updateIncomingStatus, receiveIncoming, getInventoryItems, getLocations } from '@/services/inventoryService';
import { IncomingInventory, IncomingStatus, InventoryItem, InventoryLocation } from '@/services/inventoryTypes';
import { goBackOr } from '@/lib/navigation/goBackOr';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return 'Not set';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function incomingStatusVariant(status: IncomingStatus): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'received': return 'success';
    case 'in_transit': return 'info';
    case 'delayed': return 'error';
    case 'planned': return 'neutral';
    case 'ordered': return 'neutral';
    case 'in_production': return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'partially_received': return 'warning';
    case 'cancelled': return 'error';
    default: return 'neutral';
  }
}

function incomingStatusLabel(status: IncomingStatus): string {
  switch (status) {
    case 'planned': return 'Planned';
    case 'ordered': return 'Ordered';
    case 'in_production': return 'In Production';
    case 'ready_to_ship': return 'Ready to Ship';
    case 'in_transit': return 'In Transit';
    case 'partially_received': return 'Partial';
    case 'received': return 'Received';
    case 'delayed': return 'Delayed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function sourceColor(source: IncomingInventory['source'], colors: { accent: string; secondary: string; accentLight: string; warning: string; muted: string }): string {
  switch (source) {
    case 'manufacturer': return colors.accent;
    case 'purchase_order': return colors.secondary;
    case 'manual': return colors.accentLight;
    case 'transfer': return colors.warning;
    default: return colors.muted;
  }
}

function sourceLabel(source: IncomingInventory['source']): string {
  switch (source) {
    case 'manufacturer': return 'Manufacturer';
    case 'purchase_order': return 'Purchase Order';
    case 'manual': return 'Manual';
    case 'transfer': return 'Transfer';
    case 'return_restock': return 'Return Restock';
    case 'third_party': return 'Third Party';
    default: return source;
  }
}

const STATUS_TIMELINE: IncomingStatus[] = [
  'planned', 'ordered', 'in_production', 'ready_to_ship', 'in_transit', 'received',
];

type ScreenMode = 'list' | 'view' | 'new' | 'receive';

type FilterOption = 'all' | IncomingStatus;
const FILTER_OPTS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'planned', label: 'Planned' },
  { key: 'in_production', label: 'In Production' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'partially_received', label: 'Partial' },
  { key: 'received', label: 'Received' },
  { key: 'delayed', label: 'Delayed' },
];

const SOURCE_OPTIONS: { key: IncomingInventory['source']; label: string }[] = [
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'purchase_order', label: 'Purchase Order' },
  { key: 'manual', label: 'Manual' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'third_party', label: 'Third Party' },
];

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function IncomingInventoryScreen() {
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
  const GOLD = theme.accent;
  const GRAD_CARD_GLOW = theme.glowGradient;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Mode
  const [mode, setMode] = useState<ScreenMode>(id ? 'view' : 'list');

  // List state
  const [allIncoming, setAllIncoming] = useState<IncomingInventory[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);

  // View state
  const [selectedRecord, setSelectedRecord] = useState<IncomingInventory | null>(null);
  const [trackingInput, setTrackingInput] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // New state
  const [newSource, setNewSource] = useState<IncomingInventory['source']>('manufacturer');
  const [newItemId, setNewItemId] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newExpectedDate, setNewExpectedDate] = useState('');
  const [newDestId, setNewDestId] = useState('');
  const [newManufacturerName, setNewManufacturerName] = useState('');
  const [newProductionOrderId, setNewProductionOrderId] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [newSubmitting, setNewSubmitting] = useState(false);
  const [newSearch, setNewSearch] = useState('');
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);

  // Receive state
  const [receivedQty, setReceivedQty] = useState('');
  const [damagedQty, setDamagedQty] = useState('');
  const [receiveNotes, setReceiveNotes] = useState('');
  const [receiveSubmitting, setReceiveSubmitting] = useState(false);
  const [receiveResult, setReceiveResult] = useState<{ added: number; damaged: number; missing: number } | null>(null);

  // Load data on focus
  useFocusEffect(useCallback(() => {
    loadData();
  }, []));

  async function loadData() {
    setLoading(true);
    try {
      const [inc, items, locs] = await Promise.all([
        getIncoming(),
        getInventoryItems(),
        getLocations(),
      ]);
      setAllIncoming(inc);
      setInventoryItems(items);
      setLocations(locs);
      if (id) {
        const found = inc.find(r => r.id === id);
        if (found) { setSelectedRecord(found); setMode('view'); }
      }
      if (locs.length > 0 && !newDestId) setNewDestId(locs[0].id);
    } finally {
      setLoading(false);
    }
  }

  async function reloadIncoming() {
    const inc = await getIncoming();
    setAllIncoming(inc);
    if (selectedRecord) {
      const updated = inc.find(r => r.id === selectedRecord.id);
      if (updated) setSelectedRecord(updated);
    }
  }

  // ─── Filtered list ─────────────────────────────────────────────────────────
  const filtered = filterStatus === 'all'
    ? allIncoming
    : allIncoming.filter(r => r.status === filterStatus);

  // ─── New form ──────────────────────────────────────────────────────────────
  const filteredItems = inventoryItems.filter(i =>
    !newSearch || i.productName.toLowerCase().includes(newSearch.toLowerCase()) ||
    i.variantLabel.toLowerCase().includes(newSearch.toLowerCase()) ||
    i.sku.toLowerCase().includes(newSearch.toLowerCase())
  );

  async function handleCreateIncoming() {
    if (!newItemId || !newQty || !newDestId) return;
    setNewSubmitting(true);
    try {
      await createIncoming({
        source: newSource,
        itemId: newItemId,
        quantity: parseInt(newQty, 10),
        expectedDate: newExpectedDate || undefined,
        destinationLocationId: newDestId,
        manufacturerName: newManufacturerName || undefined,
        productionOrderId: newProductionOrderId || undefined,
        notes: newNotes || undefined,
      });
      await reloadIncoming();
      setMode('list');
      setNewItemId(''); setNewQty(''); setNewExpectedDate('');
      setNewManufacturerName(''); setNewProductionOrderId(''); setNewNotes('');
    } finally {
      setNewSubmitting(false);
    }
  }

  // ─── View actions ──────────────────────────────────────────────────────────
  async function handleStatusUpdate(nextStatus: IncomingStatus, tracking?: string) {
    if (!selectedRecord) return;
    setActionLoading(true);
    try {
      const updated = await updateIncomingStatus(selectedRecord.id, nextStatus, tracking);
      if (updated) setSelectedRecord(updated);
      await reloadIncoming();
    } finally {
      setActionLoading(false);
    }
  }

  // ─── Receive ───────────────────────────────────────────────────────────────
  async function handleReceive() {
    if (!selectedRecord) return;
    const rQty = parseInt(receivedQty, 10) || 0;
    const dQty = parseInt(damagedQty, 10) || 0;
    const missing = selectedRecord.quantity - rQty - dQty;
    setReceiveSubmitting(true);
    try {
      await receiveIncoming(selectedRecord.id, rQty, dQty);
      setReceiveResult({ added: rQty, damaged: dQty, missing: Math.max(0, missing) });
      await reloadIncoming();
    } finally {
      setReceiveSubmitting(false);
    }
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading && mode === 'list') {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <ActivityIndicator color={PURPLE} style={{ marginTop: 80 }} />
      </View>
    );
  }

  // ══════════ LIST MODE ══════════
  if (mode === 'list') {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => goBackOr(router)} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Incoming Inventory</Text>
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMode('new'); }}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtnGrad}>
              <Feather name="plus" size={ICON.sm} color={theme.onAccent} />
              <Text style={[s.addBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Add</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterContent}>
          {FILTER_OPTS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.filterChip, filterStatus === f.key && s.filterChipActive]}
              onPress={() => { Haptics.selectionAsync(); setFilterStatus(f.key); }}
            >
              <Text style={[s.filterChipText, filterStatus === f.key && s.filterChipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* List */}
        <FlatList
          data={filtered}
          keyExtractor={r => r.id}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="inbox"
              title="No incoming inventory"
              description="Production and restock shipments will appear here."
              action={{ label: 'Add Incoming', onPress: () => setMode('new'), icon: 'plus' }}
            />
          }
          renderItem={({ item: rec }) => (
            <BrandthreadCard
              style={s.listCard}
              onPress={() => { setSelectedRecord(rec); setMode('view'); }}
            >
              <View style={s.listCardRow}>
                <View style={s.listCardInfo}>
                  <Text style={s.listCardTitle} numberOfLines={1}>
                    {rec.productName} · {rec.variantLabel}
                  </Text>
                  <Text style={s.listCardSub}>Qty: {rec.quantity} units</Text>
                </View>
                <StatusBadge label={incomingStatusLabel(rec.status)} variant={incomingStatusVariant(rec.status)} small />
              </View>
              <View style={s.listCardBadgeRow}>
                <View style={[s.sourceBadge, { borderColor: sourceColor(rec.source, theme) + '55' }]}>
                  <Text style={[s.sourceBadgeText, { color: sourceColor(rec.source, theme) }]}>{sourceLabel(rec.source)}</Text>
                </View>
              </View>
              <View style={s.listCardMeta}>
                <Text style={s.listCardMetaText}>Expected: {formatDate(rec.expectedDate)}</Text>
                <Text style={s.listCardMetaText}>→ {rec.destinationLocationName}</Text>
              </View>
              {rec.manufacturerName && (
                <Text style={s.listCardMfr}>Manufacturer: {rec.manufacturerName}</Text>
              )}
            </BrandthreadCard>
          )}
        />
      </View>
    );
  }

  // ══════════ NEW MODE ══════════
  if (mode === 'new') {
    return (
      <View style={s.root}>
        <Header title="Add Incoming" onBack={() => setMode('list')} />

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Source */}
          <Text style={s.fieldLabel}>Source</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
            {SOURCE_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.chip, newSource === opt.key && s.chipActive]}
                onPress={() => setNewSource(opt.key)}
              >
                <Text style={[s.chipText, newSource === opt.key && s.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Item Search */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Select Product</Text>
          <View style={s.searchBox}>
            <Feather name="search" size={ICON.sm} color={MUTED} />
            <TextInput
              style={s.searchInput}
              value={newSearch}
              onChangeText={setNewSearch}
              placeholder="Search products…"
              placeholderTextColor={SUBTLE}
            />
          </View>
          <View style={s.itemList}>
            {filteredItems.slice(0, 8).map(item => (
              <TouchableOpacity
                key={item.id}
                style={[s.itemRow, newItemId === item.id && s.itemRowActive]}
                onPress={() => setNewItemId(item.id)}
              >
                <View style={s.itemRowCheck}>
                  {newItemId === item.id && <Feather name="check" size={12} color={PURPLE} />}
                </View>
                <View style={s.itemRowInfo}>
                  <Text style={s.itemRowName}>{item.productName}</Text>
                  <Text style={s.itemRowSub}>{item.variantLabel} · {item.sku}</Text>
                </View>
                <Text style={s.itemRowStock}>{item.onHand} on hand</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Quantity */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Quantity</Text>
          <TextInput
            style={s.input}
            value={newQty}
            onChangeText={setNewQty}
            placeholder="0"
            placeholderTextColor={SUBTLE}
            keyboardType="numeric"
          />

          {/* Expected Date */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Expected Date</Text>
          <TextInput
            style={s.input}
            value={newExpectedDate}
            onChangeText={setNewExpectedDate}
            placeholder="e.g. 2025-08-01"
            placeholderTextColor={SUBTLE}
          />

          {/* Destination */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Destination</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
            {locations.map(loc => (
              <TouchableOpacity
                key={loc.id}
                style={[s.chip, newDestId === loc.id && s.chipActive]}
                onPress={() => setNewDestId(loc.id)}
              >
                <Text style={[s.chipText, newDestId === loc.id && s.chipTextActive]}>{loc.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Manufacturer */}
          {newSource === 'manufacturer' && (
            <>
              <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Manufacturer Name</Text>
              <TextInput
                style={s.input}
                value={newManufacturerName}
                onChangeText={setNewManufacturerName}
                placeholder="e.g. Apex Apparel Co."
                placeholderTextColor={SUBTLE}
              />
            </>
          )}

          {/* Production Order */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Production Order ID (optional)</Text>
          <TextInput
            style={s.input}
            value={newProductionOrderId}
            onChangeText={setNewProductionOrderId}
            placeholder="e.g. prod_001"
            placeholderTextColor={SUBTLE}
          />

          {/* Notes */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Notes</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={newNotes}
            onChangeText={setNewNotes}
            placeholder="Optional notes…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
          />

          <PrimaryButton
            label="Add Incoming Record"
            onPress={handleCreateIncoming}
            loading={newSubmitting}
            disabled={!newItemId || !newQty || !newDestId}
            style={{ marginTop: SP.lg }}
            icon="plus"
          />
          <View style={{ height: SP.xxl }} />
        </ScrollView>
      </View>
    );
  }

  // ══════════ RECEIVE MODE ══════════
  if (mode === 'receive' && selectedRecord) {
    const rQty = parseInt(receivedQty, 10) || 0;
    const dQty = parseInt(damagedQty, 10) || 0;
    const missing = Math.max(0, selectedRecord.quantity - rQty - dQty);
    const existingOnHand = inventoryItems.find(i => i.id === selectedRecord.itemId)?.onHand ?? 0;

    if (receiveResult) {
      return (
        <View style={[s.root, { paddingTop: insets.top, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SP.xl }]}>
          <View style={s.successIcon}>
            <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
          </View>
          <Text style={s.successTitle}>Inventory Received</Text>
          <Text style={s.successSub}>+{receiveResult.added} units added to {selectedRecord.destinationLocationName}</Text>
          {receiveResult.damaged > 0 && (
            <Text style={[s.successNote, { color: ORANGE }]}>{receiveResult.damaged} damaged units not added to available stock</Text>
          )}
          {receiveResult.missing > 0 && (
            <Text style={[s.successNote, { color: RED }]}>{receiveResult.missing} units missing — discrepancy recorded</Text>
          )}
          <PrimaryButton
            label="Done"
            onPress={() => {
              setReceiveResult(null);
              setReceivedQty(''); setDamagedQty(''); setReceiveNotes('');
              setMode('view');
            }}
            style={{ marginTop: SP.xl, width: '100%' }}
          />
        </View>
      );
    }

    return (
      <View style={s.root}>
        <Header title="Receive Inventory" onBack={() => setMode('view')} />

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Demo notice */}
          <View style={[s.noticeBanner, { borderColor: theme.secondary }]}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={s.noticeText}>Stock will be added to inventory after confirmation.</Text>
          </View>

          {/* Product info */}
          <BrandthreadCard style={s.sectionCard}>
            <Text style={s.productTitle}>{selectedRecord.productName}</Text>
            <Text style={s.productSub}>{selectedRecord.variantLabel} · {selectedRecord.sku}</Text>
            <Text style={[s.fieldLabel, { marginTop: SP.sm }]}>Expected: {selectedRecord.quantity} units</Text>
          </BrandthreadCard>

          {/* Received Qty */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Received Quantity</Text>
          <TextInput
            style={[s.input, s.inputLarge]}
            value={receivedQty}
            onChangeText={setReceivedQty}
            placeholder="0"
            placeholderTextColor={SUBTLE}
            keyboardType="numeric"
          />

          {/* Damaged Qty */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Damaged Quantity</Text>
          <TextInput
            style={s.input}
            value={damagedQty}
            onChangeText={setDamagedQty}
            placeholder="0"
            placeholderTextColor={SUBTLE}
            keyboardType="numeric"
          />

          {/* Missing (auto) */}
          <View style={[s.missingRow, missing > 0 && s.missingRowRed]}>
            <Text style={s.missingLabel}>Missing (auto-calculated)</Text>
            <Text style={[s.missingValue, missing > 0 && { color: RED }]}>{missing} units</Text>
          </View>

          {/* Notes */}
          <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Notes</Text>
          <TextInput
            style={[s.input, s.inputMulti]}
            value={receiveNotes}
            onChangeText={setReceiveNotes}
            placeholder="Optional notes…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
          />

          {/* Destination */}
          <View style={s.destRow}>
            <Feather name="map-pin" size={ICON.sm} color={MUTED} />
            <Text style={s.destText}>Destination: {selectedRecord.destinationLocationName}</Text>
          </View>

          {/* Preview */}
          <BrandthreadCard style={s.previewCard} elevated>
            <Text style={s.previewTitle}>Preview</Text>
            <View style={s.previewRow}>
              <Text style={s.previewLabel}>On Hand before</Text>
              <Text style={s.previewValue}>{existingOnHand} units</Text>
            </View>
            <View style={s.previewRow}>
              <Text style={s.previewLabel}>On Hand after</Text>
              <Text style={[s.previewValue, { color: SUCCESS }]}>{existingOnHand + rQty} units</Text>
            </View>
            {dQty > 0 && (
              <View style={s.previewRow}>
                <Text style={s.previewLabel}>Damaged</Text>
                <Text style={[s.previewValue, { color: ORANGE }]}>{dQty} units (not added to available)</Text>
              </View>
            )}
            {missing > 0 && (
              <View style={s.previewRow}>
                <Text style={s.previewLabel}>Missing</Text>
                <Text style={[s.previewValue, { color: RED }]}>{missing} units — discrepancy will be recorded</Text>
              </View>
            )}
          </BrandthreadCard>

          <PrimaryButton
            label="Confirm Receipt"
            onPress={handleReceive}
            loading={receiveSubmitting}
            disabled={rQty === 0}
            style={{ marginTop: SP.lg }}
            icon="check"
          />
          <View style={{ height: SP.xxl }} />
        </ScrollView>
      </View>
    );
  }

  // ══════════ VIEW MODE ══════════
  if (!selectedRecord) {
    return (
      <View style={s.root}>
        <Header title="Incoming" onBack={() => setMode('list')} />
        <EmptyState icon="inbox" title="Record not found" description="This incoming record could not be loaded." />
      </View>
    );
  }

  const rec = selectedRecord;
  const currentStepIndex = STATUS_TIMELINE.indexOf(rec.status === 'partially_received' ? 'in_transit' : rec.status as IncomingStatus);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('list')} style={s.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={s.headerTitleRow}>
          <Text style={s.headerTitle} numberOfLines={1}>Incoming #{rec.id.slice(-4).toUpperCase()}</Text>
        </View>
        <StatusBadge label={incomingStatusLabel(rec.status)} variant={incomingStatusVariant(rec.status)} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* 1. Summary */}
        <GradientCard colors={GRAD_CARD_GLOW} style={s.summaryCard}>
          <Text style={s.productTitle}>{rec.productName} · {rec.variantLabel}</Text>
          <Text style={s.productSub}>SKU: {rec.sku}</Text>
          <View style={s.summaryGrid}>
            <View style={s.summaryItem}>
              <Text style={s.summaryNum}>{rec.quantity}</Text>
              <Text style={s.summaryLabel}>Expected</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={[s.summaryNum, { color: SUCCESS }]}>{rec.receivedQuantity}</Text>
              <Text style={s.summaryLabel}>Received</Text>
            </View>
            <View style={s.summaryItem}>
              <Text style={[s.summaryNum, { color: ORANGE }]}>{rec.damagedQuantity}</Text>
              <Text style={s.summaryLabel}>Damaged</Text>
            </View>
          </View>
          <View style={s.summaryMeta}>
            <View style={[s.sourceBadge, { borderColor: sourceColor(rec.source, theme) + '55', marginBottom: SP.xs }]}>
              <Text style={[s.sourceBadgeText, { color: sourceColor(rec.source, theme) }]}>{sourceLabel(rec.source)}</Text>
            </View>
            {rec.manufacturerName && <Text style={s.metaLine}>Manufacturer: {rec.manufacturerName}</Text>}
            {rec.productionOrderId && <Text style={s.metaLine}>Production Order: {rec.productionOrderId}</Text>}
            <Text style={s.metaLine}>Expected: {formatDate(rec.expectedDate)}</Text>
            <Text style={s.metaLine}>Tracking: {rec.trackingNumber ?? 'Not set'}</Text>
            <Text style={s.metaLine}>Destination: {rec.destinationLocationName}</Text>
          </View>
        </GradientCard>

        {/* 2. Status Timeline */}
        <SectionHeader title="Status Timeline" style={{ marginTop: SP.md }} />
        <View style={s.timelineWrap}>
          {STATUS_TIMELINE.map((step, idx) => {
            const isActive = idx === currentStepIndex;
            const isPast = idx < currentStepIndex;
            const isCurrent = idx === currentStepIndex;
            const showPartial = rec.status === 'partially_received' && step === 'in_transit';
            return (
              <View key={step} style={s.timelineRow}>
                <View style={[s.timelineDot, isPast && s.timelineDotPast, isActive && s.timelineDotActive]}>
                  {isPast ? (
                    <Feather name="check" size={10} color={theme.onAccent} />
                  ) : (
                    <View style={[s.timelineDotInner, isCurrent && { backgroundColor: PURPLE }]} />
                  )}
                </View>
                {idx < STATUS_TIMELINE.length - 1 && <View style={[s.timelineLine, isPast && { backgroundColor: PURPLE }]} />}
                <View style={s.timelineInfo}>
                  <Text style={[s.timelineLabel, isActive && { color: PURPLE }]}>{incomingStatusLabel(step)}</Text>
                  {showPartial && (
                    <StatusBadge label="Partially Received" variant="warning" small />
                  )}
                  {rec.status === 'delayed' && isActive && (
                    <StatusBadge label="Delayed" variant="error" small />
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* 3. Actions */}
        <SectionHeader title="Actions" style={{ marginTop: SP.md }} />
        <View style={s.actionsWrap}>
          {rec.status === 'planned' && (
            <PrimaryButton label="Mark Ordered" onPress={() => handleStatusUpdate('ordered')} loading={actionLoading} icon="shopping-cart" />
          )}
          {rec.status === 'ordered' && (
            <PrimaryButton label="Mark In Production" onPress={() => handleStatusUpdate('in_production')} loading={actionLoading} icon="tool" />
          )}
          {rec.status === 'in_production' && (
            <PrimaryButton label="Mark Ready to Ship" onPress={() => handleStatusUpdate('ready_to_ship')} loading={actionLoading} icon="package" />
          )}
          {rec.status === 'ready_to_ship' && (
            <>
              <TextInput
                style={s.input}
                value={trackingInput}
                onChangeText={setTrackingInput}
                placeholder="Tracking number (optional)"
                placeholderTextColor={SUBTLE}
              />
              <PrimaryButton
                label="Mark In Transit"
                onPress={() => handleStatusUpdate('in_transit', trackingInput || undefined)}
                loading={actionLoading}
                icon="truck"
                style={{ marginTop: SP.sm }}
              />
            </>
          )}
          {(rec.status === 'in_transit' || rec.status === 'partially_received') && (
            <PrimaryButton
              label="Receive Inventory"
              onPress={() => { setReceivedQty(''); setDamagedQty(''); setReceiveResult(null); setMode('receive'); }}
              icon="download"
            />
          )}
          {rec.status === 'received' && (
            <View style={s.readonlySummary}>
              <Feather name="check-circle" size={ICON.md} color={SUCCESS} />
              <Text style={s.readonlyText}>Fully received. No further actions needed.</Text>
            </View>
          )}

          {rec.status !== 'received' && rec.status !== 'cancelled' && rec.status !== 'delayed' && (
            <SecondaryButton
              label="Mark Delayed"
              onPress={() => handleStatusUpdate('delayed')}
              icon="alert-triangle"
              accent={ORANGE}
              style={{ marginTop: SP.sm }}
            />
          )}
        </View>

        <View style={{ height: SP.xxl }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  const GOLD = PURPLE;
  const GRAD_CARD_GLOW = (theme as any).glowGradient;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1 },
  scrollContent: { padding: SP.md },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: 56 },
  headerTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3, flex: 1, textAlign: 'center' },
  headerTitleRow: { flex: 1, alignItems: 'center' },
  backBtn: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  addBtn: { borderRadius: RADIUS.sm, overflow: 'hidden' },
  addBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: SP.sm, paddingVertical: 8 },
  addBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: '#fff' },

  // Filters
  filterScroll: { maxHeight: 50 },
  filterContent: { paddingHorizontal: SP.md, gap: SP.sm, paddingVertical: SP.xs },
  filterChip: { paddingHorizontal: 14, height: 34, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, justifyContent: 'center' },
  filterChipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  filterChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  filterChipTextActive: { color: PURPLE, fontFamily: FONT.semibold },

  // List
  listContent: { padding: SP.md, gap: SP.sm },
  listCard: { gap: SP.xs },
  listCardRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.sm },
  listCardInfo: { flex: 1 },
  listCardTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  listCardSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  listCardBadgeRow: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  listCardMeta: { flexDirection: 'row', gap: SP.md, marginTop: SP.xs },
  listCardMetaText: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  listCardMfr: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Source badge
  sourceBadge: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  sourceBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold },

  // Form
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs, letterSpacing: 0.2 },
  input: { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, height: 52, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  inputLarge: { height: 72, fontSize: FS.xl, textAlign: 'center' },
  inputMulti: { height: 90, paddingTop: SP.sm, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row' },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, justifyContent: 'center', marginRight: SP.sm },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive: { color: PURPLE, fontFamily: FONT.semibold },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, height: 48, marginBottom: SP.sm },
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  itemList: { borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginBottom: SP.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER, gap: SP.sm },
  itemRowActive: { backgroundColor: PURPLE_DIM },
  itemRowCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' },
  itemRowInfo: { flex: 1 },
  itemRowName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  itemRowSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  itemRowStock: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },

  // View mode
  summaryCard: { marginBottom: SP.sm },
  productTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 },
  productSub: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  summaryGrid: { flexDirection: 'row', gap: SP.md, marginTop: SP.md },
  summaryItem: { flex: 1, alignItems: 'center', backgroundColor: CARD, borderRadius: RADIUS.sm, padding: SP.sm },
  summaryNum: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  summaryLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
  summaryMeta: { marginTop: SP.md, gap: 4 },
  metaLine: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  // Timeline
  timelineWrap: { paddingHorizontal: SP.md, gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  timelineDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', marginTop: 2, backgroundColor: CARD },
  timelineDotPast: { backgroundColor: PURPLE, borderColor: PURPLE },
  timelineDotActive: { borderColor: PURPLE },
  timelineDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: SUBTLE },
  timelineLine: { position: 'absolute', left: 11, top: 26, width: 2, height: 24, backgroundColor: BORDER },
  timelineInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingBottom: SP.md },
  timelineLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },

  // Actions
  actionsWrap: { paddingHorizontal: SP.md, gap: SP.sm },
  readonlySummary: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, padding: SP.md, backgroundColor: SUCCESS_DIM, borderRadius: RADIUS.md },
  readonlyText: { fontSize: FS.sm, fontFamily: FONT.medium, color: SUCCESS },

  // Receive
  noticeBanner: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md, backgroundColor: theme.secondaryDim },
  noticeText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  sectionCard: { marginBottom: SP.md },
  missingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: SP.md, borderRadius: RADIUS.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, marginTop: SP.sm },
  missingRowRed: { borderColor: RED + '44', backgroundColor: RED_DIM },
  missingLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  missingValue: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  destRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.md },
  destText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  previewCard: { marginTop: SP.md, gap: SP.sm },
  previewTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs },
  previewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  previewValue: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG, flex: 1, textAlign: 'right' },

  // Success
  successIcon: { marginBottom: SP.md },
  successTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, textAlign: 'center' },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', marginTop: SP.sm },
  successNote: { fontSize: FS.sm, fontFamily: FONT.medium, textAlign: 'center', marginTop: SP.xs },
  });
};
