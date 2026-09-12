import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet, Modal, FlatList, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getInventoryItems, getLocations, adjustStock } from '@/services/inventoryService';
import { InventoryItem, InventoryLocation, AdjustmentType, ADJUSTMENT_TYPES } from '@/services/inventoryTypes';

export default function InventoryAdjustScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentDim: PURPLE_DIM, secondary: CYAN } = theme;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const { itemId } = useLocalSearchParams<{ itemId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [adjustType, setAdjustType] = useState<AdjustmentType | null>(null);
  const [quantityChange, setQuantityChange] = useState<string>('0');
  const [reason, setReason] = useState<string>('');
  const [noteText, setNoteText] = useState<string>('');
  const [referenceNumber, setReferenceNumber] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resultAdj, setResultAdj] = useState<any>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemPicker, setShowItemPicker] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [fetchedItems, fetchedLocations] = await Promise.all([
      getInventoryItems(),
      getLocations(),
    ]);
    setItems(fetchedItems);
    setLocations(fetchedLocations);
    if (fetchedLocations.length > 0) {
      const primary = fetchedLocations.find(l => l.isPrimary) ?? fetchedLocations[0];
      setSelectedLocationId(primary.id);
    }
    if (itemId) {
      const found = fetchedItems.find(i => i.id === itemId);
      if (found) setSelectedItem(found);
    }
  }

  const filteredItems = items.filter(i => {
    const q = itemSearch.toLowerCase();
    return (
      i.productName.toLowerCase().includes(q) ||
      i.variantLabel.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q)
    );
  });

  const selectedTypeInfo = ADJUSTMENT_TYPES.find(t => t.key === adjustType);
  const delta = selectedTypeInfo?.delta ?? 0;

  const parsedQty = parseInt(quantityChange, 10) || 0;
  const actualChange = delta === 0 ? parsedQty : delta * Math.abs(parsedQty);
  const newQty = selectedItem ? Math.max(0, selectedItem.onHand + actualChange) : 0;
  const valueImpactCents = selectedItem ? actualChange * selectedItem.costCents : 0;

  const canSubmit =
    selectedItem !== null &&
    adjustType !== null &&
    Math.abs(parsedQty) > 0 &&
    reason.trim().length > 0 &&
    !submitting;

  async function handleConfirm() {
    if (!selectedItem || !adjustType) return;
    setSubmitting(true);
    try {
      const adj = await adjustStock({
        itemId: selectedItem.id,
        locationId: selectedLocationId,
        type: adjustType,
        quantityChange: actualChange,
        reason: reason.trim(),
        note: noteText.trim() || undefined,
        referenceNumber: referenceNumber.trim() || undefined,
      });
      setResultAdj(adj);
      setShowConfirm(false);
    } catch (e) {
      Alert.alert('Error', 'Failed to adjust stock. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setSelectedItem(null);
    setAdjustType(null);
    setQuantityChange('0');
    setReason('');
    setNoteText('');
    setReferenceNumber('');
    setResultAdj(null);
  }

  if (resultAdj) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={styles.successContainer}>
          <GradientCard colors={['rgba(16,185,129,0.18)', 'rgba(16,185,129,0.06)']} glow style={styles.successCard}>
            <View style={styles.successIcon}>
              <Feather name="check-circle" size={ICON.xxl} color={SUCCESS} />
            </View>
            <Text style={styles.successTitle}>Stock Adjusted</Text>
            <Text style={styles.successSub}>
              {resultAdj.productName} · {resultAdj.variantLabel}
            </Text>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>New quantity</Text>
              <Text style={[styles.successValue, { color: SUCCESS }]}>{resultAdj.quantityAfter}</Text>
            </View>
            <View style={styles.successRow}>
              <Text style={styles.successLabel}>Change</Text>
              <Text style={[styles.successValue, { color: resultAdj.quantityChange >= 0 ? SUCCESS : RED }]}>
                {resultAdj.quantityChange >= 0 ? '+' : ''}{resultAdj.quantityChange}
              </Text>
            </View>
          </GradientCard>
          <View style={styles.successActions}>
            <PrimaryButton label="Adjust Another" onPress={resetForm} icon="refresh-cw" />
            <SecondaryButton label="View Inventory →" onPress={() => router.push('/inventory')} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Adjust Stock</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ITEM SELECTOR */}
        <SectionHeader title="Select Item" style={styles.sectionHeader} />
        {selectedItem ? (
          <BrandthreadCard style={styles.selectedItemCard}>
            <View style={styles.selectedItemRow}>
              <View style={styles.selectedItemInfo}>
                <Text style={styles.selectedItemName}>{selectedItem.productName}</Text>
                <Text style={styles.selectedItemVariant}>{selectedItem.variantLabel}</Text>
                <Text style={styles.selectedItemSku}>SKU: {selectedItem.sku}</Text>
                <View style={styles.selectedItemQtyRow}>
                  <Text style={styles.selectedItemQtyLabel}>Current qty</Text>
                  <Text style={styles.selectedItemQty}>{selectedItem.onHand}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.changeBtn}
                onPress={() => { setSelectedItem(null); setAdjustType(null); setQuantityChange('0'); }}
              >
                <Text style={styles.changeBtnText}>Change</Text>
              </TouchableOpacity>
            </View>
          </BrandthreadCard>
        ) : (
          <View style={styles.itemPickerWrap}>
            <View style={styles.searchRow}>
              <Feather name="search" size={ICON.sm} color={MUTED} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={itemSearch}
                onChangeText={setItemSearch}
                placeholder="Search by name, variant, or SKU…"
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
              scrollEnabled={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.itemRow}
                  onPress={() => setSelectedItem(item)}
                >
                  <View style={styles.itemRowInfo}>
                    <Text style={styles.itemRowName}>{item.productName}</Text>
                    <Text style={styles.itemRowVariant}>{item.variantLabel} · {item.sku}</Text>
                  </View>
                  <View style={styles.itemRowRight}>
                    <Text style={styles.itemRowQty}>{item.onHand}</Text>
                    <Text style={styles.itemRowQtyLabel}>on hand</Text>
                  </View>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        )}

        {selectedItem && (
          <>
            {/* LOCATION SELECTOR */}
            <SectionHeader title="Location" style={styles.sectionHeader} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              <View style={styles.chipsRow}>
                {locations.map(loc => (
                  <TouchableOpacity
                    key={loc.id}
                    style={[styles.chip, selectedLocationId === loc.id && styles.chipActive]}
                    onPress={() => setSelectedLocationId(loc.id)}
                  >
                    <Text style={[styles.chipText, selectedLocationId === loc.id && styles.chipTextActive]}>
                      {loc.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* ADJUSTMENT TYPE */}
            <SectionHeader title="Adjustment Type" style={styles.sectionHeader} />

            {/* Adds group */}
            <Text style={styles.typeGroupLabel}>➕ Adds stock</Text>
            <View style={styles.typeGrid}>
              {ADJUSTMENT_TYPES.filter(t => t.delta === 1).map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeChip, adjustType === t.key && styles.typeChipActive]}
                  onPress={() => setAdjustType(t.key)}
                >
                  <Text style={[styles.typeChipText, adjustType === t.key && styles.typeChipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Removes group */}
            <Text style={styles.typeGroupLabel}>➖ Removes stock</Text>
            <View style={styles.typeGrid}>
              {ADJUSTMENT_TYPES.filter(t => t.delta === -1).map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeChip, adjustType === t.key && styles.typeChipActive]}
                  onPress={() => setAdjustType(t.key)}
                >
                  <Text style={[styles.typeChipText, adjustType === t.key && styles.typeChipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Neutral group */}
            <Text style={styles.typeGroupLabel}>↕ Neutral / count</Text>
            <View style={styles.typeGrid}>
              {ADJUSTMENT_TYPES.filter(t => t.delta === 0).map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.typeChip, adjustType === t.key && styles.typeChipActive]}
                  onPress={() => setAdjustType(t.key)}
                >
                  <Text style={[styles.typeChipText, adjustType === t.key && styles.typeChipTextActive]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {adjustType && (
              <>
                {/* QUANTITY */}
                <SectionHeader title="Quantity" style={styles.sectionHeader} />
                <BrandthreadCard style={styles.qtyCard}>
                  {delta !== 0 && (
                    <View style={styles.directionBadge}>
                      <Text style={[
                        styles.directionText,
                        { color: delta === 1 ? SUCCESS : RED },
                      ]}>
                        {delta === 1 ? 'Add +' : 'Remove −'}
                      </Text>
                    </View>
                  )}
                  {delta === 0 && (
                    <View style={styles.directionBadge}>
                      <Text style={[styles.directionText, { color: CYAN }]}>Set amount</Text>
                    </View>
                  )}
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setQuantityChange(String(Math.max(0, parsedQty - 1)))}
                    >
                      <Feather name="minus" size={ICON.md} color={FG} />
                    </TouchableOpacity>
                    <TextInput
                      style={styles.qtyInput}
                      value={quantityChange}
                      onChangeText={setQuantityChange}
                      keyboardType="numeric"
                      selectTextOnFocus
                    />
                    <TouchableOpacity
                      style={styles.stepperBtn}
                      onPress={() => setQuantityChange(String(parsedQty + 1))}
                    >
                      <Feather name="plus" size={ICON.md} color={FG} />
                    </TouchableOpacity>
                  </View>
                </BrandthreadCard>

                {/* REASON */}
                <SectionHeader title="Reason *" style={styles.sectionHeader} />
                <View style={styles.inputWrap}>
                  <TextInput
                    style={[styles.textArea]}
                    value={reason}
                    onChangeText={setReason}
                    placeholder="Why is this adjustment being made?"
                    placeholderTextColor={SUBTLE}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                {/* NOTE */}
                <SectionHeader title="Note (optional)" style={styles.sectionHeader} />
                <View style={styles.inputWrap}>
                  <TextInput
                    style={[styles.textArea]}
                    value={noteText}
                    onChangeText={setNoteText}
                    placeholder="Additional notes…"
                    placeholderTextColor={SUBTLE}
                    multiline
                    numberOfLines={2}
                  />
                </View>

                {/* REFERENCE NUMBER */}
                <SectionHeader title="Reference Number (optional)" style={styles.sectionHeader} />
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.singleInput}
                    value={referenceNumber}
                    onChangeText={setReferenceNumber}
                    placeholder="PO number, order ID, etc."
                    placeholderTextColor={SUBTLE}
                  />
                </View>

                {/* PREVIEW */}
                {parsedQty > 0 && (
                  <>
                    <SectionHeader title="Preview" style={styles.sectionHeader} />
                    <BrandthreadCard style={[styles.previewCard, { borderColor: BORDER_ACTIVE }]}>
                      <View style={styles.previewRow}>
                        <Text style={styles.previewLabel}>Current quantity</Text>
                        <Text style={styles.previewValue}>{selectedItem.onHand}</Text>
                      </View>
                      <View style={styles.previewRow}>
                        <Text style={styles.previewLabel}>Change</Text>
                        <Text style={[
                          styles.previewValue,
                          { color: actualChange >= 0 ? SUCCESS : RED },
                        ]}>
                          {actualChange >= 0 ? '+' : ''}{actualChange}
                        </Text>
                      </View>
                      <View style={[styles.previewRow, styles.previewSeparatorRow]}>
                        <Text style={styles.previewLabelBold}>New quantity</Text>
                        <Text style={[
                          styles.previewValueBold,
                          { color: newQty <= selectedItem.lowStockThreshold ? RED : SUCCESS },
                        ]}>
                          {newQty}
                        </Text>
                      </View>
                      <View style={styles.previewRow}>
                        <Text style={styles.previewLabel}>Available impact</Text>
                        <Text style={styles.previewValue}>
                          {actualChange >= 0 ? '+' : ''}{actualChange} units
                        </Text>
                      </View>
                      <View style={styles.previewRow}>
                        <Text style={styles.previewLabel}>Inventory value impact</Text>
                        <Text style={[
                          styles.previewValue,
                          { color: valueImpactCents >= 0 ? SUCCESS : RED },
                        ]}>
                          {valueImpactCents >= 0 ? '+' : ''}{formatCents(Math.abs(valueImpactCents))}
                        </Text>
                      </View>
                      {newQty < 0 && (
                        <View style={styles.warningRow}>
                          <Feather name="alert-triangle" size={ICON.sm} color={RED} />
                          <Text style={styles.warningText}>Cannot reduce below zero</Text>
                        </View>
                      )}
                    </BrandthreadCard>
                  </>
                )}

                {/* SUBMIT */}
                <View style={styles.submitWrap}>
                  <PrimaryButton
                    label="Confirm Adjustment"
                    onPress={() => setShowConfirm(true)}
                    disabled={!canSubmit}
                    loading={submitting}
                    icon="check"
                  />
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* CONFIRMATION MODAL */}
      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Confirm Adjustment</Text>
            {selectedItem && adjustType && (
              <View style={styles.modalSummary}>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Product</Text>
                  <Text style={styles.modalValue}>{selectedItem.productName}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Variant</Text>
                  <Text style={styles.modalValue}>{selectedItem.variantLabel}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>SKU</Text>
                  <Text style={styles.modalValue}>{selectedItem.sku}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Type</Text>
                  <Text style={styles.modalValue}>{selectedTypeInfo?.label}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Change</Text>
                  <Text style={[styles.modalValue, { color: actualChange >= 0 ? SUCCESS : RED }]}>
                    {actualChange >= 0 ? '+' : ''}{actualChange}
                  </Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>New Qty</Text>
                  <Text style={[styles.modalValue, { color: SUCCESS }]}>{newQty}</Text>
                </View>
                <View style={styles.modalRow}>
                  <Text style={styles.modalLabel}>Reason</Text>
                  <Text style={[styles.modalValue, styles.modalValueFlex]}>{reason}</Text>
                </View>
                {noteText ? (
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Note</Text>
                    <Text style={[styles.modalValue, styles.modalValueFlex]}>{noteText}</Text>
                  </View>
                ) : null}
                {referenceNumber ? (
                  <View style={styles.modalRow}>
                    <Text style={styles.modalLabel}>Ref #</Text>
                    <Text style={styles.modalValue}>{referenceNumber}</Text>
                  </View>
                ) : null}
              </View>
            )}
            <View style={styles.modalActions}>
              <SecondaryButton
                label="Cancel"
                onPress={() => setShowConfirm(false)}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                label="Confirm"
                onPress={handleConfirm}
                loading={submitting}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: { accent: string; accentDim: string; secondary: string }) => {
  const { accent: PURPLE, accentDim: PURPLE_DIM, secondary: CYAN } = theme;
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
  scroll: { flex: 1 },
  scrollContent: { paddingTop: SP.md },
  sectionHeader: { marginTop: SP.md, marginBottom: SP.sm },

  // Item picker
  itemPickerWrap: {
    marginHorizontal: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    gap: SP.sm,
  },
  searchIcon: {},
  searchInput: {
    flex: 1,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    paddingVertical: SP.sm,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
  },
  itemRowInfo: { flex: 1 },
  itemRowName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  itemRowVariant: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  itemRowRight: { alignItems: 'flex-end' },
  itemRowQty: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  itemRowQtyLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  separator: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },

  // Selected item card
  selectedItemCard: { marginHorizontal: SP.md },
  selectedItemRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  selectedItemInfo: { flex: 1 },
  selectedItemName: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  selectedItemVariant: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
  selectedItemSku: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },
  selectedItemQtyRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.sm },
  selectedItemQtyLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  selectedItemQty: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  changeBtn: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  changeBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },

  // Chips
  chipsScroll: { marginBottom: SP.sm },
  chipsRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  chip: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.pill,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive: { color: PURPLE, fontFamily: FONT.semibold },

  // Type grid
  typeGroupLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: SUBTLE,
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: SP.sm,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  typeChip: {
    width: '47%',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },
  typeChipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  typeChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  typeChipTextActive: { color: PURPLE, fontFamily: FONT.semibold },

  // Qty stepper
  qtyCard: { marginHorizontal: SP.md },
  directionBadge: { alignSelf: 'center', marginBottom: SP.sm },
  directionText: { fontSize: FS.base, fontFamily: FONT.bold },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.lg },
  stepperBtn: {
    width: 44, height: 44, borderRadius: RADIUS.sm,
    backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyInput: {
    fontSize: 36,
    fontFamily: FONT.bold,
    color: FG,
    textAlign: 'center',
    minWidth: 80,
  },

  // Inputs
  inputWrap: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  textArea: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  singleInput: {
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    height: 52,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: FG,
  },

  // Preview card
  previewCard: { marginHorizontal: SP.md, borderWidth: 1 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm },
  previewSeparatorRow: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: SP.sm,
    paddingTop: SP.md,
  },
  previewLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  previewValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  previewLabelBold: { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  previewValueBold: { fontSize: FS.md, fontFamily: FONT.bold },
  warningRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    marginTop: SP.sm,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
  },
  warningText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: RED },

  // Submit
  submitWrap: { marginHorizontal: SP.md, marginTop: SP.lg },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.lg,
    gap: SP.md,
  },
  modalTitle: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, textAlign: 'center' },
  modalSummary: { gap: SP.sm },
  modalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  modalLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1 },
  modalValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  modalValueFlex: { flex: 2, textAlign: 'right' },
  modalActions: { flexDirection: 'row', gap: SP.md, marginTop: SP.sm },

  // Success
  successContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: SP.lg, gap: SP.lg },
  successCard: { width: '100%', alignItems: 'center', gap: SP.md },
  successIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: FS.xxl, fontFamily: FONT.bold, color: FG },
  successSub: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  successRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  successLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED },
  successValue: { fontSize: FS.base, fontFamily: FONT.bold },
  successActions: { width: '100%', gap: SP.sm },
  });
};
