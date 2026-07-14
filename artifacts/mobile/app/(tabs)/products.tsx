import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DEMO_PRODUCTS } from '@/services/data';
import type { Product, ProductStatus } from '@/services/types';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const ORANGE = '#F97316';
const RED    = '#EF4444';
const PURPLE = '#8B5CF6';

// ─── Filter types ─────────────────────────────────────────────────────────────
type FilterId = 'all' | 'active' | 'draft' | 'archived' | 'pre-order' | 'low_stock' | 'out_of_stock';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all',         label: 'All' },
  { id: 'active',      label: 'Active' },
  { id: 'draft',       label: 'Draft' },
  { id: 'pre-order',   label: 'Pre-order' },
  { id: 'archived',    label: 'Archived' },
  { id: 'low_stock',   label: 'Low Stock' },
  { id: 'out_of_stock',label: 'Out of Stock' },
];

function applyFilter(products: Product[], f: FilterId): Product[] {
  switch (f) {
    case 'all':          return products;
    case 'active':       return products.filter(p => p.status === 'active');
    case 'draft':        return products.filter(p => p.status === 'draft');
    case 'archived':     return products.filter(p => p.status === 'archived');
    case 'pre-order':    return products.filter(p => p.status === 'pre-order');
    case 'low_stock':    return products.filter(p => p.totalInventory > 0 && p.totalInventory <= p.lowStockThreshold);
    case 'out_of_stock': return products.filter(p => p.totalInventory === 0);
  }
}

function statusLabel(s: ProductStatus): string {
  switch (s) {
    case 'active':    return 'Active';
    case 'draft':     return 'Draft';
    case 'archived':  return 'Archived';
    case 'pre-order': return 'Pre-order';
  }
}

function statusColor(s: ProductStatus): string {
  switch (s) {
    case 'active':    return GREEN;
    case 'draft':     return ORANGE;
    case 'archived':  return MUTED;
    case 'pre-order': return BLUE;
  }
}

