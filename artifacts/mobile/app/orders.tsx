import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, TextInput,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Badge } from '@/components/Badge';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderStatus = 'pending' | 'production' | 'shipped' | 'delivered' | 'refunded';

interface Order {
  id: string;
  customer: string;
  initials: string;
  email: string;
  items: string[];
  total: string;
  status: OrderStatus;
  date: string;
  fulfillment: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const ORDERS: Order[] = [
  {
    id: '#BT-78291',
    customer: 'Jonah B.',
    initials: 'JB',
    email: 'jonah.b@gmail.com',
    items: ['Midnight Hoodie – Black – L', 'Logo Cap – One Size'],
    total: '$129.99',
    status: 'shipped',
    date: 'Jul 12, 2026',
    fulfillment: 'Standard — Est. Jul 16',
  },
  {
    id: '#BT-78290',
    customer: 'Lucas M.',
    initials: 'LM',
    email: 'lucas.m@icloud.com',
    items: ['Archive Tee Vol.3 – White – M'],
    total: '$89.99',
    status: 'production',
    date: 'Jul 11, 2026',
    fulfillment: 'Preorder — Est. Jul 22',
  },
  {
    id: '#BT-78289',
    customer: 'David K.',
    initials: 'DK',
    email: 'd.kim@proton.me',
    items: ['Canvas Cargo Jacket – Olive – S', 'Heavyweight Crewneck – Sage – M'],
    total: '$159.99',
    status: 'pending',
    date: 'Jul 11, 2026',
    fulfillment: 'Standard — Pending',
  },
  {
    id: '#BT-78288',
    customer: 'Anthony L.',
    initials: 'AL',
    email: 'a.lee@outlook.com',
    items: ['Washed Denim Jacket – Indigo – L'],
    total: '$99.99',
    status: 'delivered',
    date: 'Jul 8, 2026',
    fulfillment: 'Delivered Jul 10',
  },
  {
    id: '#BT-78287',
    customer: 'Brandon G.',
    initials: 'BG',
    email: 'brandon.g@gmail.com',
    items: ['Vintage Washed Tee – Dusty Pink – S'],
    total: '$129.99',
    status: 'delivered',
    date: 'Jul 7, 2026',
    fulfillment: 'Delivered Jul 9',
  },
  {
    id: '#BT-78280',
    customer: 'Maya Chen',
    initials: 'MC',
    email: 'm.chen@gmail.com',
    items: ['Relaxed Cargo Pant – Stone – 30/32'],
    total: '$114.99',
    status: 'refunded',
    date: 'Jul 4, 2026',
    fulfillment: 'Refunded Jul 6',
  },
];

const FILTERS = ['All', 'Pending', 'Production', 'Shipped', 'Delivered', 'Refunded'] as const;
type Filter = typeof FILTERS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META: Record<OrderStatus, { label: string; variant: 'default' | 'warning' | 'info' | 'success' | 'error' }> = {
  pending:    { label: 'Pending',    variant: 'warning' },
  production: { label: 'Production', variant: 'info'    },
  shipped:    { label: 'Shipped',    variant: 'default' },
  delivered:  { label: 'Delivered',  variant: 'success' },
  refunded:   { label: 'Refunded',   variant: 'error'   },
};

function matchesFilter(order: Order, filter: Filter): boolean {
  if (filter === 'All') return true;
  return order.status === filter.toLowerCase();
}

function matchesSearch(order: Order, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    order.id.toLowerCase().includes(lower) ||
    order.customer.toLowerCase().includes(lower) ||
    order.email.toLowerCase().includes(lower)
  );
}

