import React from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/Badge';
import { SectionHeader } from '@/components/SectionHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const STATS = [
  { label: 'Orders', value: '12', change: '+3 today', icon: 'shopping-bag' as const, up: true },
  { label: 'Products', value: '847', change: '+5 new', icon: 'box' as const, up: true },
  { label: 'Customers', value: '1.2k', change: '+12 new', icon: 'users' as const, up: true },
  { label: 'Returns', value: '2', change: '-1 vs avg', icon: 'refresh-cw' as const, up: true },
];

const QUICK_ACTIONS = [
  { label: 'Add Product', icon: 'plus-circle' as const, route: '/products' },
  { label: 'AI Studio', icon: 'zap' as const, route: '/ai-studio' },
  { label: 'Campaign', icon: 'send' as const, route: '/marketing' },
  { label: 'AI Chat', icon: 'message-circle' as const, route: '/ai-assistant' },
  { label: 'Shipping', icon: 'truck' as const, route: '/shipping' },
  { label: 'Finance', icon: 'bar-chart-2' as const, route: '/finance' },
];

const RECENT_ORDERS = [
  { id: '#5041', customer: 'Jordan Lee', amount: '$128.00', status: 'fulfilled' as const, time: '2m ago' },
  { id: '#5040', customer: 'Maya Chen', amount: '$256.50', status: 'processing' as const, time: '18m ago' },
  { id: '#5039', customer: 'Amir Patel', amount: '$89.00', status: 'fulfilled' as const, time: '1h ago' },
  { id: '#5038', customer: 'Sofia Reyes', amount: '$312.00', status: 'shipped' as const, time: '3h ago' },
];

const LOW_STOCK = [
  { name: 'Classic Tee – White XL', stock: 3 },
  { name: 'Cargo Shorts – Khaki M', stock: 1 },
  { name: 'Hoodie – Black S', stock: 7 },
];

const statusMap: Record<string, { variant: 'success' | 'info' | 'warning' | 'error'; label: string }> = {
  fulfilled: { variant: 'success', label: 'Fulfilled' },
  processing: { variant: 'warning', label: 'Processing' },
  shipped: { variant: 'info', label: 'Shipped' },
  cancelled: { variant: 'error', label: 'Cancelled' },
};

