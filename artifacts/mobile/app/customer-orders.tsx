/**
 * Customer Orders — full order history for a specific customer.
 * Route: /customer-orders?customerId=<uuid>
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { FS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { StatusBadge } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { useUser } from '@clerk/expo';
import { Header } from '@/components/layout';

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
  return formatCents(c);
}

export default function CustomerOrdersScreen() {
  const colors = useColors();
  const api = useApi();
  const { user, isLoaded: clerkLoaded } = useUser();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);

  useEffect(() => {
    requestGeneration.current += 1;
    setCustomer(null);
    setOrders([]);
    setError(null);
    setLoading(!clerkLoaded);
  }, [clerkLoaded, user?.id, customerId]);

  const load = useCallback(async () => {
    if (!customerId || !clerkLoaded || !user?.id) return;
    const generation = ++requestGeneration.current;
    try {
      setError(null);
      const [cust, ords] = await Promise.all([
        api.customers.get(customerId),
        api.customers.orders(customerId),
      ]);
      if (requestGeneration.current !== generation) return;
      setCustomer(cust as Customer);
      setOrders(Array.isArray(ords) ? ords : []);
    } catch {
      if (requestGeneration.current !== generation) return;
      setError('unavailable');
    } finally {
      if (requestGeneration.current === generation) setLoading(false);
    }
  }, [api, customerId, clerkLoaded, user?.id]);

  useFocusEffect(useCallback(() => {
    if (!clerkLoaded || !user?.id || !customerId) {
      setCustomer(null);
      setOrders([]);
      setLoading(!clerkLoaded);
      return;
    }
    setLoading(true);
    load();
  }, [load, clerkLoaded, user?.id, customerId]));

  return (
    <View style={s.root}>
      <Header title={customer?.name ?? 'Customer Orders'} />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={28} color={colors.mutedForeground} />
          <Text style={[s.errorText, { color: colors.mutedForeground }]}>
            Couldn't load this customer. Check your connection and try again.
          </Text>
          <TouchableOpacity
            style={[s.retryBtn, { borderColor: colors.border }]}
            onPress={() => { setLoading(true); load(); }}
            activeOpacity={0.7}
          >
            <Text style={[s.retryText, { color: colors.foreground }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* Customer summary */}
          {customer && (
            <View style={[s.custCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={s.custAvatarRow}>
                <View style={[s.avatar, { backgroundColor: colors.accent }]}>
                  <Text style={[s.avatarText, { color: colors.accentForeground }]}>
                    {customer.name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.custName, { color: colors.foreground }]}>{customer.name}</Text>
                  <Text style={[s.custEmail, { color: colors.mutedForeground }]}>{customer.email}</Text>
                  {customer.phone ? <Text style={[s.custEmail, { color: colors.mutedForeground }]}>{customer.phone}</Text> : null}
                </View>
              </View>

              {/* Stats */}
              <View style={[s.statsRow, { backgroundColor: colors.surface }]}>
                <View style={s.stat}>
                  <Text style={[s.statVal, { color: colors.foreground }]}>{orders.length}</Text>
                  <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Orders</Text>
                </View>
                <View style={[s.statDiv, { backgroundColor: colors.border }]} />
                <View style={s.stat}>
                  <Text style={[s.statVal, { color: colors.foreground }]}>{cents(customer.totalSpentCents)}</Text>
                  <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Total spent</Text>
                </View>
                <View style={[s.statDiv, { backgroundColor: colors.border }]} />
                <View style={s.stat}>
                  <Text style={[s.statVal, { color: colors.foreground }]}>
                    {customer.totalSpentCents > 0 && orders.length > 0
                      ? cents(Math.round(customer.totalSpentCents / orders.length))
                      : '—'}
                  </Text>
                  <Text style={[s.statLabel, { color: colors.mutedForeground }]}>Avg order</Text>
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
                <Text style={[s.notes, { color: colors.mutedForeground }]}>{customer.notes}</Text>
              ) : null}
            </View>
          )}

          {/* Orders list */}
          <Text style={[s.sectionTitle, { color: colors.mutedForeground }]}>Order History</Text>
          {orders.length === 0 ? (
            <View style={[s.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="inbox" size={28} color={colors.mutedForeground} />
              <Text style={[s.emptyText, { color: colors.mutedForeground }]}>No orders yet</Text>
            </View>
          ) : (
            <View style={[s.orderList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {orders.map((order, i) => (
                <View
                  key={order.id}
                  style={[s.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={s.orderLeft}>
                    <Text style={[s.orderNum, { color: colors.foreground }]}>#{order.orderNumber}</Text>
                    <Text style={[s.orderDate, { color: colors.mutedForeground }]}>
                      {new Date(order.createdAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </Text>
                    {order.trackingNumber ? (
                      <Text style={[s.trackingText, { color: colors.mutedForeground }]}>
                        {order.carrier ? `${order.carrier}: ` : ''}
                        {order.trackingNumber}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.orderRight}>
                    <Text style={[s.orderTotal, { color: colors.foreground }]}>{cents(order.totalCents)}</Text>
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
  root:         { flex: 1, backgroundColor: 'transparent' },
  scroll:       { padding: 16, paddingBottom: 100, gap: 16 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  errorText:    { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 24 },
  retryBtn:     { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 8, borderWidth: 1 },
  retryText:    { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  custCard:     { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  custAvatarRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 16, fontFamily: 'Inter_700Bold' },
  custName:     { fontSize: 16, fontFamily: 'Inter_700Bold' },
  custEmail:    { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statsRow:     { flexDirection: 'row', borderRadius: 10, padding: 12 },
  stat:         { flex: 1, alignItems: 'center', gap: 2 },
  statVal:      { fontSize: 15, fontFamily: 'Inter_700Bold' },
  statLabel:    { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
  statDiv:      { width: 1, marginVertical: 4 },
  tagsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagText:      { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  notes:        { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyCard:    { borderRadius: 14, borderWidth: 1, padding: 32, alignItems: 'center', gap: 8 },
  emptyText:    { fontSize: 14, fontFamily: 'Inter_400Regular' },
  orderList:    { borderRadius: 14, borderWidth: 1 },
  orderRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, gap: 12 },
  orderLeft:    { flex: 1, gap: 3 },
  orderNum:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  orderDate:    { fontSize: 11, fontFamily: 'Inter_400Regular' },
  trackingText: { fontSize: FS.xs, fontFamily: 'Inter_400Regular', fontStyle: 'italic' },
  orderRight:   { alignItems: 'flex-end', gap: 6 },
  orderTotal:   { fontSize: 14, fontFamily: 'Inter_700Bold' },
});
