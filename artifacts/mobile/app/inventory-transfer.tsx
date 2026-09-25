import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Modal, FlatList, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getLocations, getInventoryItems, getTransfer, getTransfers, createTransfer, shipTransfer, receiveTransfer } from '@/services/inventoryService';
import { InventoryLocation, InventoryItem, InventoryTransfer, TransferStatus } from '@/services/inventoryTypes';
import { SheetRise } from '@/components/motion/SheetRise';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SelectedTransferItem {
  itemId: string;
  qty: string;
}

interface ReceiptEntry {
  received: string;
  damaged: string;
}

type ReceiptState = Record<string, ReceiptEntry>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusVariant(status: TransferStatus): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'received':
    case 'closed':        return 'success';
    case 'in_transit':    return 'info';
    case 'ready':         return 'purple';
    case 'draft':         return 'neutral';
    case 'discrepancy':   return 'error';
    case 'cancelled':     return 'error';
    default:              return 'neutral';
  }
}

function statusLabel(status: TransferStatus): string {
  switch (status) {
    case 'draft':               return 'Draft';
    case 'ready':               return 'Ready';
    case 'in_transit':          return 'In Transit';
    case 'partially_received':  return 'Partial';
    case 'received':            return 'Received';
    case 'cancelled':           return 'Cancelled';
    case 'discrepancy':         return 'Discrepancy';
    case 'closed':              return 'Closed';
  }
}

const TIMELINE_STEPS: TransferStatus[] = ['draft', 'ready', 'in_transit', 'received'];

