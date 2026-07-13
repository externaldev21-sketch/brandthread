import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, Dimensions, useWindowDimensions,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import palette from '@/constants/colors';
import DateRangePicker, { DateRange, buildPresets } from '@/components/DateRangePicker';

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:        '#0D0E0D',
  surface:   '#161716',
  border:    '#232523',
  fg:        '#EAF2ED',
  muted:     '#6B7A6D',
  green:     '#39FF88',
  greenDim:  '#1A3D28',
  purple:    '#8B5CF6',
  orange:    '#F97316',
  blue:      '#3B82F6',
  red:       '#EF4444',
};

// ─── Mock data ────────────────────────────────────────────────────────────────

const SPARK_REVENUE  = [30, 38, 35, 52, 47, 65, 55, 78, 70, 83, 79, 100];
const SPARK_ORDERS   = [40, 45, 38, 60, 52, 70, 58, 80, 72, 88, 82, 95];
const SPARK_PRODUCTS = [25, 35, 30, 48, 42, 58, 50, 70, 64, 80, 75, 92];
const SPARK_VISITORS = [55, 60, 52, 72, 65, 78, 68, 85, 77, 90, 84, 98];

const HERO_STATS = [
  { label: 'Revenue',       value: '$83,491', change: '+37.5%', up: true,  icon: 'shopping-bag' as const, color: C.green,  spark: SPARK_REVENUE  },
  { label: 'Orders',        value: '1,892',   change: '+24.1%', up: true,  icon: 'package'      as const, color: C.blue,   spark: SPARK_ORDERS   },
  { label: 'Products Sold', value: '3,271',   change: '+28.4%', up: true,  icon: 'tag'          as const, color: C.orange, spark: SPARK_PRODUCTS },
  { label: 'Visitors',      value: '98,241',  change: '+19.6%', up: true,  icon: 'users'        as const, color: C.purple, spark: SPARK_VISITORS },
];

const CHART_DATA   = [8, 18, 14, 30, 24, 42, 35, 55, 48, 63, 58, 72, 65, 80, 74, 83];
const CHART_LABELS = ['Jun 11', 'Jun 18', 'Jun 25', 'Jul 2', 'Jul 9'];

const AI_INSIGHTS = [
  { id: '1', title: 'High Performer',     desc: 'Your Vintage Wash Tee is performing 73% better than usual.', color: C.purple, icon: 'trending-up'    as const },
  { id: '2', title: 'Low Stock Alert',    desc: '5 products are running low on inventory.',                   color: C.orange, icon: 'alert-triangle' as const },
  { id: '3', title: 'Growth Opportunity', desc: 'TikTok traffic is up 41%. Consider increasing ad spend.',   color: C.green,  icon: 'zap'            as const },
  { id: '4', title: 'Marketing Tip',      desc: 'Email campaigns bring in 28% of your revenue.',             color: C.blue,   icon: 'mail'           as const },
];

const TOP_PRODUCTS = [
  { name: 'Vintage Washed Tee',  sold: 1827, revenue: '$54,812.00', change: '+37.5%', up: true  },
  { name: 'Oversized Hoodie',    sold: 1241, revenue: '$43,285.00', change: '+12.1%', up: true  },
  { name: 'Graphic Zip Hoodie',  sold: 892,  revenue: '$35,760.00', change: '+8.3%',  up: true  },
  { name: 'Cargo Sweatpants',    sold: 721,  revenue: '$28,420.00', change: '-2.1%',  up: false },
];

const RECENT_ORDERS = [
  { id: '#BT-78291', customer: 'Jonah B.',   amount: '$129.99', status: 'Paid' },
  { id: '#BT-78290', customer: 'Lucas M.',   amount: '$89.99',  status: 'Paid' },
  { id: '#BT-78289', customer: 'David K.',   amount: '$159.99', status: 'Paid' },
  { id: '#BT-78288', customer: 'Anthony L.', amount: '$99.99',  status: 'Paid' },
  { id: '#BT-78287', customer: 'Brandon G.', amount: '$129.99', status: 'Paid' },
];

