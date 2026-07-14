import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  TextInput, RefreshControl, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { DEMO_ORDERS } from '@/services/data';
import type { Order, OrderStatus } from '@/services/types';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const PURPLE = '#8B5CF6';
const ORANGE = '#F97316';
const RED    = '#EF4444';
const CYAN   = '#06B6D4';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusLabel(s: OrderStatus): string {
  switch (s) {
    case 'new':           return 'New';
    case 'processing':    return 'Processing';
    case 'ready_to_ship': return 'Ready to Ship';
    case 'shipped':       return 'Shipped';
    case 'delivered':     return 'Delivered';
    case 'refunded':      return 'Refunded';
    case 'disputed':      return 'Disputed';
    case 'cancelled':     return 'Cancelled';
  }
}

function statusColor(s: OrderStatus): string {
  switch (s) {
    case 'new':           return BLUE;
    case 'processing':    return PURPLE;
    case 'ready_to_ship': return CYAN;
    case 'shipped':       return GREEN;
    case 'delivered':     return GREEN;
    case 'refunded':      return ORANGE;
    case 'disputed':      return RED;
    case 'cancelled':     return MUTED;
  }
}

function paymentColor(s: string) {
  if (s === 'paid') return GREEN;
  if (s === 'refunded') return RED;
  return ORANGE;
}

// ─── Filter config ────────────────────────────────────────────────────────────

type FilterId = 'all' | 'unfulfilled' | 'processing' | 'ready_to_ship' | 'shipped' | 'returns';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all',           label: 'All' },
  { id: 'unfulfilled',   label: 'Unfulfilled' },
  { id: 'processing',    label: 'Processing' },
  { id: 'ready_to_ship', label: 'Ready to Ship' },
  { id: 'shipped',       label: 'Shipped' },
  { id: 'returns',       label: 'Returns' },
];

// ─── Summary strip data ───────────────────────────────────────────────────────

function buildSummary(orders: Order[]) {
  return [
    { label: 'New',     count: orders.filter(o => o.status === 'new').length,           color: BLUE,   filter: 'unfulfilled'   as FilterId },
    { label: 'Process', count: orders.filter(o => o.status === 'processing').length,    color: PURPLE, filter: 'processing'    as FilterId },
    { label: 'Ready',   count: orders.filter(o => o.status === 'ready_to_ship').length, color: CYAN,   filter: 'ready_to_ship' as FilterId },
    { label: 'Shipped', count: orders.filter(o => o.status === 'shipped').length,       color: GREEN,  filter: 'shipped'       as FilterId },
    { label: 'Returns', count: orders.filter(o => o.status === 'refunded').length,      color: RED,    filter: 'returns'       as FilterId },
  ];
}

