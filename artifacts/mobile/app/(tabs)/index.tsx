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
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import DateRangePicker, { DateRange, buildPresets } from '@/components/DateRangePicker';

// ─── Mock revenue data per period ────────────────────────────────────────────

const REVENUE_DATA: Record<string, { amount: string; context: string; growth: string; up: boolean }> = {
  today:     { amount: '$4,892.50', context: 'Yesterday: $3,240 · This week: $28,450', growth: '18.4%', up: true },
  yesterday: { amount: '$3,240.00', context: 'Day before: $3,080 · This week: $28,450', growth: '5.2%',  up: true },
  last7:     { amount: '$28,450',   context: 'Prev 7 days: $25,400 · This month: $94,200', growth: '12.0%', up: true },
  last30:    { amount: '$94,200',   context: 'Prev 30 days: $75,900 · YTD: $542,000',  growth: '24.1%', up: true },
  last90:    { amount: '$284,600',  context: 'Prev 90 days: $216,800 · YTD: $542,000', growth: '31.3%', up: true },
  thisMonth: { amount: '$94,200',   context: 'Last month: $78,400 · YTD: $542,000',    growth: '20.2%', up: true },
  lastMonth: { amount: '$78,400',   context: 'Month before: $85,200 · YTD: $448,000',  growth: '8.0%',  up: false },
  custom:    { amount: '$94,200',   context: 'Custom date range selected',              growth: '24.1%', up: true },
};

const SPARK: Record<string, number[]> = {
  today:     [32, 48, 41, 65, 55, 74, 60, 88, 72, 100],
  yesterday: [55, 60, 45, 70, 50, 65, 80, 55, 72, 90],
  last7:     [40, 55, 62, 48, 75, 68, 82, 70, 90, 100],
  last30:    [30, 45, 38, 60, 50, 70, 55, 78, 65, 100],
  last90:    [25, 35, 45, 40, 55, 50, 68, 72, 85, 100],
  thisMonth: [30, 45, 38, 60, 50, 70, 55, 78, 65, 100],
  lastMonth: [60, 80, 70, 90, 75, 85, 95, 100, 88, 82],
  custom:    [32, 48, 41, 65, 55, 74, 60, 88, 72, 100],
};

// ─── Static data ──────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Sessions',  value: '9,400', change: '+5% today', icon: 'eye'          as const, up: true },
  { label: 'Orders',    value: '12',    change: '+3 today',  icon: 'shopping-bag' as const, up: true },
  { label: 'Conv. Rate', value: '3.4%', change: '+0.6%',     icon: 'trending-up'  as const, up: true },
  { label: 'Returns',   value: '2',     change: '-1 vs avg', icon: 'refresh-cw'   as const, up: true },
];

const QUICK_ACTIONS = [
  { label: 'Add Product', icon: 'plus-circle'    as const, route: '/products'     },
  { label: 'AI Studio',   icon: 'zap'            as const, route: '/ai-studio'    },
  { label: 'Campaign',    icon: 'send'           as const, route: '/marketing'    },
  { label: 'AI Chat',     icon: 'message-circle' as const, route: '/ai-assistant' },
  { label: 'Shipping',    icon: 'truck'          as const, route: '/shipping'     },
  { label: 'Finance',     icon: 'bar-chart-2'    as const, route: '/finance'      },
];

const RECENT_ORDERS = [
  { id: '#5041', customer: 'Jordan Lee',   amount: '$128.00', status: 'fulfilled'  as const, time: '2m ago'  },
  { id: '#5040', customer: 'Maya Chen',    amount: '$256.50', status: 'processing' as const, time: '18m ago' },
  { id: '#5039', customer: 'Amir Patel',   amount: '$89.00',  status: 'fulfilled'  as const, time: '1h ago'  },
  { id: '#5038', customer: 'Sofia Reyes',  amount: '$312.00', status: 'shipped'    as const, time: '3h ago'  },
];