const BRAND_HEALTH = {
  score: 94,
  label: 'Excellent',
  bars: [
    { label: 'Store Performance',    value: 95 },
    { label: 'Marketing',            value: 92 },
    { label: 'Customer Satisfaction',value: 96 },
    { label: 'Product Quality',      value: 93 },
    { label: 'Shipping & Fulfilment',value: 94 },
  ],
};

const SIDEBAR_NAV = [
  { label: 'Dashboard',    icon: 'home'          as const, route: '/'             },
  { label: 'Products',     icon: 'box'           as const, route: '/products'     },
  { label: 'Orders',       icon: 'shopping-bag'  as const, route: '/orders'       },
  { label: 'Customers',    icon: 'users'         as const, route: '/customers'    },
  { label: 'Analytics',    icon: 'bar-chart-2'   as const, route: '/analytics'    },
  { label: 'Marketing',    icon: 'send'          as const, route: '/marketing'    },
  { label: 'Design Studio',icon: 'zap'           as const, route: '/ai-studio'    },
  { label: 'AI Assistant', icon: 'message-circle'as const, route: '/ai-assistant' },
  { label: 'Finances',     icon: 'dollar-sign'   as const, route: '/finance'      },
  { label: 'Integrations', icon: 'link'          as const, route: '/more'         },
  { label: 'Community',    icon: 'heart'         as const, route: '/more'         },
  { label: 'Settings',     icon: 'settings'      as const, route: '/general-settings' },
];

// ─── Mini sparkline ───────────────────────────────────────────────────────────

function MiniSparkline({ data, color, width, height = 44 }: { data: number[]; color: string; width: number; height?: number }) {
  if (data.length < 2) return null;
  const padY = 4;
  const plotH = height - padY * 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => ({ x: i * stepX, y: padY + plotH - ((v - min) / range) * plotH }));
  const line = pts.reduce((a, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `${a} C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} fillOpacity={0.15} />
      <Path d={line} stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={3} fill={color} />
    </Svg>
  );
}

// ─── Revenue chart (full) ─────────────────────────────────────────────────────

function RevenueChart({ width, height = 160 }: { width: number; height?: number }) {
  const data = CHART_DATA;
  const padL = 48; const padR = 16; const padTop = 12; const padBottom = 28;
  const plotW = width - padL - padR;
  const plotH = height - padTop - padBottom;
  const max = 100;
  const stepX = plotW / (data.length - 1);
  const pts = data.map((v, i) => ({ x: padL + i * stepX, y: padTop + plotH - (v / max) * plotH }));
  const line = pts.reduce((a, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1];
    const mx = (prev.x + p.x) / 2;
    return `${a} C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const area = `${line} L ${pts[pts.length - 1].x} ${padTop + plotH} L ${padL} ${padTop + plotH} Z`;
  const yLabels = ['$100K', '$75K', '$50K', '$25K', '$0'];
  const last = pts[pts.length - 1];

  return (
    <View>
      <Svg width={width} height={height}>
        {/* Y-axis lines */}
        {yLabels.map((_, i) => {
          const y = padTop + (i / (yLabels.length - 1)) * plotH;
          return <Path key={i} d={`M ${padL} ${y} L ${width - padR} ${y}`} stroke={C.border} strokeWidth={1} />;
        })}
        {/* Area + line */}
        <Path d={area} fill={C.green} fillOpacity={0.12} />
        <Path d={line} stroke={C.green} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        {/* Tooltip dot */}
        <Circle cx={last.x} cy={last.y} r={5} fill={C.green} />
        <Circle cx={last.x} cy={last.y} r={9} fill={C.green} fillOpacity={0.2} />
      </Svg>
      {/* Y-axis labels */}
      <View style={[StyleSheet.absoluteFill, { paddingTop: padTop, paddingBottom: padBottom }]} pointerEvents="none">
        {yLabels.map((l) => (
          <Text key={l} style={ch.yLabel}>{l}</Text>
        ))}
      </View>
      {/* X-axis labels */}
      <View style={[ch.xRow, { paddingLeft: padL, paddingRight: padR }]}>
        {CHART_LABELS.map((l) => <Text key={l} style={ch.xLabel}>{l}</Text>)}
      </View>
    </View>
  );
}

const ch = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, fontSize: 9, fontFamily: 'Inter_400Regular', color: C.muted, width: 44, textAlign: 'right' },
  xRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  xLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.muted },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function defaultRange(): DateRange {
  const p = buildPresets().find((x) => x.id === 'last30')!;
  const { start, end } = p.range();
  return { start, end, presetId: 'last30', label: 'Last 30 days' };
}