function applyFilter(orders: Order[], f: FilterId): Order[] {
  switch (f) {
    case 'all':           return orders;
    case 'unfulfilled':   return orders.filter(o => o.fulfillmentStatus === 'unfulfilled' && o.status !== 'cancelled');
    case 'processing':    return orders.filter(o => o.status === 'processing');
    case 'ready_to_ship': return orders.filter(o => o.status === 'ready_to_ship');
    case 'shipped':       return orders.filter(o => o.status === 'shipped');
    case 'returns':       return orders.filter(o => o.status === 'refunded' || o.status === 'disputed');
  }
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;

  const [filter,  setFilter]  = useState<FilterId>('all');
  const [search,  setSearch]  = useState('');
  const [refresh, setRefresh] = useState(false);

  const summary = buildSummary(DEMO_ORDERS);

  let visible = applyFilter(DEMO_ORDERS, filter);
  if (search.trim()) {
    const q = search.toLowerCase();
    visible = visible.filter(o =>
      o.orderNumber.toLowerCase().includes(q) ||
      o.customer.name.toLowerCase().includes(q),
    );
  }

  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function onRefresh() {
    setRefresh(true);
    setTimeout(() => setRefresh(false), 800);
  }

  function openOrder(order: Order) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/order-detail', params: { id: order.id } } as never);
  }

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Orders</Text>
          <Text style={s.subtitle}>{DEMO_ORDERS.length} total orders</Text>
        </View>
        <TouchableOpacity style={s.iconBtn} onPress={() => go('/shipping')} activeOpacity={0.8}>
          <Feather name="truck" size={18} color={FG} />
        </TouchableOpacity>
        <TouchableOpacity style={s.iconBtn} onPress={() => {}} activeOpacity={0.8}>
          <Feather name="sliders" size={18} color={FG} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color={MUTED} style={{ marginLeft: 12 }} />
        <TextInput
          style={s.searchInput}
          placeholder="Search orders, customers…"
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

      {/* Summary strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.summaryScroll}>
        <View style={s.summaryRow}>
          {summary.map(item => (
            <TouchableOpacity
              key={item.label}
              style={s.summaryCard}
              onPress={() => { setFilter(item.filter); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.summaryCount, { color: item.color }]}>{item.count}</Text>
              <Text style={s.summaryLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Filter tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll}>
        <View style={s.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[s.filterTab, filter === f.id && s.filterTabActive]}
              onPress={() => { setFilter(f.id); Haptics.selectionAsync(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.filterText, filter === f.id && s.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Order list */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={GREEN} />}
      >
        {visible.length === 0 ? (
          <View style={s.emptyCard}>
            <Feather name="shopping-bag" size={36} color={MUTED} />
            <Text style={s.emptyTitle}>No orders here</Text>
            <Text style={s.emptyDesc}>Orders will appear here once customers place them.</Text>
          </View>
        ) : (
          visible.map(order => (
            <OrderCard key={order.id} order={order} onPress={() => openOrder(order)} />
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─── Order card ───────────────────────────────────────────────────────────────

function OrderCard({ order, onPress }: { order: Order; onPress: () => void }) {
  const itemCount = order.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <TouchableOpacity style={s.card} onPress={onPress} activeOpacity={0.82}>
      <View style={s.cardTop}>
        <View style={s.cardLeft}>
          <Text style={s.orderNum}>{order.orderNumber}</Text>
          <Text style={s.orderCustomer}>{order.customer.name}</Text>
        </View>
        <View style={s.cardRight}>
          <Text style={s.orderTotal}>${order.total.toFixed(2)}</Text>
          <Text style={s.orderDate}>{order.date}</Text>
        </View>
      </View>

      <View style={s.cardMeta}>
        <Text style={s.orderItems} numberOfLines={1}>
          {order.items.map(i => i.productName).join(', ')} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </Text>
      </View>

      <View style={s.cardBadges}>
        {/* Order status */}
        <View style={[s.badge, { backgroundColor: statusColor(order.status) + '22', borderColor: statusColor(order.status) + '44' }]}>
          <View style={[s.badgeDot, { backgroundColor: statusColor(order.status) }]} />
          <Text style={[s.badgeText, { color: statusColor(order.status) }]}>{statusLabel(order.status)}</Text>
        </View>

        {/* Payment status */}
        <View style={[s.badge, { backgroundColor: paymentColor(order.paymentStatus) + '15', borderColor: paymentColor(order.paymentStatus) + '30' }]}>
          <Text style={[s.badgeText, { color: paymentColor(order.paymentStatus) }]}>
            {order.paymentStatus.charAt(0).toUpperCase() + order.paymentStatus.slice(1)}
          </Text>
        </View>

        {/* Delivery */}
        <Text style={s.deliveryText} numberOfLines={1}>{order.deliveryMethod}</Text>

        <Feather name="chevron-right" size={14} color={MUTED} style={{ marginLeft: 'auto' }} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 12, paddingTop: 6, gap: 8 },
  title:  { fontSize: 28, fontFamily: 'Inter_700Bold', color: FG },
  subtitle:{ fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  iconBtn:{ width: 38, height: 38, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  searchWrap:  { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  searchInput: { flex: 1, paddingVertical: 11, paddingHorizontal: 10, fontSize: 14, fontFamily: 'Inter_400Regular', color: FG },

  summaryScroll: { flexGrow: 0, marginBottom: 4 },
  summaryRow:    { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  summaryCard:   { backgroundColor: CARD, borderRadius: 12, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', minWidth: 64 },
  summaryCount:  { fontSize: 20, fontFamily: 'Inter_700Bold' },
  summaryLabel:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 2 },

  filterScroll: { flexGrow: 0, marginVertical: 4 },
  filterRow:    { flexDirection: 'row', gap: 6, paddingHorizontal: 16 },
  filterTab:    { backgroundColor: CARD, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, borderWidth: 1, borderColor: BORDER },
  filterTabActive: { backgroundColor: GREEN + '22', borderColor: GREEN },
  filterText:   { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  filterTextActive: { color: GREEN },

  card:     { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 8 },
  cardTop:  { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardLeft: { flex: 1 },
  cardRight:{ alignItems: 'flex-end' },
  orderNum: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  orderCustomer: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  orderTotal: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  orderDate:  { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  cardMeta:   { },
  orderItems: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 16 },
  cardBadges: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  badge:       { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1 },
  badgeDot:    { width: 5, height: 5, borderRadius: 2.5 },
  badgeText:   { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  deliveryText:{ fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },

  emptyCard:  { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: FG },
  emptyDesc:  { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center', maxWidth: 260 },
});