const LOW_STOCK = [
  { name: 'Classic Tee – White XL',   stock: 3 },
  { name: 'Cargo Shorts – Khaki M',   stock: 1 },
  { name: 'Hoodie – Black S',          stock: 7 },
];

const ANALYTICS_METRICS = [
  { label: 'Conversion Rate', value: '3.4%',  change: '+0.6%', up: true,  icon: 'trending-up'  as const },
  { label: 'Avg. Order Value', value: '$128',  change: '+$12',  up: true,  icon: 'dollar-sign'  as const },
  { label: 'Returning Rate',  value: '42%',   change: '+4%',   up: true,  icon: 'refresh-cw'   as const },
  { label: 'CLV',             value: '$480',  change: '+$30',  up: true,  icon: 'heart'         as const },
];

const statusMap: Record<string, { variant: 'success' | 'info' | 'warning' | 'error'; label: string }> = {
  fulfilled:  { variant: 'success', label: 'Fulfilled'  },
  processing: { variant: 'warning', label: 'Processing' },
  shipped:    { variant: 'info',    label: 'Shipped'    },
  cancelled:  { variant: 'error',   label: 'Cancelled'  },
};

// ─── Default range (last 30 days) ────────────────────────────────────────────

function defaultRange(): DateRange {
  const presets = buildPresets();
  const p = presets.find((x) => x.id === 'last30')!;
  const { start, end } = p.range();
  return { start, end, presetId: 'last30', label: 'Last 30 days' };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isDark = scheme !== 'light';

  const [pickerVisible, setPickerVisible] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const rev = REVENUE_DATA[range.presetId] ?? REVENUE_DATA.last30;
  const spark = SPARK[range.presetId] ?? SPARK.last30;

  // Mode-aware colours
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const heroGradient: readonly [string, string, string] = isDark
    ? ['#2A1060', '#130828', '#08080F']
    : ['#EDE9FE', '#C4B5FD', '#F4F0FF'];
  const heroAmountColor  = isDark ? '#FFFFFF'    : '#4C1D95';
  const heroLabelColor   = isDark ? '#C4B5FDA0'  : '#7C3AED99';
  const heroSubColor     = isDark ? '#C4B5FD55'  : '#9F7AEA77';
  const heroBorderColor  = isDark ? '#9F7AEA22'  : '#DDD6FE';

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openPicker() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPickerVisible(true);
  }

  function handleApply(r: DateRange) {
    setRange(r);
    setPickerVisible(false);
  }

  return (
    <>
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 20, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─── */}
        <View style={[styles.header, { paddingHorizontal: 20 }]}>
          <View style={styles.headerLeft}>
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
              <Text style={[styles.avatarText, { color: '#FFFFFF' }]}>AT</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ─── Revenue Hero ─── */}
        <View style={{ paddingHorizontal: 20 }}>
          <LinearGradient
            colors={heroGradient}
            style={[styles.heroCard, { borderColor: heroBorderColor }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {isDark && <View style={styles.glowOrb} />}

            {/* Top row: label + period picker + growth */}
            <View style={styles.heroTop}>
              <Text style={[styles.heroLabel, { color: heroLabelColor }]}>REVENUE</Text>

              <TouchableOpacity
                style={[styles.periodPill, {
                  backgroundColor: isDark ? '#FFFFFF15' : '#7C3AED18',
                  borderColor: isDark ? '#FFFFFF25' : '#7C3AED30',
                }]}
                onPress={openPicker}
                activeOpacity={0.75}
              >
                <Text style={[styles.periodText, { color: isDark ? '#E0D4FF' : '#5B21B6' }]}>
                  {range.label}
                </Text>
                <Feather name="chevron-down" size={12} color={isDark ? '#C4B5FD' : '#7C3AED'} />
              </TouchableOpacity>

              <View style={[styles.growthPill, {
                backgroundColor: rev.up ? '#16A34A18' : '#DC262618',
                borderColor:     rev.up ? '#22C55E33' : '#EF444433',
              }]}>
                <Feather
                  name={rev.up ? 'trending-up' : 'trending-down'}
                  size={11}
                  color={rev.up ? colors.success : colors.destructive}
                />
                <Text style={[styles.growthText, { color: rev.up ? colors.success : colors.destructive }]}>
                  {rev.growth}
                </Text>
              </View>
            </View>

            <Text style={[styles.heroAmount, { color: heroAmountColor }]}>{rev.amount}</Text>
            <Text style={[styles.heroSub, { color: heroSubColor }]}>{rev.context}</Text>

            {/* Sparkline */}
            <View style={styles.sparkRow}>
              {spark.map((h, i) => {
                const isLast   = i === spark.length - 1;
                const isRecent = i >= spark.length - 3;
                const opacity  = isLast ? 1 : isRecent ? 0.55 : 0.2;
                return (
                  <View
                    key={i}
                    style={[styles.sparkBar, {
                      height: (h / 100) * 36,
                      backgroundColor: primary,
                      opacity,
                    }]}
                  />
                );
              })}
            </View>
          </LinearGradient>
        </View>

        {/* ─── Stats Scroll ─── */}
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
              <View style={[styles.statIcon, { backgroundColor: colors.secondary }]}>
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
                  style={[
                    styles.orderRow,
                    i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                  ]}
                >
                  <View style={[styles.orderAccent, { backgroundColor: colors.primary }]} />
                  <View style={styles.orderLeft}>
                    <Text style={[styles.orderId, { color: colors.primary }]}>{order.id}</Text>
                    <Text style={[styles.orderCustomer, { color: colors.mutedForeground }]}>{order.customer}</Text>
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
          <SectionHeader title="Low Stock" action="Manage" onAction={() => nav('/products')} />
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {LOW_STOCK.map((item, i) => (
              <View
                key={item.name}
                style={[
                  styles.stockRow,
                  i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                ]}
              >
                <View style={[styles.stockIcon, {
                  backgroundColor: item.stock <= 3
                    ? `${colors.destructive}18`
                    : `${colors.warning}18`,
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
                  backgroundColor: item.stock <= 3
                    ? `${colors.destructive}15`
                    : `${colors.warning}15`,
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
                <Feather name={m.icon} size={16} color={colors.primary} />
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

      {/* ─── Date Range Picker Modal ─── */}
      <DateRangePicker
        visible={pickerVisible}
        current={range}
        onApply={handleApply}
        onClose={() => setPickerVisible(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerLeft: { flex: 1 },
  greeting: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  brand: { fontSize: 26, fontFamily: 'Inter_700Bold', letterSpacing: -0.6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  notifDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },

  heroCard: { borderRadius: 22, padding: 22, borderWidth: 1, overflow: 'hidden' },
  glowOrb: { position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: '#7C3AED', opacity: 0.12 },

  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  heroLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 1.2 },

  periodPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  periodText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  growthPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  growthText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  heroAmount: { fontSize: 44, fontFamily: 'Inter_700Bold', letterSpacing: -1.5 },
  heroSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, marginBottom: 16 },

  sparkRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 36 },
  sparkBar: { flex: 1, borderRadius: 3 },

  statsScroll: { gap: 10, paddingVertical: 2 },
  statCard: { width: 120, borderRadius: 16, padding: 16, borderWidth: 1, gap: 4 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  statValue: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  statChange: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  actionsScroll: { gap: 10, paddingVertical: 2 },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1 },
  chipIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  orderRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  orderAccent: { width: 3, height: 40, borderRadius: 2 },
  orderLeft: { flex: 1, gap: 2 },
  orderId: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  orderCustomer: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  orderTime: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  orderRight: { alignItems: 'flex-end', gap: 6 },
  orderAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  stockRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  stockIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  stockName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular' },
  stockBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7 },
  stockQty: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '47.5%', borderRadius: 14, padding: 14, borderWidth: 1, gap: 3 },
  metricValue: { fontSize: 22, fontFamily: 'Inter_700Bold', marginTop: 4 },
  metricLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  metricChange: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});
