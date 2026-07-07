import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useColorScheme,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/Badge';
import { SectionHeader } from '@/components/SectionHeader';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

// ─── Static data ──────────────────────────────────────────────────────────────

const PERIODS = ['Today', '7D', '30D', '90D'] as const;
type Period = typeof PERIODS[number];

const OVERVIEW: Record<Period, { sessions: string; revenue: string; orders: string; conversion: string }> = {
  Today:  { sessions: '320',   revenue: '$4,892',  orders: '12',  conversion: '3.4%' },
  '7D':   { sessions: '2,180', revenue: '$28,450', orders: '84',  conversion: '3.9%' },
  '30D':  { sessions: '9,400', revenue: '$94,200', orders: '312', conversion: '3.4%' },
  '90D':  { sessions: '28.1k', revenue: '$284k',   orders: '940', conversion: '3.2%' },
};

// progress position of the range track thumb (0–1) per period
const TRACK_POS: Record<Period, number> = {
  Today: 0.08, '7D': 0.27, '30D': 0.55, '90D': 1,
};

const RECENT_ORDERS = [
  { id: '#5041', customer: 'Jordan Lee',  amount: '$128.00', status: 'fulfilled'  as const, time: '2m ago'  },
  { id: '#5040', customer: 'Maya Chen',   amount: '$256.50', status: 'processing' as const, time: '18m ago' },
  { id: '#5039', customer: 'Amir Patel',  amount: '$89.00',  status: 'fulfilled'  as const, time: '1h ago'  },
  { id: '#5038', customer: 'Sofia Reyes', amount: '$312.00', status: 'shipped'    as const, time: '3h ago'  },
];

const LOW_STOCK = [
  { name: 'Classic Tee – White XL',  stock: 3 },
  { name: 'Cargo Shorts – Khaki M',  stock: 1 },
  { name: 'Hoodie – Black S',         stock: 7 },
];

const QUICK_ACTIONS = [
  { label: 'Add Product', icon: 'plus-circle'    as const, route: '/products'     },
  { label: 'AI Studio',   icon: 'zap'            as const, route: '/ai-studio'    },
  { label: 'Campaign',    icon: 'send'           as const, route: '/marketing'    },
  { label: 'AI Chat',     icon: 'message-circle' as const, route: '/ai-assistant' },
  { label: 'Shipping',    icon: 'truck'          as const, route: '/shipping'     },
  { label: 'Finance',     icon: 'bar-chart-2'    as const, route: '/finance'      },
];

const ANALYTICS_METRICS = [
  { label: 'Avg. Order Value', value: '$128',  change: '+$12',  up: true,  icon: 'dollar-sign' as const },
  { label: 'Returning Rate',   value: '42%',   change: '+4%',   up: true,  icon: 'refresh-cw'  as const },
  { label: 'CLV',              value: '$480',  change: '+$30',  up: true,  icon: 'heart'        as const },
  { label: 'Return Rate',      value: '1.4%',  change: '-0.2%', up: true,  icon: 'trending-up'  as const },
];

