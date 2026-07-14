import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  TextInput, Alert, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DEMO_INVENTORY, DEMO_PRODUCTS } from '@/services/data';
import type { InventoryItem } from '@/services/types';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const ORANGE = '#F97316';
const RED    = '#EF4444';
const BLUE   = '#3B82F6';
const PURPLE = '#8B5CF6';

// ─── Build full inventory from products ───────────────────────────────────────
function buildInventory(): InventoryItem[] {
  const all: InventoryItem[] = [];
  DEMO_PRODUCTS.forEach(p => {
    p.variants.forEach(v => {
      all.push({
        id:                `${p.id}-${v.id}`,
        productId:         p.id,
        productName:       p.name,
        variant:           `${v.color} — ${v.size}`,
        sku:               v.sku,
        quantity:          v.inventory,
        lowStockThreshold: p.lowStockThreshold,
        location:          'Warehouse A',
        lastUpdated:       p.updatedAt,
      });
    });
  });
  return all;
}

type FilterId = 'all' | 'low_stock' | 'out_of_stock' | 'in_stock';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all',          label: 'All' },
  { id: 'in_stock',     label: 'In Stock' },
  { id: 'low_stock',    label: 'Low Stock' },
  { id: 'out_of_stock', label: 'Out of Stock' },
];