// ─── Summary stats ────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Total',      value: '184',     icon: 'shopping-bag' as const },
  { label: 'Revenue',    value: '$24.8k',  icon: 'dollar-sign'  as const },
  { label: 'In Transit', value: '18',      icon: 'truck'        as const },
  { label: 'Pending',    value: '7',       icon: 'clock'        as const },
];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerOrdersScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const [filter, setFilter]     = useState<Filter>('All');
  const [search, setSearch]     = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = ORDERS.filter(
    (o) => matchesFilter(o, filter) && matchesSearch(o, search),
  );

  function toggleExpand(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => (prev === id ? null : id));
  }

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Orders"
        subtitle={`${ORDERS.length} orders this month`}
        rightElement={
          <TouchableOpacity
            style={[s.exportBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.75}
            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
          >
            <Feather name="download" size={16} color={colors.foreground} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Summary stats ── */}
        <View style={[s.statsRow, { paddingHorizontal: 20, paddingTop: 20 }]}>
          {STATS.map((st) => (
            <View
              key={st.label}
              style={[s.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name={st.icon} size={14} color={colors.primary} />
              <Text style={[s.statVal, { color: colors.foreground }]}>{st.value}</Text>
              <Text style={[s.statLabel, { color: colors.mutedForeground }]}>{st.label}</Text>
            </View>
          ))}
        </View>

        {/* ── Search ── */}
        <View style={[s.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[s.searchInput, { color: colors.foreground }]}
            placeholder="Search by order, customer, or email..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* ── Status filters ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filters}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              activeOpacity={0.75}
              style={[
                s.filterChip,
                {
                  backgroundColor: filter === f ? colors.primary : colors.card,
                  borderColor:     filter === f ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  s.filterText,
                  { color: filter === f ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* ── Order list ── */}
        <View style={[s.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {visible.length === 0 ? (
            <View style={s.empty}>
              <Feather name="inbox" size={36} color={colors.mutedForeground} />
              <Text style={[s.emptyText, { color: colors.mutedForeground }]}>No orders found</Text>
            </View>
          ) : (
            visible.map((order, i) => {
              const meta   = STATUS_META[order.status];
              const isOpen = expanded === order.id;
              return (
                <TouchableOpacity
                  key={order.id}
                  activeOpacity={0.85}
                  onPress={() => toggleExpand(order.id)}
                  style={[s.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  {/* Avatar */}
                  <View style={[s.avatar, { backgroundColor: colors.secondary }]}>
                    <Text style={[s.avatarText, { color: colors.primary }]}>{order.initials}</Text>
                  </View>

                  {/* Main info */}
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={s.rowTop}>
                      <Text style={[s.orderId, { color: colors.mutedForeground }]}>{order.id}</Text>
                      <Text style={[s.orderTotal, { color: colors.foreground }]}>{order.total}</Text>
                    </View>
                    <Text style={[s.customer, { color: colors.foreground }]}>{order.customer}</Text>
                    <View style={s.rowBottom}>
                      <Text style={[s.date, { color: colors.mutedForeground }]}>{order.date}</Text>
                      <Badge label={meta.label} variant={meta.variant} />
                    </View>

                    {/* Expanded detail */}
                    {isOpen && (
                      <View style={[s.detail, { borderTopColor: colors.border }]}>
                        {/* Items */}
                        <Text style={[s.detailHeading, { color: colors.mutedForeground }]}>Items</Text>
                        {order.items.map((item) => (
                          <Text key={item} style={[s.detailLine, { color: colors.foreground }]}>• {item}</Text>
                        ))}

                        {/* Fulfillment */}
                        <Text style={[s.detailHeading, { color: colors.mutedForeground, marginTop: 10 }]}>Fulfillment</Text>
                        <Text style={[s.detailLine, { color: colors.foreground }]}>{order.fulfillment}</Text>

                        {/* Actions */}
                        <View style={s.actions}>
                          <TouchableOpacity
                            style={[s.actionBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                            activeOpacity={0.75}
                            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                          >
                            <Feather name="printer" size={13} color={colors.foreground} />
                            <Text style={[s.actionText, { color: colors.foreground }]}>Print Label</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[s.actionBtn, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                            activeOpacity={0.75}
                            onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                          >
                            <Feather name="message-circle" size={13} color={colors.foreground} />
                            <Text style={[s.actionText, { color: colors.foreground }]}>Message</Text>
                          </TouchableOpacity>

                          {order.status === 'production' && (
                            <TouchableOpacity
                              style={[s.actionBtnPrimary, { backgroundColor: colors.primary }]}
                              activeOpacity={0.85}
                              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
                            >
                              <Feather name="truck" size={13} color={colors.primaryForeground} />
                              <Text style={[s.actionTextPrimary, { color: colors.primaryForeground }]}>Mark Shipped</Text>
                            </TouchableOpacity>
                          )}

                          {order.status === 'pending' && (
                            <TouchableOpacity
                              style={[s.actionBtnPrimary, { backgroundColor: colors.primary }]}
                              activeOpacity={0.85}
                              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
                            >
                              <Feather name="check" size={13} color={colors.primaryForeground} />
                              <Text style={[s.actionTextPrimary, { color: colors.primaryForeground }]}>Confirm Order</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    )}
                  </View>

                  {/* Chevron */}
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.mutedForeground}
                    style={{ alignSelf: 'flex-start', marginTop: 2 }}
                  />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },

  exportBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: {
    flex: 1, borderRadius: 12, padding: 10,
    borderWidth: 1, alignItems: 'center', gap: 4,
  },
  statVal:   { fontSize: 14, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 20, marginBottom: 12,
    borderRadius: 12, padding: 12, gap: 10, borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },

  filters: { paddingHorizontal: 20, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1,
  },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  listCard: {
    marginHorizontal: 20, borderRadius: 16, borderWidth: 1, overflow: 'hidden',
  },

  row: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 14, gap: 12,
  },

  avatar: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },

  rowTop:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId:   { fontSize: 11, fontFamily: 'Inter_500Medium' },
  orderTotal:{ fontSize: 15, fontFamily: 'Inter_700Bold' },
  customer:  { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date:      { fontSize: 12, fontFamily: 'Inter_400Regular' },

  detail: { borderTopWidth: 1, marginTop: 12, paddingTop: 12, gap: 3 },
  detailHeading: {
    fontSize: 10, fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 2,
  },
  detailLine: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1,
  },
  actionText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  actionBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
  },
  actionTextPrimary: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  empty: { padding: 48, alignItems: 'center', gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
});