const statusMap: Record<string, { variant: 'success' | 'info' | 'warning' | 'error'; label: string }> = {
  fulfilled:  { variant: 'success', label: 'Fulfilled'  },
  processing: { variant: 'warning', label: 'Processing' },
  shipped:    { variant: 'info',    label: 'Shipped'    },
  cancelled:  { variant: 'error',   label: 'Cancelled'  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatColumn({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={[statColStyles.col, !last && { borderRightWidth: 1, borderRightColor: colors.border }]}>
      {/* dotted-underline label */}
      <Text style={[statColStyles.label, { color: colors.mutedForeground, borderBottomColor: colors.mutedForeground + '60' }]}>
        {label}
      </Text>
      <View style={statColStyles.valueRow}>
        <Text style={[statColStyles.value, { color: colors.foreground }]}>{value}</Text>
        <Text style={[statColStyles.dash, { color: colors.mutedForeground }]}> —</Text>
      </View>
    </View>
  );
}

const statColStyles = StyleSheet.create({
  col:      { flex: 1, paddingVertical: 14, paddingHorizontal: 12, gap: 4 },
  label:    { fontSize: 11, fontFamily: 'Inter_500Medium', borderBottomWidth: 1, alignSelf: 'flex-start', paddingBottom: 1, marginBottom: 3 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },
  value:    { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  dash:     { fontSize: 14, fontFamily: 'Inter_400Regular' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors  = useColors();
  const scheme  = useColorScheme();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const isDark  = scheme !== 'light';
  const topPad  = Platform.OS === 'web' ? 67 : insets.top;

  const [period, setPeriod] = useState<Period>('30D');
  const ov = OVERVIEW[period];

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  const primary    = isDark ? '#9F7AEA' : '#7C3AED';
  const trackFill  = isDark ? '#6D28D9' : '#7C3AED';
  const trackBg    = isDark ? '#2D2D3F' : '#E5E7EB';
  const thumbPos   = TRACK_POS[period];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: 140 }}
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
            style={[styles.avatar, { backgroundColor: primary }]}
            onPress={() => nav('/team')}
            activeOpacity={0.8}
          >
            <Text style={styles.avatarText}>AT</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ─── Period Pills ─── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.periodScroll}
        style={{ marginTop: 16 }}
      >
        {PERIODS.map((p, i) => {
          const active = p === period;
          return (
            <TouchableOpacity
              key={p}
              onPress={() => { Haptics.selectionAsync(); setPeriod(p); }}
              activeOpacity={0.75}
              style={[
                styles.periodChip,
                {
                  backgroundColor: active ? colors.foreground : colors.card,
                  borderColor: active ? colors.foreground : colors.border,
                },
                i === 0 && { marginLeft: 20 },
                i === PERIODS.length - 1 && { marginRight: 20 },
              ]}
            >
              <Text style={[styles.periodText, { color: active ? colors.background : colors.mutedForeground }]}>
                {p}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ─── Shopify-style Overview Card ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: 14 }}>
        <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* 4-column stats row */}
          <View style={styles.statsRow}>
            <StatColumn label="Sessions"  value={ov.sessions}   />
            <StatColumn label="Revenue"   value={ov.revenue}    />
            <StatColumn label="Orders"    value={ov.orders}     />
            <StatColumn label="Conv. rate" value={ov.conversion} last />
          </View>

          {/* Range track + chevron */}
          <View style={[styles.trackRow, { borderTopColor: colors.border }]}>
            <View style={[styles.track, { backgroundColor: trackBg }]}>
              <View style={[styles.trackFill, { width: `${thumbPos * 100}%`, backgroundColor: trackFill }]} />
              <View style={[styles.trackThumb, { left: `${thumbPos * 100}%` as any, borderColor: colors.card, backgroundColor: trackFill }]} />
            </View>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} style={{ marginLeft: 10 }} />
          </View>
        </View>
      </View>

      {/* ─── Quick Actions ─── */}
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
            <View style={[styles.chipIcon, { backgroundColor: colors.secondary }]}>
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
                style={[styles.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              >
                <View style={[styles.orderAccent, { backgroundColor: primary }]} />
                <View style={styles.orderLeft}>
                  <Text style={[styles.orderId, { color: primary }]}>{order.id}</Text>
                  <Text style={[styles.orderMeta, { color: colors.mutedForeground }]}>
                    {order.customer} · {order.time}
                  </Text>
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
        <SectionHeader title="Low Stock" action="Manage" onAction={() => nav('/products')} />
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {LOW_STOCK.map((item, i) => (
            <View
              key={item.name}
              style={[styles.stockRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
            >
              <View style={[styles.stockIcon, {
                backgroundColor: item.stock <= 3 ? `${colors.destructive}18` : `${colors.warning}18`,
              }]}>
                <Feather
                  name="alert-triangle"
                  size={13}
                  color={item.stock <= 3 ? colors.destructive : colors.warning}
                />
              </View>
              <Text style={[styles.stockName, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.stockBadge, {
                backgroundColor: item.stock <= 3 ? `${colors.destructive}15` : `${colors.warning}15`,
              }]}>
                <Text style={[styles.stockQty, {
                  color: item.stock <= 3 ? colors.destructive : colors.warning,
                }]}>
                  {item.stock} left
                </Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* ─── Analytics Snapshot ─── */}
      <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
        <SectionHeader title="Analytics" action="View all" onAction={() => nav('/analytics')} />
        <View style={styles.metricsGrid}>
          {ANALYTICS_METRICS.map((m) => (
            <View
              key={m.label}
              style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Feather name={m.icon} size={15} color={primary} />
              <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.value}</Text>
              <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
              <Text style={[styles.metricChange, { color: m.up ? colors.success : colors.destructive }]}>
                {m.change}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  greeting:    { fontSize: 13, fontFamily: 'Inter_400Regular' },
  brand:       { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn:     { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot:    { position: 'absolute', top: 9, right: 9, width: 6, height: 6, borderRadius: 3 },
  avatar:      { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },

  periodScroll: { gap: 8, paddingVertical: 2 },
  periodChip:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  periodText:   { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Shopify-style overview card
  overviewCard: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  statsRow:     { flexDirection: 'row' },
  trackRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1 },
  track:        { flex: 1, height: 4, borderRadius: 2, overflow: 'visible', position: 'relative', justifyContent: 'center' },
  trackFill:    { height: 4, borderRadius: 2 },
  trackThumb:   { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, borderWidth: 2 },

  actionsScroll: { gap: 10, paddingVertical: 2 },
  actionChip:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1 },
  chipIcon:      { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  chipLabel:     { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  card:          { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  orderRow:      { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  orderAccent:   { width: 3, height: 36, borderRadius: 2 },
  orderLeft:     { flex: 1, gap: 3 },
  orderId:       { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orderMeta:     { fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderRight:    { alignItems: 'flex-end', gap: 5 },
  orderAmount:   { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  stockRow:   { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  stockIcon:  { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stockName:  { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  stockQty:   { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  metricsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard:   { width: '47.5%', borderRadius: 12, padding: 14, borderWidth: 1, gap: 3 },
  metricValue:  { fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 4 },
  metricLabel:  { fontSize: 11, fontFamily: 'Inter_400Regular' },
  metricChange: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});
