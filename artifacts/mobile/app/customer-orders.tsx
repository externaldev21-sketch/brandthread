/**
 * Customer Orders — full order history for a specific customer.
 * Route: /customer-orders?customerId=<uuid>
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BG, CARD, SURFACE, BORDER, FG, MUTED, SUBTLE,
  SUCCESS,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useApi } from '@/lib/api';
import { StatusBadge } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';

type Customer = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  totalSpentCents: number;
  orderCount: number;
  tags?: string[];
  notes?: string;
  createdAt: string;
};

type Order = {
  id: string;
  orderNumber: string;
  status: string;
  totalCents: number;
  createdAt: string;
  trackingNumber?: string;
  carrier?: string;
};

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  delivered:  'success',
  fulfilled:  'success',
  shipped:    'info',
  processing: 'warning',
  pending:    'neutral',
  cancelled:  'error',
};

function cents(c: number) {
  return `$${(c / 100).toFixed(2)}`;
}

export default function CustomerOrdersScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!customerId) return;
    try {
      setError(null);
      const [cust, ords] = await Promise.all([
        api.customers.get(customerId),
        api.customers.orders(customerId),
      ]);
      setCustomer(cust as Customer);
      setOrders(Array.isArray(ords) ? ords : []);
    } catch {
      setOrders([]);
      setError('Could not load customer data.');
    } finally {
      setLoading(false);
    }
  }, [api, customerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[s.root, { paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={FG} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {customer?.name ?? 'Customer Orders'}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={32} color={MUTED} />
          <Text style={s.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={s.retryBtn}>
            <Text style={s.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Customer summary */}
          {customer && (
            <View style={s.custCard}>
              <View style={s.custAvatarRow}>
                <View style={[s.avatar, { backgroundColor: colors.accent }]}>
                  <Text style={[s.avatarText, { color: colors.accentForeground }]}>
                    {customer.name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.custName}>{customer.name}</Text>
                  <Text style={s.custEmail}>{customer.email}</Text>
                  {customer.phone ? <Text style={s.custEmail}>{customer.phone}</Text> : null}
                </View>
              </View>

              {/* Stats */}
              <View style={s.statsRow}>
                <View style={s.stat}>
                  <Text style={s.statVal}>{orders.length}</Text>
                  <Text style={s.statLabel}>Orders</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.stat}>
                  <Text style={s.statVal}>{cents(customer.totalSpentCents)}</Text>
                  <Text style={s.statLabel}>Total spent</Text>
                </View>
                <View style={s.statDiv} />
                <View style={s.stat}>
                  <Text style={s.statVal}>
                    {customer.totalSpentCents > 0 && orders.length > 0
                      ? cents(Math.round(customer.totalSpentCents / orders.length))
                      : '—'}
                  </Text>
                  <Text style={s.statLabel}>Avg order</Text>
                </View>
              </View>

              {/* Tags */}
              {customer.tags && customer.tags.length > 0 && (
                <View style={s.tagsRow}>
                  {customer.tags.map((tag) => (
                    <View key={tag} style={[s.tag, { backgroundColor: colors.accent }]}>
                      <Text style={[s.tagText, { color: colors.accentForeground }]}>{tag}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Notes */}
              {customer.notes ? (
                <Text style={s.notes}>{customer.notes}</Text>
              ) : null}
            </View>
          )}

          {/* Orders list */}
          <Text style={s.sectionTitle}>Order History</Text>
          {orders.length === 0 ? (
            <View style={s.emptyCard}>
              <Feather name="inbox" size={28} color={MUTED} />
              <Text style={s.emptyText}>No orders yet</Text>
            </View>
          ) : (
            <View style={s.orderList}>
              {orders.map((order, i) => (
                <View
                  key={order.id}
                  style={[s.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: BORDER }]}
                >
                  <View style={s.orderLeft}>
                    <Text style={s.orderNum}>#{order.orderNumber}</Text>
                    <Text style={s.orderDate}>
                      {new Date(order.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </Text>
                    {order.trackingNumber ? (
                      <Text style={s.trackingText}>
                        {order.carrier ? `${order.carrier}: ` : ''}
                        {order.trackingNumber}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.orderRight}>
                    <Text style={s.orderTotal}>{cents(order.totalCents)}</Text>
                    <StatusBadge
                      label={order.status}
                      variant={STATUS_VARIANT[order.status] ?? 'neutral'}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  headerTitle:  { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  scroll:       { padding: 16, paddingBottom: 100, gap: 16 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, textAlign: 'center' },
  retryBtn:     { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1, borderColor: BORDER },
  retryText:    { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },

  custCard:     { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 14 },
  custAvatarRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 16, fontFamily: 'Inter_700Bold' },
  custName:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  custEmail:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  statsRow:     { flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 10, padding: 12 },
  stat:         { flex: 1, alignItems: 'center', gap: 2 },
  statVal:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  statLabel:    { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  statDiv:      { width: 1, backgroundColor: BORDER, marginVertical: 4 },
  tagsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagText:      { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  notes:        { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },

  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyCard:    { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 32, alignItems: 'center', gap: 8 },
  emptyText:    { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED },
  orderList:    { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER },
  orderRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, gap: 12 },
  orderLeft:    { flex: 1, gap: 3 },
  orderNum:     { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  orderDate:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  trackingText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, fontStyle: 'italic' },
  orderRight:   { alignItems: 'flex-end', gap: 6 },
  orderTotal:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
});