// Mini sparkline dots for revenue card
const SPARK = [40, 55, 48, 72, 60, 80, 68, 95, 78, 100];

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 20, paddingBottom: 140 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─── Header ─── */}
      <View style={[styles.header, { paddingHorizontal: 20 }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good morning 👋</Text>
          <Text style={[styles.brand, { color: colors.foreground }]}>Brandthread</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={18} color={colors.mutedForeground} />
            <View style={[styles.notifDot, { backgroundColor: colors.destructive }]} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.avatar, { backgroundColor: colors.primary }]}
            onPress={() => nav('/team')}
            activeOpacity={0.8}
          >
            <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>AT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ─── Revenue Hero ─── */}
      <View style={{ paddingHorizontal: 20 }}>
        <LinearGradient
          colors={['#2A2010', '#1C1800', '#0D0D0D']}
          style={[styles.revenueCard, { borderColor: '#C9A96E33' }]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.revenueTop}>
            <Text style={[styles.revenueLabel, { color: '#C9A96E88' }]}>REVENUE TODAY</Text>
            <View style={[styles.revenuePill, { backgroundColor: '#22C55E1A', borderColor: '#22C55E33' }]}>
              <Feather name="trending-up" size={11} color={colors.success} />
              <Text style={[styles.revenuePillText, { color: colors.success }]}>18.4%</Text>
            </View>
          </View>

          <Text style={[styles.revenueAmount, { color: '#C9A96E' }]}>$4,892.50</Text>
          <Text style={[styles.revenueSub, { color: '#C9A96E55' }]}>
            This week: $28,450 · This month: $94,200
          </Text>

          {/* Sparkline */}
          <View style={styles.sparkRow}>
            {SPARK.map((h, i) => (
              <View
                key={i}
                style={[
                  styles.sparkBar,
                  {
                    height: (h / 100) * 36,
                    backgroundColor:
                      i === SPARK.length - 1 ? '#C9A96E' : i > SPARK.length - 4 ? '#C9A96E66' : '#C9A96E22',
                    borderRadius: 2,
                  },
                ]}
              />
            ))}
          </View>
        </LinearGradient>
      </View>

      {/* ─── Stats (horizontal scroll) ─── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.statsScroll}
        style={{ marginTop: 16 }}
      >
        {STATS.map((s, i) => (
          <View
            key={s.label}
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              i === 0 && { marginLeft: 20 },
              i === STATS.length - 1 && { marginRight: 20 },
            ]}
          >
            <View style={[styles.statIconWrap, { backgroundColor: '#C9A96E15' }]}>
              <Feather name={s.icon} size={16} color={colors.primary} />
            </View>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            <Text style={[styles.statChange, { color: s.up ? colors.success : colors.destructive }]}>
              {s.change}
            </Text>
          </View>
        ))}
      </ScrollView>

      {/* ─── Quick Actions (horizontal chips) ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
        <SectionHeader title="Quick Actions" />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.actionsScroll}
      >
        {QUICK_ACTIONS.map((qa, i) => (
          <TouchableOpacity
            key={qa.label}
            style={[
              styles.actionChip,
              { backgroundColor: colors.card, borderColor: colors.border },
              i === 0 && { marginLeft: 20 },
              i === QUICK_ACTIONS.length - 1 && { marginRight: 20 },
            ]}
            onPress={() => nav(qa.route)}
            activeOpacity={0.75}
          >
            <View style={[styles.chipIcon, { backgroundColor: '#C9A96E15' }]}>
              <Feather name={qa.icon} size={16} color={colors.primary} />
            </View>
            <Text style={[styles.chipLabel, { color: colors.foreground }]}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ─── Recent Orders ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: 32 }}>
        <SectionHeader title="Recent Orders" action="View all" onAction={() => nav('/analytics')} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {RECENT_ORDERS.map((order, i) => {
            const s = statusMap[order.status];
            return (
              <View
                key={order.id}
                style={[
                  styles.orderRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                ]}
              >
                {/* Left gold accent bar */}
                <View style={[styles.orderAccent, { backgroundColor: colors.primary }]} />
                <View style={styles.orderLeft}>
                  <Text style={[styles.orderId, { color: colors.primary }]}>{order.id}</Text>
                  <Text style={[styles.orderCustomer, { color: colors.mutedForeground }]}>
                    {order.customer}
                  </Text>
                  <Text style={[styles.orderTime, { color: colors.mutedForeground }]}>{order.time}</Text>
                </View>
                <View style={styles.orderRight}>
                  <Text style={[styles.orderAmount, { color: colors.foreground }]}>{order.amount}</Text>
                  <Badge label={s.label} variant={s.variant} />
                </View>
              </View>
            );
          })}
        </View>
      </View>

      {/* ─── Low Stock ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
        <SectionHeader title="Low Stock Alerts" action="Manage" onAction={() => nav('/products')} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {LOW_STOCK.map((item, i) => (
            <View
              key={item.name}
              style={[
                styles.stockRow,
                i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
              ]}
            >
              <View style={[styles.stockIcon, { backgroundColor: '#F59E0B15' }]}>
                <Feather name="alert-triangle" size={13} color={colors.warning} />
              </View>
              <Text style={[styles.stockName, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.stockBadge, { backgroundColor: item.stock <= 3 ? '#EF444415' : '#F59E0B15' }]}>
                <Text style={[styles.stockQty, { color: item.stock <= 3 ? colors.destructive : colors.warning }]}>
                  {item.stock} left
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  greeting: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  brand: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: '#0D0D0D' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },

  // Revenue
  revenueCard: { borderRadius: 20, padding: 22, borderWidth: 1 },
  revenueTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  revenueLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 1 },
  revenuePill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  revenuePillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  revenueAmount: { fontSize: 44, fontFamily: 'Inter_700Bold', letterSpacing: -1.5 },
  revenueSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, marginBottom: 16 },
  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 36 },
  sparkBar: { flex: 1 },

  // Stats
  statsScroll: { gap: 10, paddingVertical: 2 },
  statCard: { width: 120, borderRadius: 16, padding: 16, borderWidth: 1, gap: 4, marginHorizontal: 0 },
  statIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  statChange: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  // Quick Actions
  actionsScroll: { gap: 10, paddingVertical: 2 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  chipIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Orders
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  orderRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  orderAccent: { width: 3, height: 36, borderRadius: 2 },
  orderLeft: { flex: 1, gap: 2 },
  orderId: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orderCustomer: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  orderAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  // Stock
  stockRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  stockIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stockName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  stockQty: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
