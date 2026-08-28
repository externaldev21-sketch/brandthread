import React, { useState, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet, FlatList, ActivityIndicator, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, StatusBadge, SectionHeader, EmptyState } from '@/components/BrandthreadUI';
import { getCounts, createCount, updateCountItem, completeCount, getInventoryItems, getLocations } from '@/services/inventoryService';
import { InventoryCount, InventoryCountItem, CountType, CountStatus, InventoryItem, InventoryLocation } from '@/services/inventoryTypes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function countStatusVariant(status: CountStatus): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'completed': return 'success';
    case 'in_progress': return 'info';
    case 'review_needed': return 'warning';
    case 'draft': return 'neutral';
    case 'cancelled': return 'error';
    default: return 'neutral';
  }
}

function countStatusLabel(status: CountStatus): string {
  switch (status) {
    case 'draft': return 'Draft';
    case 'in_progress': return 'In Progress';
    case 'review_needed': return 'Review Needed';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function countTypeLabel(type: CountType): string {
  switch (type) {
    case 'full': return 'Full Count';
    case 'location': return 'Location Count';
    case 'product': return 'Product Count';
    case 'cycle': return 'Cycle Count';
    case 'spot_check': return 'Spot Check';
    default: return type;
  }
}

function countTypeIcon(type: CountType): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'full': return 'layers';
    case 'location': return 'map-pin';
    case 'product': return 'package';
    case 'cycle': return 'refresh-cw';
    case 'spot_check': return 'eye';
    default: return 'list';
  }
}

type ScreenMode = 'list' | 'view' | 'new';
type FilterOption = 'all' | CountStatus;

