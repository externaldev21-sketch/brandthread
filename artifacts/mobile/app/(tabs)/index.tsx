import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, useColorScheme, Alert, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/Badge';
import { SectionHeader } from '@/components/SectionHeader';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import DateRangePicker, { DateRange, buildPresets } from '@/components/DateRangePicker';

const SCREEN_W = Dimensions.get('window').width;

// ─── Mock data ────────────────────────────────────────────────────────────────

const REVENUE_DATA: Record<string, { amount: string }> = {
  today:     { amount: '$4,892.50' },
  yesterday: { amount: '$3,240.00' },
  last7:     { amount: '$28,450'   },
  last30:    { amount: '$94,200'   },
  last90:    { amount: '$284,600'  },
  thisMonth: { amount: '$94,200'   },
  lastMonth: { amount: '$78,400'   },
  custom:    { amount: '$94,200'   },
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
const STATS = [
  { label: 'Sessions',   value: '9,400', change: '+5% today', icon: 'eye'          as const, up: true },
  { label: 'Orders',     value: '12',    change: '+3 today',  icon: 'shopping-bag' as const, up: true },
  { label: 'Conv. Rate', value: '3.4%',  change: '+0.6%',     icon: 'trending-up'  as const, up: true },
  { label: 'Returns',    value: '2',     change: '-1 vs avg', icon: 'refresh-cw'   as const, up: true },
];
const STORE_HANDLE = 'brandthread.store/vaultstudio';
const ACCOUNT_BALANCE = '$12,678.77';
const HELD_BY_PLATFORM = '$0.00';
const PENDING_PAYOUT = '$3,543.31';
const CHART_MONTH_LABELS = ['Jun 11', 'Jun 14', 'Jun 17', 'Jun 20', 'Jun 23', 'Jun 26', 'Jun 29', 'Jul 02', 'Jul 05', 'Jul 08'];
const KEY_STATS = [
  { label: 'Leads',       value: '523', up: true },
  { label: 'Store Views', value: '839', up: true },
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
const ANALYTICS_METRICS = [
  { label: 'Conversion Rate', value: '3.4%', change: '+0.6%', up: true,  icon: 'trending-up' as const },
  { label: 'Avg. Order Value', value: '$128', change: '+$12',  up: true,  icon: 'dollar-sign' as const },
  { label: 'Returning Rate',  value: '42%',  change: '+4%',   up: true,  icon: 'refresh-cw'  as const },
  { label: 'CLV',             value: '$480', change: '+$30',  up: true,  icon: 'heart'        as const },
];
const statusMap: Record<string, { variant: 'success'|'info'|'warning'|'error'; label: string }> = {
  fulfilled:  { variant: 'success', label: 'Fulfilled'  },
  processing: { variant: 'warning', label: 'Processing' },
  shipped:    { variant: 'info',    label: 'Shipped'    },
  cancelled:  { variant: 'error',   label: 'Cancelled'  },
};

// ─── Revenue line chart (SVG) ─────────────────────────────────────────────────

function RevenueChart({ data, color, width, labelColor }: { data: number[]; color: string; width: number; labelColor: string }) {
  if (data.length < 2) return null;
  const height = 130;
  const padTop = 8;
  const padBottom = 22;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...data, 1);
  const stepX = width / (data.length - 1);

  const points = data.map((v, i) => ({ x: i * stepX, y: padTop + plotH - (v / max) * plotH }));

  const linePath = points.reduce((acc, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const midX = (prev.x + p.x) / 2;
    return `${acc} C ${midX} ${prev.y}, ${midX} ${p.y}, ${p.x} ${p.y}`;
  }, '');

  const areaPath = `${linePath} L ${width} ${height - padBottom} L 0 ${height - padBottom} Z`;

  return (
    <View>
      <Svg width={width} height={height}>
        <Path d={areaPath} fill={color} fillOpacity={0.12} />
        <Path d={linePath} stroke={color} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      </Svg>
      <View style={st.chartXLabels}>
        {CHART_MONTH_LABELS.map((label, i) => (
          <Text
            key={label}
            style={[
              st.chartXLabel,
              { color: labelColor },
              i === CHART_MONTH_LABELS.length - 1 && { fontFamily: 'Inter_700Bold', color },
            ]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Default date range ───────────────────────────────────────────────────────

function defaultRange(): DateRange {
  const presets = buildPresets();
  const p = presets.find((x) => x.id === 'last30')!;
  const { start, end } = p.range();
  return { start, end, presetId: 'last30', label: 'Last 30 days' };
}

// ─── Seller Dashboard ─────────────────────────────────────────────────────────

export default function SellerDashboard() {
  const colors = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isDark = scheme !== 'light';
  const [pickerVisible, setPickerVisible] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const rev    = REVENUE_DATA[range.presetId] ?? REVENUE_DATA.last30;
  const spark  = SPARK[range.presetId] ?? SPARK.last30;
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  function nav(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <>
      <ScrollView
        style={[st.container, { backgroundColor: colors.background }]}
        contentContainerStyle={{ paddingTop: topPad + 20, paddingBottom: 140 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={[st.header, { paddingHorizontal: 20 }]}>
          <View style={st.brandRow}>
            <Text style={[st.brand, { color: colors.foreground }]}>Brandthread</Text>
          </View>
          <View style={st.headerRightRow}>
            <TouchableOpacity
              style={st.storeLinkRow}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                Clipboard.setStringAsync(`https://${STORE_HANDLE}`);
                Alert.alert('Link copied', `${STORE_HANDLE} copied to clipboard.`);
              }}
            >
              <Text style={[st.storeLinkText, { color: primary }]} numberOfLines={1}>{STORE_HANDLE}</Text>
              <Feather name="copy" size={14} color={primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.settingsBtn, { backgroundColor: colors.secondary }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
              onPress={() => nav('/settings')}
            >
              <Feather name="settings" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Revenue hero */}
        <View style={[st.heroRow, { paddingHorizontal: 20 }]}>
          <LinearGradient colors={[primary, primary + '99']} style={st.heroThumb}>
            <Feather name="shopping-bag" size={26} color="#FFFFFF" />
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[st.heroLabel, { color: colors.mutedForeground }]}>Total Revenue</Text>
            <Text style={[st.heroAmount, { color: colors.foreground }]}>{rev.amount}</Text>
          </View>
        </View>

        {/* Account balance */}
        <View style={{ paddingHorizontal: 20, marginTop: 18 }}>
          <View style={[st.balanceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={st.balanceTopRow}>
              <View>
                <Text style={[st.balanceLabel, { color: colors.mutedForeground }]}>Account Balance</Text>
                <Text style={[st.balanceAmount, { color: colors.foreground }]}>{ACCOUNT_BALANCE}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[st.balanceSubLabel, { color: colors.mutedForeground }]}>
                  Held by Brandthread: <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{HELD_BY_PLATFORM}</Text>
                </Text>
                <Text style={[st.balanceSubLabel, { color: colors.mutedForeground, marginTop: 3 }]}>
                  Pending: <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{PENDING_PAYOUT}</Text>
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[st.cashOutBtn, { backgroundColor: primary }]}
              activeOpacity={0.85}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); nav('/finance'); }}
            >
              <Feather name="plus" size={15} color="#FFFFFF" />
              <Text style={st.cashOutText}>Cash Out</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats (Last 28 days) */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <SectionHeader title="Stats (Last 28 days)" action="View All →" onAction={() => nav('/analytics')} />
        </View>
        <View style={[st.keyStatsRow, { paddingHorizontal: 20 }]}>
          {KEY_STATS.map((s) => (
            <View key={s.label} style={[st.keyStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[st.keyStatLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              <View style={st.keyStatValueRow}>
                <Text style={[st.keyStatValue, { color: colors.foreground }]}>{s.value}</Text>
                <View style={[st.keyStatArrow, { backgroundColor: colors.success }]}>
                  <Feather name={s.up ? 'arrow-up' : 'arrow-down'} size={11} color="#FFFFFF" />
                </View>
              </View>
            </View>
          ))}
        </View>

        {/* Revenue chart */}
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <View style={[st.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={st.chartHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[st.heroLabel, { color: colors.mutedForeground }]}>Total Revenue</Text>
                <Text style={[st.chartAmount, { color: colors.foreground }]}>{rev.amount}</Text>
              </View>
              <TouchableOpacity style={[st.periodPill, { backgroundColor: colors.secondary, borderColor: colors.border }]} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerVisible(true); }} activeOpacity={0.75}>
                <Text style={[st.periodText, { color: colors.primary }]}>{range.label}</Text>
                <Feather name="chevron-down" size={12} color={colors.primary} />
              </TouchableOpacity>
            </View>
            <RevenueChart data={spark} color={primary} width={SCREEN_W - 40 - 36} labelColor={colors.mutedForeground} />
          </View>
        </View>

        {/* Stats */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.statsScroll} style={{ marginTop: 16 }}>
          {STATS.map((s, i) => (
            <View key={s.label} style={[st.statCard, { backgroundColor: colors.card, borderColor: colors.border }, i === 0 && { marginLeft: 20 }, i === STATS.length - 1 && { marginRight: 20 }]}>
              <View style={[st.statIcon, { backgroundColor: colors.secondary }]}><Feather name={s.icon} size={16} color={colors.primary} /></View>
              <Text style={[st.statValue, { color: colors.foreground }]}>{s.value}</Text>
              <Text style={[st.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              <Text style={[st.statChange, { color: s.up ? colors.success : colors.destructive }]}>{s.change}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Quick Actions */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}><SectionHeader title="Quick Actions" /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.actionsScroll}>
          {QUICK_ACTIONS.map((qa, i) => (
            <TouchableOpacity key={qa.label} style={[st.actionChip, { backgroundColor: colors.card, borderColor: colors.border }, i === 0 && { marginLeft: 20 }, i === QUICK_ACTIONS.length - 1 && { marginRight: 20 }]} onPress={() => nav(qa.route)} activeOpacity={0.75}>
              <View style={[st.chipIcon, { backgroundColor: colors.secondary }]}><Feather name={qa.icon} size={16} color={colors.primary} /></View>
              <Text style={[st.chipLabel, { color: colors.foreground }]}>{qa.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* My Orders */}
        <View style={{ paddingHorizontal: 20, marginTop: 32 }}>
          <SectionHeader title="My Orders" action="View All →" onAction={() => nav('/analytics')} />
          <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {RECENT_ORDERS.map((order, i) => {
              const s = statusMap[order.status];
              return (
                <View key={order.id} style={[st.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                  <View style={[st.orderAccent, { backgroundColor: colors.primary }]} />
                  <View style={st.orderLeft}>
                    <Text style={[st.orderId, { color: colors.primary }]}>{order.id}</Text>
                    <Text style={[st.orderCustomer, { color: colors.mutedForeground }]}>{order.customer}</Text>
                    <Text style={[st.orderTime, { color: colors.mutedForeground }]}>{order.time}</Text>
                  </View>
                  <View style={st.orderRight}>
                    <Text style={[st.orderAmount, { color: colors.foreground }]}>{order.amount}</Text>
                    <Badge label={s.label} variant={s.variant} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Low Stock */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <SectionHeader title="Low Stock" action="Manage" onAction={() => nav('/products')} />
          <View style={[st.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {LOW_STOCK.map((item, i) => (
              <View key={item.name} style={[st.stockRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={[st.stockIcon, { backgroundColor: item.stock <= 3 ? `${colors.destructive}18` : `${colors.warning}18` }]}>
                  <Feather name="alert-triangle" size={13} color={item.stock <= 3 ? colors.destructive : colors.warning} />
                </View>
                <Text style={[st.stockName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                <View style={[st.stockBadge, { backgroundColor: item.stock <= 3 ? `${colors.destructive}15` : `${colors.warning}15` }]}>
                  <Text style={[st.stockQty, { color: item.stock <= 3 ? colors.destructive : colors.warning }]}>{item.stock} left</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Analytics */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <SectionHeader title="Analytics" action="View all" onAction={() => nav('/analytics')} />
          <View style={st.metricsGrid}>
            {ANALYTICS_METRICS.map((m) => (
              <View key={m.label} style={[st.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name={m.icon} size={16} color={colors.primary} />
                <Text style={[st.metricValue, { color: colors.foreground }]}>{m.value}</Text>
                <Text style={[st.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
                <Text style={[st.metricChange, { color: m.up ? colors.success : colors.destructive }]}>{m.change}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <DateRangePicker
        visible={pickerVisible}
        current={range}
        onApply={(r) => { setRange(r); setPickerVisible(false); }}
        onClose={() => setPickerVisible(false)}
      />
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brand: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  headerRightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  storeLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, paddingVertical: 6 },
  storeLinkText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  settingsBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroThumb: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  periodPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  periodText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  heroAmount: { fontSize: 30, fontFamily: 'Inter_700Bold', letterSpacing: -0.8, marginTop: 2 },
  balanceCard: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 16 },
  balanceTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  balanceLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 4 },
  balanceAmount: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  balanceSubLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  cashOutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14 },
  cashOutText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  keyStatsRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  keyStatCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  keyStatLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  keyStatValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyStatValue: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  keyStatArrow: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chartCard: { borderRadius: 18, borderWidth: 1, padding: 18 },
  chartHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  chartAmount: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginTop: 2 },
  chartXLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartXLabel: { fontSize: 8.5, fontFamily: 'Inter_400Regular', color: '#8C8577', flexShrink: 1 },
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
