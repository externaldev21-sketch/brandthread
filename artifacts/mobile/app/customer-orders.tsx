/**
 * Customer Orders — full order history for a specific customer.
 * Route: /customer-orders?customerId=<uuid>
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { useUser } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { isSellerDevPreview } from '@/lib/devPreview';
import { usePreviewDemoMode } from '@/hooks/usePreviewDemoMode';
import { getPreviewCustomerDetail } from '@/lib/previewCustomers';
import { ordersLabel } from '@/lib/sellerCustomers';
import { FILL_ELEVATED, FONT, FS, TABULAR, TEXT } from '@/lib/theme';
import { radius } from '@/constants/radii';

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
  itemCount?: number;
};

// Shopify order-history chips ("Fulfilled", "Partially refunded"), in silver.
const STATUS_LABEL: Record<string, string> = {
  delivered:  'Delivered',
  fulfilled:  'Fulfilled',
  shipped:    'Shipped',
  processing: 'Unfulfilled',
  pending:    'Unfulfilled',
  cancelled:  'Cancelled',
};

function orderMetaLine(name: string | undefined, order: Order): string {
  const date = new Date(order.createdAt);
  const when = `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()}`;
  const items = order.itemCount ? `${order.itemCount} item${order.itemCount === 1 ? '' : 's'}` : null;
  return [name, items, when].filter(Boolean).join(' • ');
}

function cents(c: number) {
  return formatCents(c);
}

export default function CustomerOrdersScreen() {
  const router = useRouter();
  const colors = useColors();
  const api = useApi();
  const { user, isLoaded: clerkLoaded } = useUser();
  const { customerId } = useLocalSearchParams<{ customerId: string }>();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  // Seller web preview can't call the API (lib/api.ts rejects every request
  // there): &demo=1 reads the demo customer behind the demo Orders tab.
  const [isPreviewMode] = useState(() => isSellerDevPreview());
  const previewDemo = usePreviewDemoMode();

  useEffect(() => {
    requestGeneration.current += 1;
    setCustomer(null);
    setOrders([]);
    setError(null);
    setLoading(!clerkLoaded);
  }, [clerkLoaded, user?.id, customerId]);

  const load = useCallback(async () => {
    if (isPreviewMode) {
      const detail = customerId ? getPreviewCustomerDetail(String(customerId), previewDemo) : null;
      setCustomer(detail ? (detail.customer as Customer) : null);
      setOrders(detail ? detail.orders : []);
      setError(detail ? null : 'unavailable');
      setLoading(false);
      return;
    }
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
  }, [api, customerId, clerkLoaded, user?.id, isPreviewMode, previewDemo]);

  useFocusEffect(useCallback(() => {
    if (isPreviewMode) { void load(); return; }
    if (!clerkLoaded || !user?.id || !customerId) {
      setCustomer(null);
      setOrders([]);
      setLoading(!clerkLoaded);
      return;
    }
    setLoading(true);
    load();
  }, [load, clerkLoaded, user?.id, customerId, isPreviewMode]));

  return (
    <View style={s.root}>
      <ScreenHeader title={customer?.name ?? 'Customer Orders'} onBack={() => goBackOr(router, '/customers')} />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={[s.errorText, { color: colors.foreground }]}>
            Couldn't load this customer. Check your connection and try again.
          </Text>
          <Button label="Retry" variant="secondary" size="small" style={s.retryBtn} onPress={() => { setLoading(true); load(); }} />
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
                  <Text style={[s.custName, { color: colors.foreground }]}>{customer.name}</Text>
                  <Text style={[s.custEmail, { color: colors.mutedForeground }]}>{customer.email}</Text>
                  {customer.phone ? <Text style={[s.custEmail, { color: colors.mutedForeground }]}>{customer.phone}</Text> : null}
                </View>
              </View>

              {/* Stats */}
              <View style={[s.statsRow, { borderColor: colors.border }]}>
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
                    <View key={tag} style={s.tag}>
                      <Text style={[s.tagText, { color: colors.foreground }]}>{tag}</Text>
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

          {/* Order history — Shopify: "Order history / N orders", then rows of
              "#1001 … $24.99", "Name • 1 item • date", status chip. */}
          <View>
            <Text style={[TEXT.headline, { color: colors.foreground }]}>Order history</Text>
            <Text style={[TEXT.footnote, { color: colors.mutedForeground, marginTop: 2 }]}>{ordersLabel(orders.length)}</Text>
          </View>
          {orders.length === 0 ? (
            <EmptyState title="No orders yet." />
          ) : (
            <View>
              {orders.map((order, i) => (
                <TouchableOpacity
                  key={order.id}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/order-detail?id=${encodeURIComponent(order.id)}` as never)}
                  style={[s.orderRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Order ${order.orderNumber}`}
                >
                  <View style={s.orderTop}>
                    <Text style={[TEXT.headline, { color: colors.foreground }]} numberOfLines={1}>#{order.orderNumber}</Text>
                    <Text style={[TEXT.subhead, TABULAR, { color: colors.foreground }]}>{cents(order.totalCents)}</Text>
                  </View>
                  <Text style={[TEXT.footnote, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {orderMetaLine(customer?.name, order)}
                  </Text>
                  {order.trackingNumber ? (
                    <Text style={[TEXT.footnote, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {order.carrier ? `${order.carrier} • ` : ''}{order.trackingNumber}
                    </Text>
                  ) : null}
                  <View style={s.statusChip}>
                    <Text style={[TEXT.caption, { color: order.status === 'cancelled' ? colors.mutedForeground : colors.foreground }]}>
                      {STATUS_LABEL[order.status] ?? order.status}
                    </Text>
                  </View>
                </TouchableOpacity>
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
  errorText:    { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: 24 },
  retryBtn:     { marginTop: 8 },

  custCard:     { gap: 16 },
  custAvatarRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  avatar:       { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText:   { fontSize: 16, fontFamily: FONT.bold },
  custName:     { fontSize: 16, fontFamily: FONT.bold },
  custEmail:    { fontSize: 12, fontFamily: FONT.regular },
  statsRow:     { flexDirection: 'row', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  stat:         { flex: 1, alignItems: 'center', gap: 2 },
  statVal:      { fontSize: 15, fontFamily: FONT.bold, ...TABULAR },
  statLabel:    { fontSize: FS.xs, fontFamily: FONT.regular },
  statDiv:      { width: 1, marginVertical: 4 },
  tagsRow:      { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag:          { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: FILL_ELEVATED },
  tagText:      { fontSize: 11, fontFamily: FONT.semibold },
  notes:        { fontSize: 12, fontFamily: FONT.regular, lineHeight: 18 },

  orderRow:     { paddingVertical: 14, gap: 4 },
  orderTop:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  statusChip:   { alignSelf: 'flex-start', backgroundColor: FILL_ELEVATED, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
});