const FILTER_OPTS: { key: FilterOption; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review_needed', label: 'Review Needed' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const COUNT_TYPES: { key: CountType; label: string }[] = [
  { key: 'full', label: 'Full Count' },
  { key: 'location', label: 'Location Count' },
  { key: 'product', label: 'Product Count' },
  { key: 'cycle', label: 'Cycle Count' },
  { key: 'spot_check', label: 'Spot Check' },
];

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ percent }: { percent: number }) {
  const widthAnim = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(widthAnim, { toValue: percent / 100, duration: 400, useNativeDriver: false }).start();
  }, [percent]);
  return (
    <View style={pb.track}>
      <Animated.View
        style={[pb.fill, { width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
      />
    </View>
  );
}

const pb = StyleSheet.create({
  track: { height: 6, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: RADIUS.pill, overflow: 'hidden', marginVertical: SP.sm },
  fill: { height: '100%', borderRadius: RADIUS.pill, backgroundColor: PURPLE },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function InventoryCountScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<ScreenMode>(id ? 'view' : 'list');

  // List state
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [filterStatus, setFilterStatus] = useState<FilterOption>('all');
  const [loading, setLoading] = useState(true);

  // View state
  const [currentCount, setCurrentCount] = useState<InventoryCount | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [countInput, setCountInput] = useState('');
  const [savingItem, setSavingItem] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [countNotes, setCountNotes] = useState('');

  // New state
  const [newType, setNewType] = useState<CountType>('full');
  const [newLocationId, setNewLocationId] = useState('');
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [creating, setCreating] = useState(false);

  useFocusEffect(useCallback(() => {
    loadData();
  }, []));

  async function loadData() {
    setLoading(true);
    try {
      const [cts, locs, items] = await Promise.all([
        getCounts(),
        getLocations(),
        getInventoryItems(),
      ]);
      setCounts(cts);
      setLocations(locs);
      setInventoryItems(items);
      if (id) {
        const found = cts.find(c => c.id === id);
        if (found) { setCurrentCount(found); setMode('view'); }
      }
    } finally {
      setLoading(false);
    }
  }

  async function reloadCounts() {
    const cts = await getCounts();
    setCounts(cts);
    if (currentCount) {
      const updated = cts.find(c => c.id === currentCount.id);
      if (updated) setCurrentCount(updated);
    }
  }

  // Filtered list
  const filtered = filterStatus === 'all' ? counts : counts.filter(c => c.status === filterStatus);

  // Item count estimate
  function countItemEstimate(): number {
    if (newType === 'full') return inventoryItems.length;
    if ((newType === 'location' || newType === 'cycle') && newLocationId) {
      return inventoryItems.filter(i => i.levels.some(l => l.locationId === newLocationId)).length;
    }
    return inventoryItems.length;
  }

  async function handleCreateCount() {
    setCreating(true);
    try {
      const locId = (newType === 'location' || newType === 'cycle') ? newLocationId || undefined : undefined;
      const newCnt = await createCount(newType, locId);
      await reloadCounts();
      setCurrentCount(newCnt);
      setMode('view');
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveItem(cntId: string, itemId: string) {
    setSavingItem(true);
    try {
      const qty = parseInt(countInput, 10);
      if (isNaN(qty)) return;
      const updated = await updateCountItem(cntId, itemId, qty);
      if (updated) setCurrentCount(updated);
      setEditingItemId(null);
      setCountInput('');
    } finally {
      setSavingItem(false);
    }
  }

  async function handleCompleteCount() {
    if (!currentCount) return;
    setCompleting(true);
    try {
      const updated = await completeCount(currentCount.id);
      if (updated) setCurrentCount(updated);
      await reloadCounts();
    } finally {
      setCompleting(false);
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
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Inventory Counts</Text>
          <TouchableOpacity
            style={s.addBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMode('new'); }}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.addBtnGrad}>
              <Feather name="plus" size={ICON.sm} color="#fff" />
              <Text style={s.addBtnText}>New</Text>
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
          keyExtractor={c => c.id}
          contentContainerStyle={s.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="clipboard"
              title="No inventory counts"
              description="Create a count to verify your physical inventory."
              action={{ label: 'Start Count', onPress: () => setMode('new'), icon: 'plus' }}
            />
          }
          renderItem={({ item: cnt }) => (
            <BrandthreadCard
              style={s.listCard}
              onPress={() => { setCurrentCount(cnt); setMode('view'); }}
            >
              <View style={s.listCardRow}>
                <View style={s.listCardLeft}>
                  <View style={[s.typeIconWrap, { backgroundColor: PURPLE_DIM }]}>
                    <Feather name={countTypeIcon(cnt.type)} size={ICON.sm} color={PURPLE} />
                  </View>
                  <View style={s.listCardInfo}>
                    <Text style={s.listCardTitle}>{cnt.countNumber}</Text>
                    <Text style={s.listCardSub}>{countTypeLabel(cnt.type)}</Text>
                  </View>
                </View>
                <StatusBadge label={countStatusLabel(cnt.status)} variant={countStatusVariant(cnt.status)} small />
              </View>
              <Text style={s.listCardMeta}>
                {cnt.countedItems} of {cnt.totalItems} items counted · {cnt.discrepancyCount} discrepancies
              </Text>
              <Text style={s.listCardDate}>
                {cnt.startedAt ? `Started: ${formatDate(cnt.startedAt)}` : `Created: ${formatDate(cnt.createdAt)}`}
              </Text>
            </BrandthreadCard>
          )}
        />
      </View>
    );
  }

  // ══════════ NEW MODE ══════════
  if (mode === 'new') {
    const needsLocation = newType === 'location' || newType === 'cycle';
    const estimate = countItemEstimate();
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setMode('list')} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>New Count</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={s.fieldLabel}>Count Type</Text>
          <View style={s.typeGrid}>
            {COUNT_TYPES.map(ct => (
              <TouchableOpacity
                key={ct.key}
                style={[s.typeChip, newType === ct.key && s.typeChipActive]}
                onPress={() => { Haptics.selectionAsync(); setNewType(ct.key); }}
              >
                <Feather name={countTypeIcon(ct.key)} size={ICON.sm} color={newType === ct.key ? PURPLE : MUTED} />
                <Text style={[s.typeChipText, newType === ct.key && s.typeChipTextActive]}>{ct.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {needsLocation && (
            <>
              <Text style={[s.fieldLabel, { marginTop: SP.md }]}>Location</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
                {locations.map(loc => (
                  <TouchableOpacity
                    key={loc.id}
                    style={[s.chip, newLocationId === loc.id && s.chipActive]}
                    onPress={() => setNewLocationId(loc.id)}
                  >
                    <Text style={[s.chipText, newLocationId === loc.id && s.chipTextActive]}>{loc.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <BrandthreadCard style={[s.estimateCard, { marginTop: SP.md }]}>
            <View style={s.estimateRow}>
              <Feather name="info" size={ICON.sm} color={CYAN} />
              <Text style={s.estimateText}>
                {estimate} item{estimate !== 1 ? 's' : ''} will be included in this count
                {needsLocation && !newLocationId ? ' (select a location to narrow)' : ''}.
              </Text>
            </View>
          </BrandthreadCard>

          <PrimaryButton
            label="Start Count"
            onPress={handleCreateCount}
            loading={creating}
            disabled={needsLocation && !newLocationId}
            style={{ marginTop: SP.lg }}
            icon="play"
          />
          <View style={{ height: SP.xxl }} />
        </ScrollView>
      </View>
    );
  }

  // ══════════ VIEW MODE ══════════
  if (!currentCount) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => setMode('list')} style={s.backBtn}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Count</Text>
          <View style={{ width: 60 }} />
        </View>
        <EmptyState icon="clipboard" title="Count not found" description="This inventory count could not be loaded." />
      </View>
    );
  }

  const cnt = currentCount;
  const isEditable = cnt.status === 'draft' || cnt.status === 'in_progress';
  const isCompleted = cnt.status === 'completed' || cnt.status === 'review_needed';
  const progressPct = cnt.totalItems > 0 ? Math.round((cnt.countedItems / cnt.totalItems) * 100) : 0;
  const discrepancyItems = cnt.items.filter(i => i.discrepancy !== null && i.discrepancy !== 0);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => setMode('list')} style={s.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={s.headerTitleRow}>
          <Text style={s.headerTitle} numberOfLines={1}>{cnt.countNumber}</Text>
        </View>
        <StatusBadge label={countStatusLabel(cnt.status)} variant={countStatusVariant(cnt.status)} />
      </View>

      {/* Progress card pinned at top */}
      <GradientCard colors={GRAD_CARD_GLOW} style={s.progressCard}>
        <View style={s.progressRow}>
          <Text style={s.progressPct}>{progressPct}%</Text>
          <Text style={s.progressLabel}>{cnt.countedItems} of {cnt.totalItems} items counted · {cnt.discrepancyCount} discrepancies</Text>
        </View>
        <ProgressBar percent={progressPct} />
        <View style={s.progressMeta}>
          <Text style={s.progressMetaText}>{countTypeLabel(cnt.type)}</Text>
          {cnt.locationName && <Text style={s.progressMetaText}>· {cnt.locationName}</Text>}
        </View>
      </GradientCard>

      {/* Items FlatList */}
      {isEditable && (
        <FlatList
          data={cnt.items}
          keyExtractor={item => item.itemId}
          contentContainerStyle={s.itemListContent}
          ListFooterComponent={
            <View style={{ gap: SP.sm, marginTop: SP.md }}>
              {/* Notes */}
              <Text style={s.fieldLabel}>Notes (optional)</Text>
              <TextInput
                style={[s.input, s.inputMulti]}
                value={countNotes}
                onChangeText={setCountNotes}
                placeholder="Add notes about this count…"
                placeholderTextColor={SUBTLE}
                multiline
                numberOfLines={3}
              />
              <View style={{ height: SP.xxl * 2 }} />
            </View>
          }
          renderItem={({ item: ci }) => {
            const isEditing = editingItemId === ci.itemId;
            const hasCounted = ci.countedQty !== null;
            const discrepancy = ci.discrepancy;
            const hasDisc = hasCounted && discrepancy !== null && discrepancy !== 0;
            return (
              <View style={s.countItemRow}>
                <View style={s.countItemInfo}>
                  <Text style={s.countItemName} numberOfLines={1}>{ci.productName}</Text>
                  <Text style={s.countItemSub}>{ci.variantLabel} · {ci.sku}</Text>
                  <Text style={s.countItemExpected}>Expected: {ci.expectedQty} units</Text>
                </View>
                <View style={s.countItemRight}>
                  {isEditing ? (
                    <View style={s.editingRow}>
                      <TextInput
                        style={s.countInput}
                        value={countInput}
                        onChangeText={setCountInput}
                        keyboardType="numeric"
                        placeholder="Qty"
                        placeholderTextColor={SUBTLE}
                        autoFocus
                      />
                      <TouchableOpacity
                        style={s.saveBtn}
                        onPress={() => handleSaveItem(cnt.id, ci.itemId)}
                        disabled={savingItem}
                      >
                        {savingItem ? (
                          <ActivityIndicator size="small" color={PURPLE} />
                        ) : (
                          <Text style={s.saveBtnText}>Save</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={s.countedRow}>
                      <Text style={[s.countedValue, !hasCounted && { color: SUBTLE }]}>
                        {hasCounted ? ci.countedQty : '—'}
                      </Text>
                      {hasDisc && discrepancy !== null && (
                        <Text style={[s.discrepancyBadge, { color: discrepancy > 0 ? SUCCESS : RED }]}>
                          {discrepancy > 0 ? `+${discrepancy}` : `${discrepancy}`}
                        </Text>
                      )}
                      <TouchableOpacity
                        style={s.editBtn}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setEditingItemId(ci.itemId);
                          setCountInput(hasCounted ? String(ci.countedQty) : '');
                        }}
                      >
                        <Feather name="edit-2" size={12} color={PURPLE} />
                        <Text style={s.editBtnText}>Edit</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Completed summary */}
      {isCompleted && (
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
          <BrandthreadCard style={s.completedSummary}>
            <View style={s.completedSummaryRow}>
              <Feather name="check-circle" size={ICON.md} color={SUCCESS} />
              <Text style={s.completedSummaryText}>
                {cnt.countedItems} items counted · {cnt.discrepancyCount} discrepancies
              </Text>
            </View>
          </BrandthreadCard>

          {discrepancyItems.length > 0 && (
            <>
              <SectionHeader title="Discrepancies" style={{ marginTop: SP.md }} />
              {discrepancyItems.map(ci => (
                <BrandthreadCard key={ci.itemId} style={s.discRow}>
                  <View style={s.discInfo}>
                    <Text style={s.discName} numberOfLines={1}>{ci.productName} · {ci.variantLabel}</Text>
                    <Text style={s.discDetail}>
                      Expected {ci.expectedQty}, Counted {ci.countedQty ?? '—'}
                    </Text>
                  </View>
                  {ci.discrepancy !== null && (
                    <Text style={[s.discDiff, { color: ci.discrepancy > 0 ? SUCCESS : RED }]}>
                      {ci.discrepancy > 0 ? `+${ci.discrepancy}` : `${ci.discrepancy}`}
                    </Text>
                  )}
                </BrandthreadCard>
              ))}
            </>
          )}

          <BrandthreadCard style={[s.correctionNote, { marginTop: SP.md }]}>
            <Feather name="info" size={ICON.sm} color={CYAN} />
            <Text style={s.correctionNoteText}>
              Corrections have been applied as inventory adjustments.
            </Text>
          </BrandthreadCard>
          <View style={{ height: SP.xxl }} />
        </ScrollView>
      )}

      {/* Sticky bottom action bar */}
      {isEditable && (
        <View style={[s.stickyBar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
          <PrimaryButton
            label={completing ? 'Completing…' : 'Complete Count'}
            onPress={handleCompleteCount}
            loading={completing}
            icon="check"
          />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
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
  listCardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  listCardLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flex: 1 },
  typeIconWrap: { width: 36, height: 36, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  listCardInfo: { flex: 1 },
  listCardTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  listCardSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  listCardMeta: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: SP.xs },
  listCardDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },

  // New form
  fieldLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs, letterSpacing: 0.2 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  typeChipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  typeChipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  typeChipTextActive: { color: PURPLE, fontFamily: FONT.semibold },
  chipRow: { flexDirection: 'row' },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, justifyContent: 'center', marginRight: SP.sm },
  chipActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive: { color: PURPLE, fontFamily: FONT.semibold },
  estimateCard: { gap: 0 },
  estimateRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  estimateText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  input: { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, height: 52, fontSize: FS.base, fontFamily: FONT.regular, color: FG },
  inputMulti: { height: 90, paddingTop: SP.sm, textAlignVertical: 'top' },

  // View mode — progress
  progressCard: { margin: SP.md, marginTop: SP.xs },
  progressRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP.sm },
  progressPct: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  progressLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1 },
  progressMeta: { flexDirection: 'row', gap: SP.xs },
  progressMetaText: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },

  // Count items
  itemListContent: { paddingHorizontal: SP.md, paddingBottom: SP.md },
  countItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER, gap: SP.sm },
  countItemInfo: { flex: 1 },
  countItemName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  countItemSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },
  countItemExpected: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 1 },
  countItemRight: { alignItems: 'flex-end' },
  editingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  countInput: { width: 72, height: 40, backgroundColor: CARD, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, textAlign: 'center', fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  saveBtn: { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: 8, borderWidth: 1, borderColor: BORDER_ACTIVE },
  saveBtnText: { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE },
  countedRow: { alignItems: 'flex-end', gap: 3 },
  countedValue: { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  discrepancyBadge: { fontSize: FS.xs, fontFamily: FONT.bold },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  editBtnText: { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE },

  // Sticky bottom
  stickyBar: { backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER, paddingHorizontal: SP.md, paddingTop: SP.sm },

  // Completed
  completedSummary: { gap: 0 },
  completedSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  completedSummaryText: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flex: 1 },
  discRow: { flexDirection: 'row', alignItems: 'center', marginTop: SP.xs, gap: SP.sm },
  discInfo: { flex: 1 },
  discName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  discDetail: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  discDiff: { fontSize: FS.md, fontFamily: FONT.bold },
  correctionNote: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  correctionNoteText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  });
};