// ─── Mobile Dashboard ─────────────────────────────────────────────────────────

function MobileDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const { width: W } = useWindowDimensions();
  const cardW = (W - 48) / 2;

  function nav(r: string) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(r as never); }

  return (
    <>
      <ScrollView
        style={m.root}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={m.header}>
          <View style={m.logoRow}>
            <View style={m.logoBadge}><Text style={m.logoText}>B</Text></View>
            <Text style={m.logoLabel}>Brandthread</Text>
          </View>
          <View style={m.headerIcons}>
            <TouchableOpacity style={m.iconBtn} onPress={() => nav('/search')}><Feather name="search" size={18} color={C.fg} /></TouchableOpacity>
            <TouchableOpacity style={m.iconBtn} onPress={() => nav('/notifications-settings')}><Feather name="bell" size={18} color={C.fg} /></TouchableOpacity>
            <TouchableOpacity style={m.iconBtn} onPress={() => nav('/ai-assistant')}><Feather name="message-circle" size={18} color={C.fg} /></TouchableOpacity>
          </View>
        </View>

        {/* Greeting */}
        <View style={m.greetRow}>
          <View style={{ flex: 1 }}>
            <Text style={m.greetTitle}>Good evening, Devon 👋</Text>
            <Text style={m.greetSub}>Here's what's happening with your brand today.</Text>
          </View>
          <TouchableOpacity style={m.weekPill} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
            <Text style={m.weekText}>{range.label.replace('Last ', 'Last ')}</Text>
            <Feather name="chevron-down" size={12} color={C.fg} />
          </TouchableOpacity>
        </View>

        {/* 2×2 stat cards */}
        <View style={m.statGrid}>
          {HERO_STATS.map((s) => (
            <TouchableOpacity
              key={s.label}
              style={[m.statCard, { width: cardW }]}
              activeOpacity={0.8}
              onPress={() => nav(s.label === 'Orders' || s.label === 'Products Sold' ? '/orders' : '/analytics')}
            >
              <View style={m.statCardTop}>
                <Text style={m.statCardLabel}>{s.label}</Text>
                <View style={[m.statIconBox, { backgroundColor: s.color + '22' }]}>
                  <Feather name={s.icon} size={14} color={s.color} />
                </View>
              </View>
              <Text style={m.statCardValue}>{s.value}</Text>
              <Text style={[m.statCardChange, { color: s.up ? C.green : C.red }]}>↑ {s.change}</Text>
              <MiniSparkline data={s.spark} color={s.color} width={cardW - 28} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Revenue Overview */}
        <View style={m.section}>
          <View style={m.sectionHead}>
            <Text style={m.sectionTitle}>Revenue Overview</Text>
            <TouchableOpacity style={m.pillBtn} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
              <Text style={m.pillBtnText}>{range.label}</Text>
              <Feather name="chevron-down" size={11} color={C.fg} />
            </TouchableOpacity>
          </View>
          <View style={m.card}>
            <Text style={m.chartBigAmt}>$83,491.23</Text>
            <Text style={[m.chartChange, { color: C.green }]}>↑ 37.5%</Text>
            <View style={{ marginTop: 12 }}>
              <RevenueChart width={W - 72} />
            </View>
          </View>
        </View>

        {/* AI Insights */}
        <View style={m.section}>
          <View style={m.sectionHead}>
            <Text style={m.sectionTitle}>AI Insights</Text>
            <TouchableOpacity onPress={() => nav('/ai-assistant')}><Text style={m.viewAll}>View All</Text></TouchableOpacity>
          </View>
          <View style={m.card}>
            {AI_INSIGHTS.map((ins, i) => (
              <TouchableOpacity
                key={ins.id}
                style={[m.insightRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}
                activeOpacity={0.75}
                onPress={() => nav('/ai-assistant')}
              >
                <View style={[m.insightIcon, { backgroundColor: ins.color + '22' }]}>
                  <Feather name={ins.icon} size={15} color={ins.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[m.insightTitle, { color: ins.color }]}>{ins.title}</Text>
                  <Text style={m.insightDesc}>{ins.desc}</Text>
                </View>
                <Feather name="chevron-right" size={14} color={C.muted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Top Products */}
        <View style={m.section}>
          <View style={m.sectionHead}>
            <Text style={m.sectionTitle}>Top Products</Text>
            <TouchableOpacity onPress={() => nav('/products')}><Text style={m.viewAll}>View All</Text></TouchableOpacity>
          </View>
          <View style={m.card}>
            {TOP_PRODUCTS.slice(0, 2).map((p, i) => (
              <TouchableOpacity
                key={p.name}
                style={[m.productRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}
                activeOpacity={0.75}
                onPress={() => nav('/products')}
              >
                <View style={m.productThumb}>
                  <Feather name="tag" size={16} color={C.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={m.productName}>{p.name}</Text>
                  <Text style={m.productSold}>{p.sold.toLocaleString()} sold</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={m.productRev}>{p.revenue}</Text>
                  <Text style={[m.productChange, { color: p.up ? C.green : C.red }]}>{p.up ? '↑' : '↓'} {p.change}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Create New Product CTA */}
        <View style={{ paddingHorizontal: 20, marginTop: 8 }}>
          <LinearGradient
            colors={['#0D2B1A', '#0A1F13', '#081A0F']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={m.ctaBanner}
          >
            <View style={{ flex: 1 }}>
              <View style={m.ctaIconRow}>
                <Feather name="zap" size={18} color={C.green} />
                <Text style={m.ctaTitle}>Create New Product</Text>
              </View>
              <Text style={m.ctaDesc}>Use AI to generate unique designs in seconds.</Text>
              <TouchableOpacity style={m.ctaBtn} activeOpacity={0.85} onPress={() => nav('/ai-studio')}>
                <Text style={m.ctaBtnText}>Generate Now  →</Text>
              </TouchableOpacity>
            </View>
            <View style={m.ctaImage}>
              <Feather name="shopping-bag" size={48} color={C.green} style={{ opacity: 0.3 }} />
            </View>
          </LinearGradient>
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

const m = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg },
  header:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 20 },
  logoRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoBadge:     { width: 30, height: 30, borderRadius: 8, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  logoText:      { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#0B0B0B' },
  logoLabel:     { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.fg },
  headerIcons:   { flexDirection: 'row', gap: 6 },
  iconBtn:       { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  greetRow:      { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, marginBottom: 20, gap: 12 },
  greetTitle:    { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.fg, marginBottom: 4 },
  greetSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.muted },
  weekPill:      { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  weekText:      { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.fg },
  statGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginBottom: 8 },
  statCard:      { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 14, gap: 4, overflow: 'hidden' },
  statCardTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  statCardLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.muted },
  statIconBox:   { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statCardValue: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.fg, letterSpacing: -0.5 },
  statCardChange:{ fontSize: 11, fontFamily: 'Inter_600SemiBold', marginBottom: 8 },
  section:       { paddingHorizontal: 20, marginTop: 20 },
  sectionHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.fg },
  viewAll:       { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.green },
  card:          { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  pillBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  pillBtnText:   { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.fg },
  chartBigAmt:   { fontSize: 26, fontFamily: 'Inter_700Bold', color: C.fg, paddingHorizontal: 18, paddingTop: 18, letterSpacing: -0.5 },
  chartChange:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 18, marginTop: 2 },
  insightRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  insightIcon:   { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  insightTitle:  { fontSize: 13, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  insightDesc:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted },
  productRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  productThumb:  { width: 44, height: 44, borderRadius: 10, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  productName:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.fg },
  productSold:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted, marginTop: 2 },
  productRev:    { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.fg },
  productChange: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  ctaBanner:     { borderRadius: 20, padding: 22, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', borderWidth: 1, borderColor: '#1A3D28' },
  ctaIconRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  ctaTitle:      { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.fg },
  ctaDesc:       { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.muted, marginBottom: 16 },
  ctaBtn:        { backgroundColor: C.green, borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, alignSelf: 'flex-start' },
  ctaBtnText:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
  ctaImage:      { width: 80, alignItems: 'center', justifyContent: 'center' },
});

// ─── Desktop Sidebar ──────────────────────────────────────────────────────────

function DesktopSidebar({ active, onNav }: { active: string; onNav: (r: string) => void }) {
  return (
    <View style={d.sidebar}>
      {/* Logo */}
      <View style={d.sideLogoRow}>
        <View style={d.sideLogoBadge}><Text style={d.sideLogoText}>B</Text></View>
        <Text style={d.sideLogoLabel}>Brandthread</Text>
      </View>

      {/* Nav items */}
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {SIDEBAR_NAV.map((item) => {
          const isActive = item.label === active;
          return (
            <TouchableOpacity
              key={item.label}
              style={[d.navItem, isActive && d.navItemActive]}
              onPress={() => onNav(item.route)}
              activeOpacity={0.75}
            >
              <Feather name={item.icon} size={16} color={isActive ? C.green : C.muted} />
              <Text style={[d.navLabel, isActive && d.navLabelActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* User */}
      <View style={d.sideUser}>
        <View style={d.sideAvatar}><Text style={d.sideAvatarText}>D</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={d.sideUserName}>Devon Walker</Text>
          <Text style={d.sideUserPlan}>Premium Plan</Text>
        </View>
        <TouchableOpacity><Feather name="more-horizontal" size={16} color={C.muted} /></TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Desktop Dashboard ────────────────────────────────────────────────────────

function DesktopDashboard() {
  const router = useRouter();
  const { width: W } = useWindowDimensions();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [range, setRange] = useState<DateRange>(defaultRange);

  function nav(r: string) { router.push(r as never); }

  return (
    <View style={d.root}>
      <DesktopSidebar active="Dashboard" onNav={nav} />

      <ScrollView style={d.main} contentContainerStyle={d.mainContent} showsVerticalScrollIndicator={false}>
        {/* Top bar */}
        <View style={d.topBar}>
          <View>
            <Text style={d.topGreet}>Good evening, Devon 👋</Text>
            <Text style={d.topSub}>Here's what's happening with your brand today.</Text>
          </View>
          <View style={d.topRight}>
            <TouchableOpacity style={d.searchBox} onPress={() => nav('/search')} activeOpacity={0.8}>
              <Feather name="search" size={14} color={C.muted} />
              <Text style={d.searchText}>Search anything...</Text>
              <View style={d.searchKbd}><Text style={d.searchKbdText}>⌘K</Text></View>
            </TouchableOpacity>
            <TouchableOpacity style={d.topIconBtn} onPress={() => nav('/notifications-settings')}><Feather name="bell" size={16} color={C.muted} /></TouchableOpacity>
            <TouchableOpacity style={d.topIconBtn} onPress={() => nav('/ai-assistant')}><Feather name="message-circle" size={16} color={C.muted} /></TouchableOpacity>
            <TouchableOpacity style={d.exportBtn} activeOpacity={0.85}>
              <Text style={d.exportBtnText}>Export Report</Text>
              <Feather name="chevron-down" size={14} color={C.fg} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 4 stat cards */}
        <View style={d.statsRow}>
          {HERO_STATS.map((s) => (
            <TouchableOpacity
              key={s.label}
              style={d.dStatCard}
              activeOpacity={0.8}
              onPress={() => nav(s.label === 'Orders' || s.label === 'Products Sold' ? '/orders' : '/analytics')}
            >
              <View style={d.dStatTop}>
                <Text style={d.dStatLabel}>{s.label}</Text>
                <View style={[d.dStatIcon, { backgroundColor: s.color + '22' }]}>
                  <Feather name={s.icon} size={14} color={s.color} />
                </View>
              </View>
              <Text style={d.dStatValue}>{s.value}</Text>
              <Text style={[d.dStatChange, { color: s.up ? C.green : C.red }]} numberOfLines={1}>↑ {s.change}  <Text style={{ color: C.muted, fontFamily: 'Inter_400Regular' }}>from last 30 days</Text></Text>
              <View style={{ marginTop: 12 }}>
                <MiniSparkline data={s.spark} color={s.color} width={160} height={50} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* Chart + AI Insights row */}
        <View style={d.midRow}>
          {/* Revenue overview */}
          <View style={[d.panel, { flex: 6 }]}>
            <View style={d.panelHead}>
              <Text style={d.panelTitle}>Revenue Overview</Text>
              <TouchableOpacity style={d.pillBtn} onPress={() => setPickerVisible(true)} activeOpacity={0.8}>
                <Text style={d.pillBtnText}>{range.label}</Text>
                <Feather name="chevron-down" size={11} color={C.fg} />
              </TouchableOpacity>
            </View>
            <RevenueChart width={(W - 240 - 80) * 0.58} height={200} />
          </View>

          {/* AI Insights */}
          <View style={[d.panel, { flex: 4 }]}>
            <View style={d.panelHead}>
              <Text style={d.panelTitle}>AI Insights</Text>
              <TouchableOpacity onPress={() => nav('/ai-assistant')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
            </View>
            {AI_INSIGHTS.map((ins) => (
              <TouchableOpacity key={ins.id} style={d.insightRow} activeOpacity={0.75} onPress={() => nav('/ai-assistant')}>
                <View style={[d.insightIcon, { backgroundColor: ins.color + '22' }]}>
                  <Feather name={ins.icon} size={14} color={ins.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[d.insightTitle, { color: ins.color }]}>{ins.title}</Text>
                  <Text style={d.insightDesc}>{ins.desc}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bottom 3-column row */}
        <View style={d.bottomRow}>
          {/* Top Products */}
          <View style={[d.panel, { flex: 4 }]}>
            <View style={d.panelHead}>
              <Text style={d.panelTitle}>Top Products</Text>
              <TouchableOpacity onPress={() => nav('/products')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
            </View>
            {TOP_PRODUCTS.map((p, i) => (
              <TouchableOpacity key={p.name} style={[d.productRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]} activeOpacity={0.75} onPress={() => nav('/products')}>
                <View style={d.productThumb}><Feather name="tag" size={14} color={C.muted} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={d.productName}>{p.name}</Text>
                  <Text style={d.productSold}>{p.sold.toLocaleString()} sold</Text>
                </View>
                <Text style={d.productRev}>{p.revenue}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Recent Orders */}
          <View style={[d.panel, { flex: 4 }]}>
            <View style={d.panelHead}>
              <Text style={d.panelTitle}>Recent Orders</Text>
              <TouchableOpacity onPress={() => nav('/orders')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
            </View>
            {RECENT_ORDERS.map((o, i) => (
              <TouchableOpacity key={o.id} style={[d.orderRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]} activeOpacity={0.75} onPress={() => nav('/orders')}>
                <View style={{ flex: 1 }}>
                  <Text style={d.orderId}>{o.id}</Text>
                  <Text style={d.orderCustomer}>{o.customer}</Text>
                </View>
                <Text style={d.orderAmt}>{o.amount}</Text>
                <View style={d.paidBadge}><Text style={d.paidText}>{o.status}</Text></View>
              </TouchableOpacity>
            ))}
          </View>

          {/* Brand Health */}
          <View style={[d.panel, { flex: 3 }]}>
            <Text style={d.panelTitle}>Brand Health</Text>
            {/* Score circle */}
            <View style={d.healthCircleRow}>
              <View style={d.healthCircle}>
                <Svg width={96} height={96}>
                  <Circle cx={48} cy={48} r={40} stroke={C.border} strokeWidth={8} fill="none" />
                  <Circle
                    cx={48} cy={48} r={40}
                    stroke={C.green} strokeWidth={8} fill="none"
                    strokeDasharray={`${2 * Math.PI * 40 * 0.94} ${2 * Math.PI * 40 * 0.06}`}
                    strokeLinecap="round"
                    rotation={-90} originX={48} originY={48}
                  />
                </Svg>
                <View style={d.healthScoreBox}>
                  <Text style={d.healthScore}>{BRAND_HEALTH.score}</Text>
                  <Text style={d.healthLabel}>{BRAND_HEALTH.label}</Text>
                </View>
              </View>
            </View>
            {/* Bars */}
            {BRAND_HEALTH.bars.map((b) => (
              <View key={b.label} style={d.healthBar}>
                <View style={d.healthBarLabelRow}>
                  <Text style={d.healthBarLabel}>{b.label}</Text>
                  <Text style={d.healthBarVal}>{b.value}</Text>
                </View>
                <View style={d.healthTrack}>
                  <View style={[d.healthFill, { width: `${b.value}%` as any }]} />
                </View>
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
    </View>
  );
}

const d = StyleSheet.create({
  root:           { flexDirection: 'row', backgroundColor: C.bg },
  sidebar:        { width: 220, backgroundColor: '#0A0B0A', borderRightWidth: 1, borderRightColor: C.border, paddingTop: 24, paddingBottom: 16 },
  sideLogoRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 28 },
  sideLogoBadge:  { width: 28, height: 28, borderRadius: 7, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' },
  sideLogoText:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#0B0B0B' },
  sideLogoLabel:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.fg },
  navItem:        { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10, marginHorizontal: 8, borderRadius: 10 },
  navItemActive:  { backgroundColor: '#0D2B1A' },
  navLabel:       { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.muted },
  navLabelActive: { color: C.fg, fontFamily: 'Inter_600SemiBold' },
  sideUser:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: C.border },
  sideAvatar:     { width: 32, height: 32, borderRadius: 16, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  sideAvatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.green },
  sideUserName:   { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.fg },
  sideUserPlan:   { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.green, marginTop: 1 },
  main:           { flex: 1 },
  mainContent:    { padding: 24, gap: 16, paddingBottom: 40 },
  topBar:         { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  topGreet:       { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.fg, marginBottom: 4 },
  topSub:         { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.muted },
  topRight:       { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox:      { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, minWidth: 200 },
  searchText:     { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.muted, flex: 1 },
  searchKbd:      { backgroundColor: C.border, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  searchKbdText:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: C.muted },
  topIconBtn:     { width: 36, height: 36, borderRadius: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  exportBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  exportBtnText:  { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.fg },
  statsRow:       { flexDirection: 'row', gap: 12 },
  dStatCard:      { flex: 1, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18 },
  dStatTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  dStatLabel:     { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.muted },
  dStatIcon:      { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  dStatValue:     { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.fg, letterSpacing: -0.5 },
  dStatChange:    { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  midRow:         { flexDirection: 'row', gap: 16 },
  bottomRow:      { flexDirection: 'row', gap: 16 },
  panel:          { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, padding: 18 },
  panelHead:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  panelTitle:     { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.fg },
  pillBtn:        { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.border, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 },
  pillBtnText:    { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.fg },
  viewAll:        { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.green },
  insightRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  insightIcon:    { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  insightTitle:   { fontSize: 12, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  insightDesc:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted },
  productRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  productThumb:   { width: 38, height: 38, borderRadius: 9, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  productName:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.fg },
  productSold:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted, marginTop: 1 },
  productRev:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.fg },
  orderRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  orderId:        { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.green },
  orderCustomer:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted, marginTop: 1 },
  orderAmt:       { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.fg, marginRight: 8 },
  paidBadge:      { backgroundColor: '#0D2B1A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  paidText:       { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.green },
  healthCircleRow:{ alignItems: 'center', paddingVertical: 12 },
  healthCircle:   { width: 96, height: 96, position: 'relative' },
  healthScoreBox: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  healthScore:    { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.fg, lineHeight: 28 },
  healthLabel:    { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.muted },
  healthBar:      { marginBottom: 10 },
  healthBarLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  healthBarLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.muted },
  healthBarVal:   { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.fg },
  healthTrack:    { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  healthFill:     { height: 4, backgroundColor: C.green, borderRadius: 2 },
});

// ─── Root export ──────────────────────────────────────────────────────────────

export default function SellerDashboard() {
  const { width } = useWindowDimensions();
  if (Platform.OS === 'web' && width >= 768) return <DesktopDashboard />;
  return <MobileDashboard />;
}