// ─── Summary stats ────────────────────────────────────────────────────────────
function buildSummary(products: Product[]) {
  const active    = products.filter(p => p.status === 'active').length;
  const drafts    = products.filter(p => p.status === 'draft').length;
  const lowStock  = products.filter(p => p.totalInventory > 0 && p.totalInventory <= p.lowStockThreshold).length;
  const preOrder  = products.filter(p => p.status === 'pre-order').length;
  const invValue  = products.reduce((s, p) => s + p.totalInventory * p.cost, 0);
  return { active, drafts, lowStock, preOrder, invValue };
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProductsScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [filter,   setFilter]   = useState<FilterId>('all');
  const [search,   setSearch]   = useState('');
  const [refresh,  setRefresh]  = useState(false);

  const summary  = buildSummary(DEMO_PRODUCTS);
  let visible    = applyFilter(DEMO_PRODUCTS, filter);
  if (search.trim()) {
    const q = search.toLowerCase();
    visible = visible.filter(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
  }

  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function productAction(product: Product, action: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(action, `${action} "${product.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: action, style: 'default', onPress: () => {} },
    ]);
  }

  function onRefresh() {
    setRefresh(true);
    setTimeout(() => setRefresh(false), 800);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Products</Text>
          <Text style={s.subtitle}>{DEMO_PRODUCTS.length} total products</Text>
        </View>
        <TouchableOpacity style={s.importBtn} onPress={() => {}} activeOpacity={0.8}>
          <Feather name="download" size={15} color={MUTED} />
        </TouchableOpacity>
        <TouchableOpacity style={s.addBtn} onPress={() => go('/add-product')} activeOpacity={0.85}>
          <Feather name="plus" size={15} color="#0A0B0A" />
          <Text style={s.addBtnText}>Add Product</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color={MUTED} style={{ marginLeft: 12 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search products…"
          placeholderTextColor={MUTED}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} style={{ padding: 12 }}>
            <Feather name="x" size={14} color={MUTED} />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.filterBtn} onPress={() => {}}>
          <Feather name="sliders" size={15} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Summary cards */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.summaryScroll}>
        <View style={s.summaryRow}>
          {[
            { label: 'Active',    value: summary.active,                 color: GREEN,  filter: 'active'      as FilterId },
            { label: 'Drafts',    value: summary.drafts,                 color: ORANGE, filter: 'draft'       as FilterId },
            { label: 'Low Stock', value: summary.lowStock,               color: RED,    filter: 'low_stock'   as FilterId },
            { label: 'Pre-orders',value: summary.preOrder,               color: BLUE,   filter: 'pre-order'   as FilterId },
            { label: 'Inv. Value',value: `$${(summary.invValue / 1000).toFixed(1)}K`, color: PURPLE, filter: 'all' as FilterId, isString: true },
          ].map(item => (
            <TouchableOpacity
              key={item.label}
              style={s.summaryCard}
              onPress={() => { setFilter(item.filter); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.summaryValue, { color: item.color }]}>
                {item.isString ? item.value : item.value as number}
              </Text>
              <Text style={s.summaryLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
        <View style={s.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[s.filterChip, filter === f.id && s.filterChipActive]}
              onPress={() => { setFilter(f.id); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.filterText, filter === f.id && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Product list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {visible.length === 0 ? (
          <View style={s.empty}>
            <Feather name="box" size={36} color={MUTED} />
            <Text style={s.emptyTitle}>No products here</Text>
            <Text style={s.emptyDesc}>Tap "Add Product" to create your first product.</Text>
            <TouchableOpacity style={s.emptyBtn} onPress={() => go('/add-product')} activeOpacity={0.85}>
              <Text style={s.emptyBtnText}>Add Product</Text>
            </TouchableOpacity>
          </View>
        ) : (
          visible.map(product => (
            <ProductCard
              key={product.id}
              product={product}
              onPress={() => go('/product-detail')}
              onAction={(a) => productAction(product, a)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Product card ─────────────────────────────────────────────────────────────
function ProductCard({
  product,
  onPress,
  onAction,
}: {
  product:  Product;
  onPress:  () => void;
  onAction: (action: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const margin = product.price - product.cost;
  const marginPct = product.price > 0 ? Math.round((margin / product.price) * 100) : 0;
  const isLow = product.totalInventory > 0 && product.totalInventory <= product.lowStockThreshold;
  const isOut = product.totalInventory === 0;

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.82}>
      <View style={s.cardMain}>
        {/* Thumbnail */}
        <View style={s.thumb}>
          <Feather name="tag" size={20} color={MUTED} />
          {(isLow || isOut) && (
            <View style={[s.stockAlert, { backgroundColor: isOut ? RED : ORANGE }]} />
          )}
        </View>

        {/* Info */}
        <View style={{ flex: 1, gap: 4 }}>
          <View style={s.nameRow}>
            <Text style={s.productName} numberOfLines={1}>{product.name}</Text>
            <View style={[s.statusBadge, { backgroundColor: statusColor(product.status) + '22', borderColor: statusColor(product.status) + '44' }]}>
              <Text style={[s.statusText, { color: statusColor(product.status) }]}>{statusLabel(product.status)}</Text>
            </View>
          </View>
          <Text style={s.productType}>{product.category} · {product.productType}</Text>

          <View style={s.metricsRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>${product.price.toFixed(2)}</Text>
              <Text style={s.metricLabel}>Price</Text>
            </View>
            <View style={s.metricDiv} />
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: isOut ? RED : isLow ? ORANGE : FG }]}>
                {product.totalInventory}
              </Text>
              <Text style={s.metricLabel}>Stock</Text>
            </View>
            <View style={s.metricDiv} />
            <View style={s.metric}>
              <Text style={s.metricValue}>{product.totalSales.toLocaleString()}</Text>
              <Text style={s.metricLabel}>Sales</Text>
            </View>
            <View style={s.metricDiv} />
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: GREEN }]}>{marginPct}%</Text>
              <Text style={s.metricLabel}>Margin</Text>
            </View>
          </View>

          <Text style={s.variantCount}>{product.variants.length} variants</Text>
        </View>

        {/* More menu */}
        <TouchableOpacity
          onPress={() => setMenuOpen(!menuOpen)}
          style={s.moreBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="more-horizontal" size={18} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Context menu */}
      {menuOpen && (
        <View style={s.menu}>
          {[
            { label: 'Edit',              icon: 'edit-2'       as const },
            { label: 'Duplicate',         icon: 'copy'         as const },
            { label: 'Create Content',    icon: 'video'        as const },
            { label: 'Send to Mfg',       icon: 'tool'         as const },
            { label: 'Share',             icon: 'share-2'      as const },
            { label: 'Archive',           icon: 'archive'      as const },
          ].map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[s.menuItem, i > 0 && s.menuBorder]}
              onPress={() => { setMenuOpen(false); onAction(item.label); }}
              activeOpacity={0.8}
            >
              <Feather name={item.icon} size={14} color={item.label === 'Archive' ? RED : MUTED} />
              <Text style={[s.menuText, item.label === 'Archive' && { color: RED }]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6, gap: 8 },
  title:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG },
  subtitle:{ fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  importBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  addBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: GREEN, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  addBtnText:{ fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 11, paddingHorizontal: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },
  filterBtn:   { padding: 12, borderLeftWidth: 1, borderLeftColor: BORDER },

  summaryScroll: { flexGrow: 0, marginBottom: 4 },
  summaryRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryCard:   { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 76 },
  summaryValue:  { fontSize: 20, fontFamily: 'Inter_700Bold' },
  summaryLabel:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 2 },

  filterScroll: { flexGrow: 0, marginVertical: 4 },
  filterRow:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  filterChip:   { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  filterChipActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  filterText:   { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  filterTextActive: { color: GREEN },

  card:     { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  cardMain: { flexDirection: 'row', gap: 12, padding: 14 },
  thumb:    { width: 58, height: 58, borderRadius: 12, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  stockAlert:{ position: 'absolute', top: 4, right: 4, width: 8, height: 8, borderRadius: 4 },

  nameRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  productName:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG, flex: 1 },
  statusBadge:  { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1 },
  statusText:   { fontSize: 9, fontFamily: 'Inter_700Bold' },
  productType:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  variantCount: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },

  metricsRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  metric:      { alignItems: 'center', gap: 2 },
  metricValue: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  metricLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: MUTED },
  metricDiv:   { width: 1, height: 24, backgroundColor: BORDER },

  moreBtn:    { padding: 4, alignSelf: 'flex-start' },

  menu:       { borderTopWidth: 1, borderTopColor: BORDER, padding: 4 },
  menuItem:   { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  menuBorder: { borderTopWidth: 1, borderTopColor: BORDER },
  menuText:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: FG },

  empty:    { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', maxWidth: 260 },
  emptyBtn:  { backgroundColor: GREEN, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11, marginTop: 4 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
});