function timelineIndex(status: TransferStatus): number {
  if (status === 'discrepancy') return 3;
  if (status === 'closed') return 4;
  return TIMELINE_STEPS.indexOf(status);
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function InventoryTransferScreen() {
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
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Shared
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // View mode
  const [transfer, setTransfer] = useState<InventoryTransfer | null>(null);
  const [trackingInput, setTrackingInput] = useState('');
  const [receiptState, setReceiptState] = useState<ReceiptState>({});
  const [submitting, setSubmitting] = useState(false);

  // New mode
  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destLocationId, setDestLocationId] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedTransferItem[]>([]);
  const [transferNotes, setTransferNotes] = useState('');
  const [expectedArrival, setExpectedArrival] = useState('');
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [showItemPicker, setShowItemPicker] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const mode: 'view' | 'new' = id ? 'view' : 'new';

  useEffect(() => {
    init();
  }, [id]);

  async function init() {
    setLoading(true);
    try {
      const [locs, items] = await Promise.all([getLocations(), getInventoryItems()]);
      setLocations(locs);
      setAllItems(items);
      if (id) {
        const t = await getTransfer(id);
        if (t) {
          setTransfer(t);
          // Init receipt state
          const rs: ReceiptState = {};
          t.items.forEach(ti => {
            rs[ti.itemId] = { received: String(ti.quantitySent), damaged: '0' };
          });
          setReceiptState(rs);
        }
      } else {
        const primary = locs.find(l => l.isPrimary) ?? locs[0];
        if (primary) setSourceLocationId(primary.id);
      }
    } finally {
      setLoading(false);
    }
  }

  async function reloadTransfer() {
    if (!id) return;
    const t = await getTransfer(id);
    if (t) setTransfer(t);
  }

  // ── New transfer actions ──────────────────────────────────────────────────

  function addItem(item: InventoryItem) {
    if (selectedItems.find(s => s.itemId === item.id)) return;
    setSelectedItems(prev => [...prev, { itemId: item.id, qty: '1' }]);
    setShowItemPicker(false);
  }

  function removeItem(itemId: string) {
    setSelectedItems(prev => prev.filter(s => s.itemId !== itemId));
  }

  function setItemQty(itemId: string, qty: string) {
    setSelectedItems(prev => prev.map(s => s.itemId === itemId ? { ...s, qty } : s));
  }

  async function handleCreate() {
    if (!sourceLocationId || !destLocationId) {
      Alert.alert('Missing locations', 'Please select source and destination locations.');
      return;
    }
    if (sourceLocationId === destLocationId) {
      Alert.alert('Invalid', 'Source and destination must be different.');
      return;
    }
    if (selectedItems.length === 0) {
      Alert.alert('No items', 'Add at least one item to the transfer.');
      return;
    }
    setCreating(true);
    try {
      const newT = await createTransfer({
        sourceLocationId,
        destinationLocationId: destLocationId,
        items: selectedItems.map(s => ({ itemId: s.itemId, quantity: parseInt(s.qty, 10) || 1 })),
        notes: transferNotes.trim() || undefined,
        expectedArrival: expectedArrival.trim() || undefined,
      });
      setTransfer(newT);
      // Init receipt state for new transfer
      const rs: ReceiptState = {};
      newT.items.forEach(ti => {
        rs[ti.itemId] = { received: String(ti.quantitySent), damaged: '0' };
      });
      setReceiptState(rs);
      router.setParams({ id: newT.id });
    } catch {
      Alert.alert('Error', 'Failed to create transfer.');
    } finally {
      setCreating(false);
    }
  }

  // ── View transfer actions ─────────────────────────────────────────────────

  async function handleShip() {
    if (!transfer) return;
    setSubmitting(true);
    try {
      const updated = await shipTransfer(transfer.id, trackingInput.trim() || undefined);
      if (updated) setTransfer(updated);
    } catch {
      Alert.alert('Error', 'Failed to ship transfer.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReceive() {
    if (!transfer) return;
    setSubmitting(true);
    try {
      const receipts = transfer.items.map(ti => ({
        itemId: ti.itemId,
        received: parseInt(receiptState[ti.itemId]?.received ?? String(ti.quantitySent), 10) || 0,
        damaged: parseInt(receiptState[ti.itemId]?.damaged ?? '0', 10) || 0,
      }));
      const updated = await receiveTransfer(transfer.id, receipts);
      if (updated) setTransfer(updated);
    } catch {
      Alert.alert('Error', 'Failed to record receipt.');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Filtered items for picker ─────────────────────────────────────────────

  const filteredItems = allItems.filter(i => {
    const q = itemSearch.toLowerCase();
    return (
      i.productName.toLowerCase().includes(q) ||
      i.variantLabel.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q)
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // VIEW MODE
  // ─────────────────────────────────────────────────────────────────────────

  if (mode === 'view' && transfer) {
    const stepIdx = timelineIndex(transfer.status);

    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>{transfer.transferNumber}</Text>
            <StatusBadge label={statusLabel(transfer.status)} variant={statusVariant(transfer.status)} />
          </View>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ROUTE CARD */}
          <BrandthreadCard style={styles.routeCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeLocation}>
                <View style={styles.locationIcon}>
                  <Feather name="package" size={ICON.md} color={PURPLE} />
                </View>
                <Text style={styles.routeLocationName} numberOfLines={2}>
                  {transfer.sourceLocationName}
                </Text>
                <Text style={styles.routeLocationLabel}>Source</Text>
              </View>
              <View style={styles.routeArrow}>
                <Feather name="arrow-right" size={ICON.lg} color={MUTED} />
              </View>
              <View style={styles.routeLocation}>
                <View style={[styles.locationIcon, { backgroundColor: SUCCESS_DIM }]}>
                  <Feather name="map-pin" size={ICON.md} color={SUCCESS} />
                </View>
                <Text style={styles.routeLocationName} numberOfLines={2}>
                  {transfer.destinationLocationName}
                </Text>
                <Text style={styles.routeLocationLabel}>Destination</Text>
              </View>
            </View>
          </BrandthreadCard>

          {/* STATUS TIMELINE */}
          <SectionHeader title="Status" style={styles.sectionHeader} />
          <BrandthreadCard style={styles.timelineCard}>
            {TIMELINE_STEPS.map((step, idx) => {
              const isDone = idx < stepIdx;
              const isCurrent = idx === stepIdx || (transfer.status === 'discrepancy' && idx === 3);
              const isFuture = idx > stepIdx;
              return (
                <View key={step} style={styles.timelineRow}>
                  <View style={styles.timelineDotCol}>
                    <View style={[
                      styles.timelineDot,
                      isDone && styles.timelineDotDone,
                      isCurrent && styles.timelineDotCurrent,
                      isFuture && styles.timelineDotFuture,
                    ]}>
                      {isDone
                        ? <Feather name="check" size={10} color="#fff" />
                        : isCurrent
                          ? <View style={styles.timelineDotInner} />
                          : null}
                    </View>
                    {idx < TIMELINE_STEPS.length - 1 && (
                      <View style={[styles.timelineLine, isDone && styles.timelineLineDone]} />
                    )}
                  </View>
                  <Text style={[
                    styles.timelineLabel,
                    isDone && styles.timelineLabelDone,
                    isCurrent && styles.timelineLabelCurrent,
                    isFuture && styles.timelineLabelFuture,
                  ]}>
                    {step === 'draft' ? 'Draft'
                      : step === 'ready' ? 'Ready'
                      : step === 'in_transit' ? 'In Transit'
                      : transfer.status === 'discrepancy' ? 'Discrepancy'
                      : 'Received'}
                  </Text>
                </View>
              );
            })}
          </BrandthreadCard>

          {/* ITEMS */}
          <SectionHeader title="Items" style={styles.sectionHeader} />
          {transfer.items.map(ti => (
            <BrandthreadCard
              key={ti.itemId}
              style={[
                styles.transferItemCard,
                transfer.status === 'discrepancy' && ti.quantityMissing > 0 && styles.discrepancyItemCard,
              ]}
            >
              <Text style={styles.tiName}>{ti.productName}</Text>
              <Text style={styles.tiVariant}>{ti.variantLabel} · {ti.sku}</Text>
              <View style={styles.tiQtyRow}>
                <View style={styles.tiQtyCol}>
                  <Text style={styles.tiQtyLabel}>Sent</Text>
                  <Text style={styles.tiQtyValue}>{ti.quantitySent}</Text>
                </View>
                <View style={styles.tiQtyCol}>
                  <Text style={styles.tiQtyLabel}>Received</Text>
                  <Text style={[styles.tiQtyValue, ti.quantityReceived > 0 && { color: SUCCESS }]}>
                    {ti.quantityReceived}
                  </Text>
                </View>
                <View style={styles.tiQtyCol}>
                  <Text style={styles.tiQtyLabel}>Damaged</Text>
                  <Text style={[styles.tiQtyValue, ti.quantityDamaged > 0 && { color: RED }]}>
                    {ti.quantityDamaged}
                  </Text>
                </View>
                <View style={styles.tiQtyCol}>
                  <Text style={styles.tiQtyLabel}>Missing</Text>
                  <Text style={[styles.tiQtyValue, ti.quantityMissing > 0 && { color: ORANGE }]}>
                    {ti.quantityMissing}
                  </Text>
                </View>
              </View>
            </BrandthreadCard>
          ))}

          {/* LOGISTICS CARD */}
          <SectionHeader title="Logistics" style={styles.sectionHeader} />
          <BrandthreadCard style={styles.logisticsCard}>
            {[
              { label: 'Tracking', value: transfer.trackingNumber ?? 'Not set' },
              { label: 'Expected Arrival', value: transfer.expectedArrival ? new Date(transfer.expectedArrival).toLocaleDateString() : 'Not set' },
              { label: 'Shipped', value: transfer.shippedAt ? new Date(transfer.shippedAt).toLocaleDateString() : 'Not set' },
              { label: 'Received', value: transfer.receivedAt ? new Date(transfer.receivedAt).toLocaleDateString() : 'Not set' },
              { label: 'Notes', value: transfer.notes ?? 'None' },
            ].map(row => (
              <View key={row.label} style={styles.logisticsRow}>
                <Text style={styles.logisticsLabel}>{row.label}</Text>
                <Text style={styles.logisticsValue}>{row.value}</Text>
              </View>
            ))}
          </BrandthreadCard>

          {/* ACTIONS BY STATUS */}
          <SectionHeader title="Actions" style={styles.sectionHeader} />

          {transfer.status === 'draft' && (
            <View style={styles.actionsWrap}>
              <Text style={styles.actionLabel}>Marking transfers ready isn't available yet.</Text>
            </View>
          )}

          {transfer.status === 'ready' && (
            <BrandthreadCard style={styles.actionsCard}>
              <Text style={styles.actionLabel}>Tracking Number (optional)</Text>
              <TextInput
                style={styles.singleInput}
                value={trackingInput}
                onChangeText={setTrackingInput}
                placeholder="Enter tracking number…"
                placeholderTextColor={SUBTLE}
              />
              <PrimaryButton
                label="Ship Transfer"
                onPress={handleShip}
                loading={submitting}
                icon="send"
                style={{ marginTop: SP.md }}
              />
            </BrandthreadCard>
          )}

          {transfer.status === 'in_transit' && (
            <BrandthreadCard style={styles.actionsCard}>
              <Text style={styles.actionLabel}>Receive Items</Text>
              {transfer.items.map(ti => (
                <View key={ti.itemId} style={styles.receiptRow}>
                  <View style={styles.receiptItemInfo}>
                    <Text style={styles.receiptItemName}>{ti.productName}</Text>
                    <Text style={styles.receiptItemVariant}>{ti.variantLabel}</Text>
                    <Text style={styles.receiptItemSent}>Sent: {ti.quantitySent}</Text>
                  </View>
                  <View style={styles.receiptInputs}>
                    <View style={styles.receiptInputGroup}>
                      <Text style={styles.receiptInputLabel}>Received</Text>
                      <TextInput
                        style={styles.receiptInput}
                        value={receiptState[ti.itemId]?.received ?? String(ti.quantitySent)}
                        onChangeText={v => setReceiptState(prev => ({
                          ...prev,
                          [ti.itemId]: { ...prev[ti.itemId], received: v },
                        }))}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={styles.receiptInputGroup}>
                      <Text style={styles.receiptInputLabel}>Damaged</Text>
                      <TextInput
                        style={styles.receiptInput}
                        value={receiptState[ti.itemId]?.damaged ?? '0'}
                        onChangeText={v => setReceiptState(prev => ({
                          ...prev,
                          [ti.itemId]: { ...prev[ti.itemId], damaged: v },
                        }))}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>
                </View>
              ))}
              <PrimaryButton
                label="Confirm Receipt"
                onPress={handleReceive}
                loading={submitting}
                icon="check"
                style={{ marginTop: SP.md }}
              />
            </BrandthreadCard>
          )}

          {transfer.status === 'discrepancy' && (
            <>
              <BrandthreadCard style={[styles.actionsCard, styles.discrepancyCard]}>
                <View style={styles.discrepancyHeader}>
                  <Feather name="alert-triangle" size={ICON.md} color={RED} />
                  <Text style={styles.discrepancyTitle}>Discrepancy Detected</Text>
                </View>
                {transfer.items.filter(ti => ti.quantityMissing > 0).map(ti => (
                  <View key={ti.itemId} style={styles.discrepancyItem}>
                    <Text style={styles.discrepancyItemName}>{ti.productName} · {ti.variantLabel}</Text>
                    <Text style={styles.discrepancyItemDetail}>
                      Sent {ti.quantitySent}, Received {ti.quantityReceived}, Missing {ti.quantityMissing}
                    </Text>
                  </View>
                ))}
              </BrandthreadCard>
            </>
          )}

          {(transfer.status === 'received' || transfer.status === 'closed') && (
            <BrandthreadCard style={[styles.actionsCard, styles.completedCard]}>
              <Feather name="check-circle" size={ICON.lg} color={SUCCESS} />
              <Text style={styles.completedText}>
                {transfer.status === 'received' ? 'Transfer received successfully' : 'Transfer closed'}
              </Text>
              {transfer.receivedAt && (
                <Text style={styles.completedDate}>
                  {new Date(transfer.receivedAt).toLocaleDateString()}
                </Text>
              )}
            </BrandthreadCard>
          )}
        </ScrollView>
      </View>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEW MODE
  // ─────────────────────────────────────────────────────────────────────────

  const totalUnits = selectedItems.reduce((s, si) => s + (parseInt(si.qty, 10) || 0), 0);
  const sourceLocation = locations.find(l => l.id === sourceLocationId);
  const destLocation = locations.find(l => l.id === destLocationId);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header title="New Transfer" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* LOCATIONS */}
        <SectionHeader title="Locations" style={styles.sectionHeader} />
        <BrandthreadCard style={styles.locationPickerCard}>
          <View style={styles.locationPickerRow}>
            <View style={styles.locationPickerCol}>
              <Text style={styles.locationPickerLabel}>Source</Text>
              <TouchableOpacity
                style={styles.locationPickerBtn}
                onPress={() => setShowSourcePicker(true)}
              >
                <Text style={[styles.locationPickerBtnText, !sourceLocation && { color: SUBTLE }]}>
                  {sourceLocation ? sourceLocation.name : 'Select…'}
                </Text>
                <Feather name="chevron-down" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
            </View>
            <Feather name="arrow-right" size={ICON.md} color={MUTED} style={styles.locationArrow} />
            <View style={styles.locationPickerCol}>
              <Text style={styles.locationPickerLabel}>Destination</Text>
              <TouchableOpacity
                style={styles.locationPickerBtn}
                onPress={() => setShowDestPicker(true)}
              >
                <Text style={[styles.locationPickerBtnText, !destLocation && { color: SUBTLE }]}>
                  {destLocation ? destLocation.name : 'Select…'}
                </Text>
                <Feather name="chevron-down" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
            </View>
          </View>
          {sourceLocationId && destLocationId && sourceLocationId === destLocationId && (
            <Text style={styles.sameLocWarning}>Source and destination must be different</Text>
          )}
        </BrandthreadCard>

        {/* ITEMS */}
        <SectionHeader
          title="Items"
          action={{ label: '+ Add Item', onPress: () => setShowItemPicker(true) }}
          style={styles.sectionHeader}
        />
        {selectedItems.length === 0 ? (
          <View style={styles.emptyItems}>
            <Text style={styles.emptyItemsText}>No items added yet</Text>
          </View>
        ) : (
          selectedItems.map(si => {
            const invItem = allItems.find(i => i.id === si.itemId);
            if (!invItem) return null;
            const qtyNum = parseInt(si.qty, 10) || 0;
            const overLimit = qtyNum > invItem.available;
            return (
              <BrandthreadCard key={si.itemId} style={styles.newItemCard}>
                <View style={styles.newItemRow}>
                  <View style={styles.newItemInfo}>
                    <Text style={styles.newItemName}>{invItem.productName}</Text>
                    <Text style={styles.newItemVariant}>{invItem.variantLabel}</Text>
                    <Text style={styles.newItemAvail}>
                      Available: {invItem.available}
                      {overLimit && <Text style={{ color: RED }}> (exceeds available)</Text>}
                    </Text>
                  </View>
                  <View style={styles.newItemQtyWrap}>
                    <TextInput
                      style={[styles.newItemQtyInput, overLimit && styles.newItemQtyInputError]}
                      value={si.qty}
                      onChangeText={v => setItemQty(si.itemId, v)}
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                    <TouchableOpacity onPress={() => removeItem(si.itemId)} style={styles.removeBtn}>
                      <Feather name="x" size={ICON.sm} color={RED} />
                    </TouchableOpacity>
                  </View>
                </View>
              </BrandthreadCard>
            );
          })
        )}

        {/* EXPECTED ARRIVAL */}
        <SectionHeader title="Expected Arrival" style={styles.sectionHeader} />
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.singleInput}
            value={expectedArrival}
            onChangeText={setExpectedArrival}
            placeholder="e.g. Jul 21, 2026"
            placeholderTextColor={SUBTLE}
          />
        </View>

        {/* NOTES */}
        <SectionHeader title="Notes (optional)" style={styles.sectionHeader} />
        <View style={styles.inputWrap}>
          <TextInput
            style={styles.textArea}
            value={transferNotes}
            onChangeText={setTransferNotes}
            placeholder="Any notes about this transfer…"
            placeholderTextColor={SUBTLE}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* PREVIEW */}
        {selectedItems.length > 0 && (
          <>
            <SectionHeader title="Preview" style={styles.sectionHeader} />
            <BrandthreadCard style={[styles.previewCard, { borderColor: BORDER_ACTIVE }]}>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Total items</Text>
                <Text style={styles.previewValue}>{selectedItems.length} SKU{selectedItems.length !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.previewRow}>
                <Text style={styles.previewLabel}>Total units</Text>
                <Text style={styles.previewValue}>{totalUnits}</Text>
              </View>
              {sourceLocation && (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>From</Text>
                  <Text style={styles.previewValue}>{sourceLocation.name}</Text>
                </View>
              )}
              {destLocation && (
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>To</Text>
                  <Text style={styles.previewValue}>{destLocation.name}</Text>
                </View>
              )}
            </BrandthreadCard>
          </>
        )}

        {/* CREATE BUTTON */}
        <View style={styles.submitWrap}>
          <PrimaryButton
            label="Create Transfer"
            onPress={handleCreate}
            loading={creating}
            disabled={
              !sourceLocationId ||
              !destLocationId ||
              sourceLocationId === destLocationId ||
              selectedItems.length === 0
            }
            icon="send"
          />
        </View>
      </ScrollView>

      {/* SOURCE LOCATION PICKER MODAL */}
      <Modal visible={showSourcePicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <SheetRise style={styles.modalSheet}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Select Source</Text>
              <TouchableOpacity onPress={() => setShowSourcePicker(false)}>
                <Feather name="x" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={locations}
              keyExtractor={l => l.id}
              renderItem={({ item: loc }) => (
                <TouchableOpacity
                  style={[styles.locPickerRow, sourceLocationId === loc.id && styles.locPickerRowActive]}
                  onPress={() => { setSourceLocationId(loc.id); setShowSourcePicker(false); }}
                >
                  <Text style={[styles.locPickerName, sourceLocationId === loc.id && { color: PURPLE }]}>
                    {loc.name}
                  </Text>
                  {loc.isPrimary && <StatusBadge label="Primary" variant="purple" small />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </SheetRise>
        </View>
      </Modal>

      {/* DEST LOCATION PICKER MODAL */}
      <Modal visible={showDestPicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <SheetRise style={styles.modalSheet}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Select Destination</Text>
              <TouchableOpacity onPress={() => setShowDestPicker(false)}>
                <Feather name="x" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            </View>
            <FlatList
              data={locations}
              keyExtractor={l => l.id}
              renderItem={({ item: loc }) => (
                <TouchableOpacity
                  style={[styles.locPickerRow, destLocationId === loc.id && styles.locPickerRowActive]}
                  onPress={() => { setDestLocationId(loc.id); setShowDestPicker(false); }}
                >
                  <Text style={[styles.locPickerName, destLocationId === loc.id && { color: PURPLE }]}>
                    {loc.name}
                  </Text>
                  {loc.isPrimary && <StatusBadge label="Primary" variant="purple" small />}
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </SheetRise>
        </View>
      </Modal>

      {/* ITEM PICKER MODAL */}
      <Modal visible={showItemPicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <SheetRise style={styles.modalSheet}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Add Item</Text>
              <TouchableOpacity onPress={() => setShowItemPicker(false)}>
                <Feather name="x" size={ICON.md} color={MUTED} />
              </TouchableOpacity>
            </View>
            <View style={styles.searchRow}>
              <Feather name="search" size={ICON.sm} color={MUTED} />
              <TextInput
                style={styles.searchInput}
                value={itemSearch}
                onChangeText={setItemSearch}
                placeholder="Search items…"
                placeholderTextColor={SUBTLE}
              />
              {itemSearch.length > 0 && (
                <TouchableOpacity onPress={() => setItemSearch('')}>
                  <Feather name="x" size={ICON.sm} color={MUTED} />
                </TouchableOpacity>
              )}
            </View>
            <FlatList
              data={filteredItems}
              keyExtractor={i => i.id}
              style={{ maxHeight: 360 }}
              renderItem={({ item }) => {
                const alreadyAdded = selectedItems.some(s => s.itemId === item.id);
                return (
                  <TouchableOpacity
                    style={[styles.itemRow, alreadyAdded && styles.itemRowDisabled]}
                    onPress={() => { if (!alreadyAdded) addItem(item); }}
                    disabled={alreadyAdded}
                  >
                    <View style={styles.itemRowInfo}>
                      <Text style={styles.itemRowName}>{item.productName}</Text>
                      <Text style={styles.itemRowVariant}>{item.variantLabel} · {item.sku}</Text>
                    </View>
                    <View style={styles.itemRowRight}>
                      <Text style={styles.itemRowQty}>{item.available}</Text>
                      <Text style={styles.itemRowQtyLabel}>available</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </SheetRise>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1, justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: SP.md },
  sectionHeader: { marginTop: SP.md, marginBottom: SP.sm },

  // Route card (view)
  routeCard: { marginHorizontal: SP.md },
  routeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  routeLocation: { flex: 1, alignItems: 'center', gap: SP.sm },
  routeArrow: { paddingHorizontal: SP.sm },
  locationIcon: {
    width: 48, height: 48, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center',
  },
  routeLocationName: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, textAlign: 'center' },
  routeLocationLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Timeline
  timelineCard: { marginHorizontal: SP.md, gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md, minHeight: 44 },
  timelineDotCol: { alignItems: 'center', width: 20 },
  timelineDot: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: CARD, borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  timelineDotDone: { backgroundColor: SUCCESS, borderColor: SUCCESS },
  timelineDotCurrent: { backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  timelineDotFuture: { backgroundColor: CARD, borderColor: BORDER },
  timelineDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: PURPLE },
  timelineLine: { width: 2, flex: 1, backgroundColor: BORDER, minHeight: 24 },
  timelineLineDone: { backgroundColor: SUCCESS },
  timelineLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: SUBTLE, paddingTop: 2 },
  timelineLabelDone: { color: SUCCESS },
  timelineLabelCurrent: { color: PURPLE, fontFamily: FONT.bold },
  timelineLabelFuture: { color: SUBTLE },

  // Transfer items (view)
  transferItemCard: { marginHorizontal: SP.md, marginBottom: SP.sm },
  discrepancyItemCard: { borderColor: RED },
  tiName: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  tiVariant: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.sm },
  tiQtyRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tiQtyCol: { alignItems: 'center', flex: 1 },
  tiQtyLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  tiQtyValue: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },

  // Logistics
  logisticsCard: { marginHorizontal: SP.md },
  logisticsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  logisticsLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  logisticsValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  // Actions
  actionsWrap: { marginHorizontal: SP.md, marginBottom: SP.md },
  actionsCard: { marginHorizontal: SP.md, gap: SP.sm },
  actionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },

  // Receipt form
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: SP.md,
  },
  receiptItemInfo: { flex: 1 },
  receiptItemName: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },
  receiptItemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  receiptItemSent: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  receiptInputs: { flexDirection: 'row', gap: SP.sm },
  receiptInputGroup: { alignItems: 'center', gap: 4 },
  receiptInputLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  receiptInput: {
    width: 60, height: 40, borderRadius: RADIUS.sm,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    textAlign: 'center', fontSize: FS.base, fontFamily: FONT.bold, color: FG,
  },

  // Discrepancy
  discrepancyCard: { borderColor: RED, borderWidth: 1 },
  discrepancyHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  discrepancyTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: RED },
  discrepancyItem: { paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: RED_DIM },
  discrepancyItemName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  discrepancyItemDetail: { fontSize: FS.xs, fontFamily: FONT.regular, color: RED },

  // Completed
  completedCard: { alignItems: 'center', gap: SP.sm },
  completedText: { fontSize: FS.base, fontFamily: FONT.semibold, color: SUCCESS },
  completedDate: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  // New transfer — locations
  locationPickerCard: { marginHorizontal: SP.md },
  locationPickerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  locationPickerCol: { flex: 1, gap: SP.sm },
  locationPickerLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: SUBTLE, textTransform: 'uppercase' },
  locationPickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, height: 44,
  },
  locationPickerBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, flex: 1 },
  locationArrow: { marginTop: SP.lg },
  sameLocWarning: { fontSize: FS.xs, fontFamily: FONT.regular, color: RED, marginTop: SP.sm },

  // New items
  newItemCard: { marginHorizontal: SP.md, marginBottom: SP.sm },
  newItemRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  newItemInfo: { flex: 1 },
  newItemName: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  newItemVariant: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  newItemAvail: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  newItemQtyWrap: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  newItemQtyInput: {
    width: 64, height: 44, borderRadius: RADIUS.sm,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    textAlign: 'center', fontSize: FS.md, fontFamily: FONT.bold, color: FG,
  },
  newItemQtyInputError: { borderColor: RED },
  removeBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: RED_DIM, alignItems: 'center', justifyContent: 'center',
  },
  emptyItems: {
    marginHorizontal: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    padding: SP.lg, alignItems: 'center',
  },
  emptyItemsText: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE },

  // Inputs
  inputWrap: { marginHorizontal: SP.md, marginBottom: SP.sm },
  textArea: {
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.md,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
    minHeight: 80, textAlignVertical: 'top',
  },
  singleInput: {
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, height: 52,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG,
  },

  // Preview
  previewCard: { marginHorizontal: SP.md, borderWidth: 1 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm },
  previewLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  previewValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },

  // Submit
  submitWrap: { marginHorizontal: SP.md, marginTop: SP.lg },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: SURFACE, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderWidth: 1, borderColor: BORDER, padding: SP.lg, maxHeight: '80%',
  },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  modalTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },

  // Location picker list
  locPickerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: SP.md, paddingHorizontal: SP.sm,
  },
  locPickerRowActive: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm },
  locPickerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },

  // Item picker
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, marginBottom: SP.md, height: 48,
  },
  searchInput: {
    flex: 1, fontSize: FS.base, fontFamily: FONT.regular, color: FG,
  },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SP.md, paddingVertical: SP.md,
  },
  itemRowDisabled: { opacity: 0.4 },
  itemRowInfo: { flex: 1 },
  itemRowName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  itemRowVariant: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  itemRowRight: { alignItems: 'flex-end' },
  itemRowQty: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  itemRowQtyLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  separator: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },
  });
};
