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
import { StatCard } from '@/components/StatCard';
import { SectionHeader } from '@/components/SectionHeader';
import { Badge } from '@/components/Badge';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const QUICK_ACTIONS = [
  { label: 'Add Product', icon: 'plus-circle' as const, route: '/products' },
  { label: 'AI Studio', icon: 'zap' as const, route: '/ai-studio' },
  { label: 'Campaign', icon: 'send' as const, route: '/marketing' },
  { label: 'AI Chat', icon: 'message-circle' as const, route: '/ai-assistant' },
];

const RECENT_ORDERS = [
  { id: '#5041', customer: 'Jordan Lee', amount: '$128.00', status: 'fulfilled' as const, time: '2m ago' },
  { id: '#5040', customer: 'Maya Chen', amount: '$256.50', status: 'processing' as const, time: '18m ago' },
  { id: '#5039', customer: 'Amir Patel', amount: '$89.00', status: 'fulfilled' as const, time: '1h ago' },
  { id: '#5038', customer: 'Sofia Reyes', amount: '$312.00', status: 'shipped' as const, time: '3h ago' },
  { id: '#5037', customer: 'Elijah Brooks', amount: '$74.50', status: 'cancelled' as const, time: '5h ago' },
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

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  function handleQuickAction(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good morning 👋</Text>
          <Text style={[styles.brand, { color: colors.foreground }]}>Brandthread</Text>
        </View>
        <TouchableOpacity
          style={[styles.avatar, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/team')}
          activeOpacity={0.8}
        >
          <Text style={[styles.avatarText, { color: colors.primaryForeground }]}>AT</Text>
        </TouchableOpacity>
      </View>

      {/* Revenue Card */}
      <LinearGradient
        colors={['#2A2010', '#1A1500']}
        style={[styles.revenueCard, { borderColor: '#C9A96E44' }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.revenueHeader}>
          <Text style={[styles.revenueLabel, { color: '#C9A96E99' }]}>Revenue Today</Text>
          <View style={[styles.revenueBadge, { backgroundColor: '#22C55E22' }]}>
            <Text style={[styles.revenueBadgeText, { color: colors.success }]}>↑ 18.4%</Text>
          </View>
        </View>
        <Text style={[styles.revenueAmount, { color: '#C9A96E' }]}>$4,892.50</Text>
        <Text style={[styles.revenueSubtitle, { color: '#C9A96E66' }]}>This week: $28,450 · This month: $94,200</Text>
      </LinearGradient>

      {/* Stats Row */}
      <View style={styles.statsRow}>
        <StatCard label="Orders" value="12" change="3 today" positive icon="shopping-bag" />
        <StatCard label="Products" value="847" change="5 new" positive icon="box" />
        <StatCard label="Customers" value="1.2k" change="12 new" positive icon="users" />
      </View>

      {/* Quick Actions */}
      <SectionHeader title="Quick Actions" />
      <View style={styles.quickGrid}>
        {QUICK_ACTIONS.map((qa) => (
          <TouchableOpacity
            key={qa.label}
            style={[styles.quickBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => handleQuickAction(qa.route)}
            activeOpacity={0.75}
          >
            <View style={[styles.quickIcon, { backgroundColor: '#C9A96E22' }]}>
              <Feather name={qa.icon} size={20} color={colors.primary} />
            </View>
            <Text style={[styles.quickLabel, { color: colors.foreground }]}>{qa.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Recent Orders */}
      <SectionHeader title="Recent Orders" action="View all" onAction={() => router.push('/analytics')} />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {RECENT_ORDERS.map((order, i) => {
          const s = statusMap[order.status];
          return (
            <View key={order.id} style={[styles.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.orderLeft}>
                <Text style={[styles.orderId, { color: colors.primary }]}>{order.id}</Text>
                <Text style={[styles.orderCustomer, { color: colors.mutedForeground }]}>{order.customer}</Text>
              </View>
              <View style={styles.orderRight}>
                <Text style={[styles.orderAmount, { color: colors.foreground }]}>{order.amount}</Text>
                <Badge label={s.label} variant={s.variant} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Low Stock Alerts */}
      <SectionHeader title="Low Stock Alerts" action="Manage" onAction={() => router.push('/products')} />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {LOW_STOCK.map((item, i) => (
          <View key={item.name} style={[styles.stockRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <Feather name="alert-triangle" size={14} color={colors.warning} />
            <Text style={[styles.stockName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.stockQty, { color: colors.warning }]}>{item.stock} left</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  greeting: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  brand: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  revenueCard: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  revenueHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  revenueLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  revenueBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  revenueBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  revenueAmount: { fontSize: 40, fontFamily: 'Inter_700Bold', letterSpacing: -1 },
  revenueSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  quickBtn: { width: '47%', borderRadius: 12, padding: 14, alignItems: 'center', gap: 8, borderWidth: 1 },
  quickIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  orderRow: { flexDirection: 'row', alignItems: 'center', padding: 14, justifyContent: 'space-between' },
  orderLeft: { gap: 2 },
  orderId: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orderCustomer: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  orderAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  stockRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  stockName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  stockQty: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});
