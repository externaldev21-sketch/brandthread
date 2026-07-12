import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, Alert, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import palette from '@/constants/colors';
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
  const colors = palette.dark;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const isDark = true;
  const [pickerVisible, setPickerVisible] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const rev    = REVENUE_DATA[range.presetId] ?? REVENUE_DATA.last30;
  const spark  = SPARK[range.presetId] ?? SPARK.last30;
  const primary = isDark ? '#39FF88' : '#00C853';

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
          <View>
            <Text style={[st.greeting, { color: colors.foreground }]}>Hi Ben! <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }}>Welcome back to</Text></Text>
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
              <Feather name="copy" size={13} color={primary} />
            </TouchableOpacity>
          </View>
          <View style={st.headerIcons}>
            <TouchableOpacity style={[st.headerIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.75} onPress={() => nav('/general-settings')}>
              <Feather name="grid" size={16} color={colors.foreground} />
            </TouchableOpacity>
            <TouchableOpacity style={[st.headerIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]} activeOpacity={0.75} onPress={() => nav('/notifications-settings')}>
              <Feather name="bell" size={16} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Account balance — wallet-style hero */}
        <View style={{ paddingHorizontal: 20 }}>
          <View style={[st.balanceCard, { backgroundColor: isDark ? '#141414' : '#171717' }]}>
            <View style={st.balanceTopRow}>
              <View style={st.currencyBadge}>
                <Feather name="dollar-sign" size={11} color="#0B0B0B" />
                <Text style={st.currencyBadgeText}>USD</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={st.balanceSubLabelDark}>
                  Hold: <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>{HELD_BY_PLATFORM}</Text>
                </Text>
                <Text style={[st.balanceSubLabelDark, { marginTop: 3 }]}>
                  Pending: <Text style={{ color: '#FFFFFF', fontFamily: 'Inter_600SemiBold' }}>{PENDING_PAYOUT}</Text>
                </Text>
              </View>
            </View>
            <Text style={st.balanceLabelDark}>Account Balance</Text>
            <Text style={st.balanceAmountDark}>{ACCOUNT_BALANCE}</Text>
            <View style={[st.trendPill, { backgroundColor: '#22C55E' }]}>
              <Feather name="trending-up" size={12} color="#FFFFFF" />
              <Text style={st.trendPillText}>+2.3% this month</Text>
            </View>
          </View>

          {/* Segmented action row */}
          <View style={st.segmentRow}>
            <TouchableOpacity
              style={[st.segmentBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              activeOpacity={0.8}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); nav('/finance'); }}
            >
              <Feather name="arrow-up" size={15} color={colors.foreground} />
              <Text style={[st.segmentLabel, { color: colors.foreground }]}>Cash Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.segmentCenterBtn, { backgroundColor: primary }]}
              activeOpacity={0.85}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPickerVisible(true); }}
            >
              <Feather name="calendar" size={18} color="#FFFFFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.segmentBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              activeOpacity={0.8}
              onPress={() => nav('/analytics')}
            >
              <Feather name="arrow-down" size={15} color={colors.foreground} />
              <Text style={[st.segmentLabel, { color: colors.foreground }]}>Details</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Stats (Last 28 days) */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <SectionHeader title="Stats (Last 28 days)" action="View All →" onAction={() => nav('/analytics')} colors={colors} />
        </View>
        <View style={[st.keyStatsRow, { paddingHorizontal: 20 }]}>
          {KEY_STATS.map((s) => (
            <TouchableOpacity
              key={s.label}
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); nav(s.label === 'Leads' ? '/customers' : '/analytics'); }}
              style={[st.keyStatCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[st.keyStatLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              <View style={st.keyStatValueRow}>
                <Text style={[st.keyStatValue, { color: colors.foreground }]}>{s.value}</Text>
                <View style={[st.keyStatArrow, { backgroundColor: colors.success }]}>
                  <Feather name={s.up ? 'arrow-up' : 'arrow-down'} size={11} color="#FFFFFF" />
                </View>
              </View>
            </TouchableOpacity>
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
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}><SectionHeader title="Quick Actions" colors={colors} /></View>
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
          <SectionHeader title="My Orders" action="View All →" onAction={() => nav('/analytics')} colors={colors} />
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
                    <Badge label={s.label} variant={s.variant} colors={colors} />
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Low Stock */}
        <View style={{ paddingHorizontal: 20, marginTop: 28 }}>
          <SectionHeader title="Low Stock" action="Manage" onAction={() => nav('/products')} colors={colors} />
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
          <SectionHeader title="Analytics" action="View all" onAction={() => nav('/analytics')} colors={colors} />
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
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 10 },
  greeting: { fontSize: 18, fontFamily: 'Inter_700Bold', letterSpacing: -0.3, marginBottom: 4 },
  headerIcons: { flexDirection: 'row', gap: 8 },
  headerIconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  storeLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, paddingVertical: 2 },
  storeLinkText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  heroLabel: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  periodPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  periodText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  balanceCard: { borderRadius: 24, padding: 22, gap: 4 },
  balanceTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  currencyBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4, alignSelf: 'flex-start' },
  currencyBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#0B0B0B' },
  balanceLabelDark: { fontSize: 12, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
  balanceAmountDark: { fontSize: 40, fontFamily: 'Inter_700Bold', letterSpacing: -1, color: '#FFFFFF' },
  balanceSubLabelDark: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.55)' },
  trendPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, marginTop: 14 },
  trendPillText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  segmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, paddingHorizontal: 4 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, borderRadius: 16, borderWidth: 1 },
  segmentLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  segmentCenterBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginHorizontal: 10 },
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