function applyFilter(items: InventoryItem[], f: FilterId) {
  switch (f) {
    case 'all':          return items;
    case 'in_stock':     return items.filter(i => i.quantity > i.lowStockThreshold);
    case 'low_stock':    return items.filter(i => i.quantity > 0 && i.quantity <= i.lowStockThreshold);
    case 'out_of_stock': return items.filter(i => i.quantity === 0);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function InventoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  const allItems = buildInventory();
  const [filter, setFilter]   = useState<FilterId>('all');
  const [search, setSearch]   = useState('');
  const [refresh, setRefresh] = useState(false);

  const totalUnits = allItems.reduce((s, i) => s + i.quantity, 0);
  const lowCount   = allItems.filter(i => i.quantity > 0 && i.quantity <= i.lowStockThreshold).length;
  const outCount   = allItems.filter(i => i.quantity === 0).length;
  const invValue   = DEMO_PRODUCTS.reduce((s, p) => s + p.totalInventory * p.cost, 0);

  let visible = applyFilter(allItems, filter);
  if (search.trim()) {
    const q = search.toLowerCase();
    visible = visible.filter(i =>
      i.productName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || i.variant.toLowerCase().includes(q),
    );
  }

  function back() { router.back(); }
  function go(route: string) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as never); }

  function adjustStock(item: InventoryItem) {
    Alert.alert(
      'Adjust Stock',
      `${item.productName}\n${item.variant}\n\nCurrent: ${item.quantity} units`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Add Stock', onPress: () => Alert.alert('Stock Updated', 'New stock recorded.') },
        { text: 'Set Quantity', onPress: () => Alert.alert('Stock Updated', 'Quantity set.') },
      ],
    );
  }

  function onRefresh() {
    setRefresh(true);
    setTimeout(() => setRefresh(false), 800);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Back bar */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={back}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.title}>Inventory</Text>
        <TouchableOpacity style={s.exportBtn} onPress={() => {}}>
          <Feather name="download" size={16} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.summaryScroll}>
        <View style={s.summaryRow}>
          {[
            { label: 'Total Units',  value: totalUnits.toLocaleString(), color: FG,     onPress: () => setFilter('all') },
            { label: 'In Stock',     value: (allItems.length - lowCount - outCount).toString(), color: GREEN, onPress: () => setFilter('in_stock') },
            { label: 'Low Stock',    value: lowCount.toString(),          color: ORANGE, onPress: () => setFilter('low_stock') },
            { label: 'Out of Stock', value: outCount.toString(),          color: RED,    onPress: () => setFilter('out_of_stock') },
            { label: 'Value',        value: `$${(invValue / 1000).toFixed(1)}K`, color: BLUE, onPress: () => {} },
          ].map(item => (
            <TouchableOpacity key={item.label} style={s.summaryCard} onPress={item.onPress} activeOpacity={0.8}>
              <Text style={[s.summaryValue, { color: item.color }]}>{item.value}</Text>
              <Text style={s.summaryLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Restock CTA if needed */}
      {(lowCount > 0 || outCount > 0) && (
        <View style={s.alertBanner}>
          <Feather name="alert-triangle" size={14} color={ORANGE} />
          <Text style={s.alertText}>{outCount} out of stock · {lowCount} running low</Text>
          <TouchableOpacity style={s.alertBtn} onPress={() => {}}>
            <Text style={s.alertBtnText}>Restock All</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color={MUTED} style={{ marginLeft: 12 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search SKU, product, variant…"
          placeholderTextColor={MUTED}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={{ padding: 12 }}>
            <Feather name="x" size={14} color={MUTED} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
        <View style={s.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[s.chip, filter === f.id && s.chipActive]}
              onPress={() => { setFilter(f.id); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.chipText, filter === f.id && s.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Inventory list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 8 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {visible.length === 0 ? (
          <View style={s.empty}>
            <Feather name="layers" size={32} color={MUTED} />
            <Text style={s.emptyTitle}>No items match</Text>
            <Text style={s.emptyDesc}>Try adjusting your filters or search query.</Text>
          </View>
        ) : (
          visible.map(item => {
            const isOut = item.quantity === 0;
            const isLow = !isOut && item.quantity <= item.lowStockThreshold;
            const stockColor = isOut ? RED : isLow ? ORANGE : GREEN;

            return (
              <View key={item.id} style={s.itemCard}>
                <View style={s.itemMain}>
                  <View style={s.itemThumb}>
                    <Feather name="tag" size={16} color={MUTED} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={s.itemProduct} numberOfLines={1}>{item.productName}</Text>
                    <Text style={s.itemVariant}>{item.variant}</Text>
                    <Text style={s.itemSKU}>{item.sku}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text style={[s.itemQty, { color: stockColor }]}>
                      {isOut ? 'Out of stock' : `${item.quantity} units`}
                    </Text>
                    {isLow && <Text style={s.lowLabel}>Low stock</Text>}
                    <TouchableOpacity
                      style={[s.adjustBtn, { borderColor: stockColor + '44', backgroundColor: stockColor + '15' }]}
                      onPress={() => adjustStock(item)}
                      activeOpacity={0.8}
                    >
                      <Feather name="plus" size={12} color={stockColor} />
                      <Text style={[s.adjustText, { color: stockColor }]}>
                        {isOut ? 'Restock' : 'Adjust'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Stock bar */}
                {!isOut && (
                  <View style={s.stockBar}>
                    <View style={[s.stockFill, {
                      width: `${Math.min((item.quantity / (item.lowStockThreshold * 5)) * 100, 100)}%` as any,
                      backgroundColor: stockColor,
                    }]} />
                  </View>
                )}
              </View>
            );
          })
        )}

        {/* History section */}
        <View style={s.historySection}>
          <Text style={s.historyTitle}>Inventory history</Text>
          {[
            { action: 'Added 50 units',  product: 'Vintage Washed Tee — S', date: 'Jul 10', icon: 'plus-circle'   as const, color: GREEN  },
            { action: 'Sold 12 units',   product: 'Oversized Hoodie — M',   date: 'Jul 9',  icon: 'shopping-bag'  as const, color: BLUE   },
            { action: 'Adjusted −5',     product: 'Canvas Cargo Jacket — L',date: 'Jul 8',  icon: 'edit-2'        as const, color: ORANGE },
            { action: 'Returned 1 unit', product: 'Oversized Hoodie — S',   date: 'Jul 5',  icon: 'rotate-ccw'   as const, color: PURPLE },
          ].map((ev, i) => (
            <View key={i} style={[s.historyRow, i > 0 && s.historyBorder]}>
              <View style={[s.historyIcon, { backgroundColor: ev.color + '20' }]}>
                <Feather name={ev.icon} size={14} color={ev.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.historyAction}>{ev.action}</Text>
                <Text style={s.historyProduct}>{ev.product}</Text>
              </View>
              <Text style={s.historyDate}>{ev.date}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn:{ width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  title:  { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold', color: FG },
  exportBtn:{ width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  summaryScroll: { flexGrow: 0, marginBottom: 8 },
  summaryRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryCard:   { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 76 },
  summaryValue:  { fontSize: 20, fontFamily: 'Inter_700Bold' },
  summaryLabel:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 2 },

  alertBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 8, backgroundColor: ORANGE + '15', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: ORANGE + '33' },
  alertText:   { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: ORANGE },
  alertBtn:    { backgroundColor: ORANGE, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  alertBtnText:{ fontSize: 11, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  searchInput: { flex: 1, paddingVertical: 11, paddingHorizontal: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },

  filterScroll: { flexGrow: 0, marginBottom: 4 },
  filterRow:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  chip:         { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  chipActive:   { backgroundColor: GREEN + '22', borderColor: GREEN },
  chipText:     { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  chipTextActive: { color: GREEN },

  itemCard:    { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 10 },
  itemMain:    { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  itemThumb:   { width: 44, height: 44, borderRadius: 10, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  itemProduct: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  itemVariant: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  itemSKU:     { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  itemQty:     { fontSize: 14, fontFamily: 'Inter_700Bold' },
  lowLabel:    { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: ORANGE },
  adjustBtn:   { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  adjustText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  stockBar:    { height: 3, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  stockFill:   { height: 3, borderRadius: 2 },

  historySection: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: 8 },
  historyTitle:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, padding: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  historyRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  historyBorder:  { borderTopWidth: 1, borderTopColor: BORDER },
  historyIcon:    { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  historyAction:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  historyProduct: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  historyDate:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  empty:     { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle:{ fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
});
