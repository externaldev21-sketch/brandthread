import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Platform, Dimensions, useWindowDimensions, RefreshControl,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEMO_ORDERS, DEMO_PRODUCTION, DEMO_INVENTORY,
  SETUP_TASKS, TODAY_PRIORITIES, RECENT_ACTIVITY, DEMO_ANALYTICS,
} from '@/services/data';
import type { Priority, ActivityItem, SetupTask } from '@/services/data';
import type { OrderStatus } from '@/services/types';

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const PURPLE = '#8B5CF6';
const BLUE   = '#3B82F6';
const CYAN   = '#06B6D4';
const ORANGE = '#F97316';
const RED    = '#EF4444';
const GOLD   = '#FBBF24';

// ─── Greeting ─────────────────────────────────────────────────────────────────
function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Hero stats ───────────────────────────────────────────────────────────────
const SPARK_1 = [30, 38, 35, 52, 47, 65, 55, 78, 70, 83, 79, 100];
const SPARK_2 = [40, 45, 38, 60, 52, 70, 58, 80, 72, 88, 82, 95];
const SPARK_3 = [55, 60, 52, 72, 65, 78, 68, 85, 77, 90, 84, 98];
const SPARK_4 = [25, 35, 30, 48, 42, 58, 50, 70, 64, 80, 75, 92];
const SPARK_5 = [18, 25, 22, 34, 30, 42, 36, 52, 46, 60, 55, 72];
const SPARK_6 = [60, 55, 58, 70, 65, 78, 70, 82, 76, 88, 83, 95];

const HERO_STATS = [
  { label: 'Revenue',      value: '$83,491', change: '+37.5%', up: true,  icon: 'trending-up'  as const, color: GREEN,  spark: SPARK_1 },
  { label: 'Orders',       value: '1,892',   change: '+24.1%', up: true,  icon: 'shopping-bag' as const, color: BLUE,   spark: SPARK_2 },
  { label: 'Visitors',     value: '98,241',  change: '+19.6%', up: true,  icon: 'users'        as const, color: CYAN,   spark: SPARK_3 },
  { label: 'Conversion',   value: '1.53%',   change: '+0.12%', up: true,  icon: 'percent'      as const, color: PURPLE, spark: SPARK_4 },
  { label: 'Avg Order',    value: '$44.10',  change: '+8.7%',  up: true,  icon: 'tag'          as const, color: ORANGE, spark: SPARK_5 },
  { label: 'Pend. Payout', value: '$1,842',  change: 'Jul 21', up: true,  icon: 'dollar-sign'  as const, color: GOLD,   spark: SPARK_6 },
];

// ─── Chart data ───────────────────────────────────────────────────────────────
const CHART_PERIODS: { id: string; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d',    label: '7 days' },
  { id: '30d',   label: '30 days' },
  { id: '90d',   label: '90 days' },
];
const CHART_DATA   = [8, 18, 14, 30, 24, 42, 35, 55, 48, 63, 58, 72, 65, 80, 74, 83];
const CHART_LABELS = ['Jun 11', 'Jun 18', 'Jun 25', 'Jul 2', 'Jul 9'];

// ─── Quick actions ────────────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { label: 'Create Design', icon: 'pen-tool'      as const, color: PURPLE, route: '/design-canvas' },
  { label: 'Add Product',   icon: 'plus-circle'   as const, color: GREEN,  route: '/add-product'  },
  { label: 'Manufacturer',  icon: 'tool'          as const, color: CYAN,   route: '/manufacturer' },
  { label: 'Create Content',icon: 'video'         as const, color: ORANGE, route: '/content'      },
  { label: 'View Orders',   icon: 'shopping-bag'  as const, color: BLUE,   route: '/(tabs)/orders'   },
  { label: 'Store Builder', icon: 'layout'        as const, color: '#EC4899', route: '/store-builder' },
  { label: 'Ship Label',    icon: 'truck'         as const, color: GOLD,   route: '/shipping'        },
  { label: 'Discount',      icon: 'tag'           as const, color: RED,    route: '/(tabs)/marketing'},
];

// ─── Order snapshot ───────────────────────────────────────────────────────────
function orderSnapshot() {
  const all = DEMO_ORDERS;
  return [
    { label: 'New',     count: all.filter(o => o.status === 'new').length,           color: BLUE,   filter: 'unfulfilled' },
    { label: 'Process', count: all.filter(o => o.status === 'processing').length,    color: PURPLE, filter: 'processing' },
    { label: 'Ready',   count: all.filter(o => o.status === 'ready_to_ship').length, color: CYAN,   filter: 'ready_to_ship' },
    { label: 'Shipped', count: all.filter(o => o.status === 'shipped').length,       color: GREEN,  filter: 'shipped' },
    { label: 'Returns', count: all.filter(o => o.status === 'refunded').length,      color: RED,    filter: 'returns' },
  ];
}

// ─── Production stages ────────────────────────────────────────────────────────
const STAGE_ORDER = ['quote', 'sample', 'approved', 'production', 'quality_check', 'shipping', 'delivered'];

function stageIndex(s: string) { return STAGE_ORDER.indexOf(s); }

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color, width, height = 40 }: { data: number[]; color: string; width: number; height?: number }) {
  if (data.length < 2) return null;
  const padY = 4; const plotH = height - padY * 2;
  const min = Math.min(...data); const max = Math.max(...data); const range = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => ({ x: i * stepX, y: padY + plotH - ((v - min) / range) * plotH }));
  const line = pts.reduce((a, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1]; const mx = (prev.x + p.x) / 2;
    return `${a} C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height}>
      <Path d={area} fill={color} fillOpacity={0.12} />
      <Path d={line} stroke={color} strokeWidth={1.8} fill="none" strokeLinecap="round" />
      <Circle cx={last.x} cy={last.y} r={3} fill={color} />
    </Svg>
  );
}

// ─── Revenue chart ────────────────────────────────────────────────────────────
function RevenueChart({ width, height = 150 }: { width: number; height?: number }) {
  const padL = 44; const padR = 12; const padTop = 10; const padBot = 26;
  const plotW = width - padL - padR; const plotH = height - padTop - padBot;
  const max = 100; const stepX = plotW / (CHART_DATA.length - 1);
  const pts = CHART_DATA.map((v, i) => ({ x: padL + i * stepX, y: padTop + plotH - (v / max) * plotH }));
  const line = pts.reduce((a, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = pts[i - 1]; const mx = (prev.x + p.x) / 2;
    return `${a} C ${mx} ${prev.y}, ${mx} ${p.y}, ${p.x} ${p.y}`;
  }, '');
  const area = `${line} L ${pts[pts.length - 1].x} ${padTop + plotH} L ${padL} ${padTop + plotH} Z`;
  const yLabels = ['$100K', '$75K', '$50K', '$25K', '$0'];
  const last = pts[pts.length - 1];
  return (
    <View>
      <Svg width={width} height={height}>
        {yLabels.map((_, i) => {
          const y = padTop + (i / (yLabels.length - 1)) * plotH;
          return <Path key={i} d={`M ${padL} ${y} L ${width - padR} ${y}`} stroke={BORDER} strokeWidth={1} />;
        })}
        <Path d={area} fill={GREEN} fillOpacity={0.1} />
        <Path d={line} stroke={GREEN} strokeWidth={2} fill="none" strokeLinecap="round" />
        <Circle cx={last.x} cy={last.y} r={5} fill={GREEN} />
        <Circle cx={last.x} cy={last.y} r={9} fill={GREEN} fillOpacity={0.2} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, { paddingTop: padTop, paddingBottom: padBot }]} pointerEvents="none">
        {yLabels.map(l => <Text key={l} style={ch.yLabel}>{l}</Text>)}
      </View>
      <View style={[ch.xRow, { paddingLeft: padL, paddingRight: padR }]}>
        {CHART_LABELS.map(l => <Text key={l} style={ch.xLabel}>{l}</Text>)}
      </View>
    </View>
  );
}
const ch = StyleSheet.create({
  yLabel: { position: 'absolute', left: 0, fontSize: 9, fontFamily: 'Inter_400Regular', color: MUTED, width: 40, textAlign: 'right' },
  xRow:   { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  xLabel: { fontSize: 9, fontFamily: 'Inter_400Regular', color: MUTED },
});

// ─── Setup checklist ──────────────────────────────────────────────────────────
function SetupChecklist({ onDismiss }: { onDismiss: () => void }) {
  const [tasks, setTasks] = useState(SETUP_TASKS);
  const done = tasks.filter(t => t.done).length;
  const pct  = Math.round((done / tasks.length) * 100);
  const router = useRouter();

  function toggle(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  }

  return (
    <View style={sc.wrap}>
      <View style={sc.head}>
        <View style={{ flex: 1 }}>
          <Text style={sc.title}>Brand setup</Text>
          <Text style={sc.sub}>{done} of {tasks.length} complete · {pct}%</Text>
        </View>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="x" size={16} color={MUTED} />
        </TouchableOpacity>
      </View>
      {/* Progress bar */}
      <View style={sc.track}>
        <View style={[sc.fill, { width: `${pct}%` as any }]} />
      </View>
      {/* Task rows */}
      {tasks.map(task => (
        <TouchableOpacity
          key={task.id}
          style={sc.taskRow}
          onPress={() => toggle(task.id)}
          activeOpacity={0.8}
        >
          <View style={[sc.check, task.done && sc.checkDone]}>
            {task.done && <Feather name="check" size={10} color="#0A0B0A" />}
          </View>
          <View style={[sc.taskIcon, { backgroundColor: task.done ? GREEN + '15' : BORDER }]}>
            <Feather name={task.icon as keyof typeof Feather.glyphMap} size={13} color={task.done ? GREEN : MUTED} />
          </View>
          <Text style={[sc.taskLabel, task.done && sc.taskLabelDone]}>{task.label}</Text>
          {!task.done && (
            <TouchableOpacity
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(task.route as never); }}
              style={sc.goBtn}
            >
              <Text style={sc.goBtnText}>Go</Text>
              <Feather name="arrow-right" size={11} color={GREEN} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      ))}
    </View>
  );
}
const sc = StyleSheet.create({
  wrap:  { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: GREEN + '33', padding: 16, gap: 10 },
  head:  { flexDirection: 'row', alignItems: 'flex-start' },
  title: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  sub:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  track: { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  fill:  { height: 4, backgroundColor: GREEN, borderRadius: 2 },
  taskRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check:     { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: GREEN, borderColor: GREEN },
  taskIcon:  { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  taskLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: FG },
  taskLabelDone: { color: MUTED, textDecorationLine: 'line-through' },
  goBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: GREEN + '15', borderRadius: 8 },
  goBtnText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: GREEN },
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
export default function DashboardScreen() {
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { width: W } = useWindowDimensions();
  const topPad  = Platform.OS === 'web' ? 20 : insets.top;
  const cardW   = (W - 48) / 2;
  const [period,  setPeriod]  = useState('30d');
  const [showSetup, setShowSetup] = useState(true);
  const [priorities, setPriorities] = useState(TODAY_PRIORITIES);
  const [refresh,  setRefresh]  = useState(false);

  const snap   = orderSnapshot();
  const lowStk = DEMO_INVENTORY.filter(i => i.quantity <= i.lowStockThreshold);

  function nav(r: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(r as never);
  }

  function togglePriority(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPriorities(prev => prev.map(p => p.id === id ? { ...p, done: !p.done } : p));
  }

  function onRefresh() {
    setRefresh(true);
    setTimeout(() => setRefresh(false), 900);
  }

  return (
    <ScrollView
      style={d.root}
      contentContainerStyle={{ paddingTop: topPad + 6, paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refresh} onRefresh={onRefresh} tintColor={GREEN} />}
    >
      {/* ── Header ── */}
      <View style={d.header}>
        <View style={d.logoRow}>
          <LinearGradient colors={[PURPLE, '#5B21B6']} style={d.avatarBadge}>
            <Text style={d.avatarText}>D</Text>
          </LinearGradient>
          <View>
            <Text style={d.brandName}>Devon's Brand</Text>
            <Text style={d.planBadge}>Pro Plan</Text>
          </View>
        </View>
        <View style={d.headerRight}>
          <TouchableOpacity style={d.iconBtn} onPress={() => nav('/notifications-settings')}>
            <Feather name="bell" size={17} color={FG} />
            <View style={d.notifDot} />
          </TouchableOpacity>
          <TouchableOpacity style={d.iconBtn} onPress={() => nav('/ai-assistant')}>
            <Feather name="message-circle" size={17} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Greeting ── */}
      <View style={d.greetRow}>
        <Text style={d.greetTitle}>{greeting()}, Devon 👋</Text>
        <Text style={d.greetSub}>Here's your brand overview for today.</Text>
      </View>

      {/* ── Setup checklist ── */}
      {showSetup && (
        <View style={d.section}>
          <SetupChecklist onDismiss={() => setShowSetup(false)} />
        </View>
      )}

      {/* ── Stat cards 2×3 ── */}
      <View style={d.section}>
        <View style={d.sectionHead}>
          <Text style={d.sectionTitle}>Performance</Text>
          <View style={d.periodRow}>
            {CHART_PERIODS.map(p => (
              <TouchableOpacity
                key={p.id}
                style={[d.periodPill, period === p.id && d.periodPillActive]}
                onPress={() => { setPeriod(p.id); Haptics.selectionAsync(); }}
                activeOpacity={0.8}
              >
                <Text style={[d.periodText, period === p.id && d.periodTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={d.statGrid}>
          {HERO_STATS.map(s => (
            <TouchableOpacity
              key={s.label}
              style={[d.statCard, { width: cardW }]}
              activeOpacity={0.8}
              onPress={() => nav(s.label === 'Orders' ? '/(tabs)/orders' : '/(tabs)/analytics')}
            >
              <View style={d.statTop}>
                <Text style={d.statLabel}>{s.label}</Text>
                <View style={[d.statIconWrap, { backgroundColor: s.color + '22' }]}>
                  <Feather name={s.icon} size={13} color={s.color} />
                </View>
              </View>
              <Text style={d.statValue}>{s.value}</Text>
              <Text style={[d.statChange, { color: s.up ? GREEN : RED }]}>
                {s.up ? '↑' : '↓'} {s.change}
              </Text>
              <Sparkline data={s.spark} color={s.color} width={cardW - 28} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Revenue chart ── */}
      <View style={d.section}>
        <View style={d.sectionHead}>
          <Text style={d.sectionTitle}>Revenue</Text>
          <TouchableOpacity onPress={() => nav('/(tabs)/analytics')}><Text style={d.viewAll}>Analytics →</Text></TouchableOpacity>
        </View>
        <View style={d.card}>
          <Text style={d.chartAmt}>$83,491.23</Text>
          <Text style={[d.chartChange, { color: GREEN }]}>↑ 37.5% vs last period</Text>
          <View style={{ marginTop: 12 }}>
            <RevenueChart width={W - 72} />
          </View>
        </View>
      </View>

      {/* ── Today's priorities ── */}
      <View style={d.section}>
        <View style={d.sectionHead}>
          <Text style={d.sectionTitle}>Today's priorities</Text>
          <View style={d.pillBadge}>
            <Text style={d.pillBadgeText}>{priorities.filter(p => !p.done).length} left</Text>
          </View>
        </View>
        <View style={d.card}>
          {priorities.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              style={[d.priorityRow, i > 0 && d.rowBorder]}
              onPress={() => togglePriority(p.id)}
              activeOpacity={0.8}
            >
              <View style={[d.priorityCheck, p.done && { backgroundColor: GREEN, borderColor: GREEN }]}>
                {p.done && <Feather name="check" size={10} color="#0A0B0A" />}
              </View>
              <View style={[d.priorityIcon, { backgroundColor: p.color + '20' }]}>
                <Feather name={p.icon as keyof typeof Feather.glyphMap} size={14} color={p.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[d.priorityTitle, p.done && d.strikethrough]}>{p.title}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <Text style={d.priorityCat}>{p.category}</Text>
                  <View style={[d.dueDot, { backgroundColor: p.due === 'overdue' ? RED : p.due === 'today' ? ORANGE : MUTED }]} />
                  <Text style={[d.dueText, { color: p.due === 'overdue' ? RED : p.due === 'today' ? ORANGE : MUTED }]}>
                    {p.due === 'overdue' ? 'Overdue' : p.due === 'today' ? 'Today' : 'Upcoming'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => nav(p.route)}
                style={d.openBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="arrow-right" size={14} color={MUTED} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Orders snapshot ── */}
      <View style={d.section}>
        <View style={d.sectionHead}>
          <Text style={d.sectionTitle}>Orders</Text>
          <TouchableOpacity onPress={() => nav('/(tabs)/orders')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
        </View>
        <View style={d.snapRow}>
          {snap.map(item => (
            <TouchableOpacity
              key={item.label}
              style={d.snapCard}
              onPress={() => nav('/(tabs)/orders')}
              activeOpacity={0.8}
            >
              <Text style={[d.snapCount, { color: item.color }]}>{item.count}</Text>
              <Text style={d.snapLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Production snapshot ── */}
      {DEMO_PRODUCTION.length > 0 && (
        <View style={d.section}>
          <View style={d.sectionHead}>
            <Text style={d.sectionTitle}>Production</Text>
            <TouchableOpacity onPress={() => nav('/manufacturer')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
          </View>
          <View style={d.card}>
            {DEMO_PRODUCTION.map((job, i) => (
              <TouchableOpacity
                key={job.id}
                style={[d.prodRow, i > 0 && d.rowBorder]}
                onPress={() => nav('/manufacturer')}
                activeOpacity={0.8}
              >
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={d.prodProduct}>{job.product}</Text>
                  <Text style={d.prodMfg}>{job.manufacturer} · {job.quantity} units</Text>
                  <View style={d.prodTrack}>
                    <LinearGradient
                      colors={[PURPLE, CYAN]}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                      style={[d.prodFill, { width: `${job.progress}%` as any }]}
                    />
                  </View>
                  <Text style={d.prodETA}>Est. {job.estimatedCompletion}</Text>
                </View>
                <View style={[d.stageBadge]}>
                  <Text style={d.stageText}>
                    {job.stage.replace('_', ' ').replace(/^\w/, c => c.toUpperCase())}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Inventory alerts ── */}
      {lowStk.length > 0 && (
        <View style={d.section}>
          <View style={d.sectionHead}>
            <Text style={d.sectionTitle}>Inventory alerts</Text>
            <TouchableOpacity onPress={() => nav('/inventory')}><Text style={d.viewAll}>View All</Text></TouchableOpacity>
          </View>
          <View style={d.card}>
            {lowStk.slice(0, 4).map((item, i) => (
              <TouchableOpacity
                key={item.id}
                style={[d.invRow, i > 0 && d.rowBorder]}
                onPress={() => nav('/inventory')}
                activeOpacity={0.8}
              >
                <View style={d.invAlert}>
                  <Feather name={item.quantity === 0 ? 'alert-circle' : 'alert-triangle'} size={14} color={item.quantity === 0 ? RED : ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={d.invProduct}>{item.productName}</Text>
                  <Text style={d.invVariant}>{item.variant}</Text>
                </View>
                <View>
                  <Text style={[d.invQty, { color: item.quantity === 0 ? RED : ORANGE }]}>
                    {item.quantity === 0 ? 'Out of stock' : `${item.quantity} left`}
                  </Text>
                  <View style={d.restockBtn}>
                    <Text style={d.restockText}>Restock</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── Quick actions ── */}
      <View style={d.section}>
        <Text style={d.sectionTitle}>Quick actions</Text>
        <View style={d.actionGrid}>
          {QUICK_ACTIONS.map(a => (
            <TouchableOpacity key={a.label} style={d.actionCard} onPress={() => nav(a.route)} activeOpacity={0.8}>
              <View style={[d.actionIcon, { backgroundColor: a.color + '20' }]}>
                <Feather name={a.icon} size={18} color={a.color} />
              </View>
              <Text style={d.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Recent activity ── */}
      <View style={d.section}>
        <View style={d.sectionHead}>
          <Text style={d.sectionTitle}>Recent activity</Text>
        </View>
        <View style={d.card}>
          {RECENT_ACTIVITY.map((item, i) => (
            <TouchableOpacity
              key={item.id}
              style={[d.actRow, i > 0 && d.rowBorder]}
              onPress={() => nav(item.route)}
              activeOpacity={0.8}
            >
              {item.unread && <View style={d.unreadDot} />}
              <View style={[d.actIcon, { backgroundColor: item.color + '20' }]}>
                <Feather name={item.icon as keyof typeof Feather.glyphMap} size={14} color={item.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={d.actTitle}>{item.title}</Text>
                <Text style={d.actDesc}>{item.desc}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Text style={d.actTime}>{item.time}</Text>
                <Feather name="chevron-right" size={13} color={MUTED} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const d = StyleSheet.create({
  root:       { flex: 1, backgroundColor: BG },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  logoRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatarBadge:{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  brandName:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  planBadge:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: GREEN },
  headerRight:{ flexDirection: 'row', gap: 6 },
  iconBtn:    { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  notifDot:   { position: 'absolute', top: 7, right: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: RED, borderWidth: 1.5, borderColor: BG },

  greetRow:   { paddingHorizontal: 20, marginBottom: 20 },
  greetTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.4 },
  greetSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 4 },

  section:    { paddingHorizontal: 20, marginBottom: 20 },
  sectionHead:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle:{ fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },
  viewAll:    { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: GREEN },
  card:       { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  rowBorder:  { borderTopWidth: 1, borderTopColor: BORDER },

  periodRow:   { flexDirection: 'row', gap: 4 },
  periodPill:  { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  periodPillActive: { backgroundColor: GREEN + '20', borderColor: GREEN },
  periodText:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED },
  periodTextActive: { color: GREEN },

  statGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard:   { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 14, gap: 4 },
  statTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  statLabel:  { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED },
  statIconWrap:{ width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  statValue:  { fontSize: 20, fontFamily: 'Inter_700Bold', color: FG, letterSpacing: -0.3 },
  statChange: { fontSize: 10, fontFamily: 'Inter_600SemiBold', marginBottom: 6 },

  chartAmt:   { fontSize: 24, fontFamily: 'Inter_700Bold', color: FG, paddingHorizontal: 18, paddingTop: 16, letterSpacing: -0.5 },
  chartChange:{ fontSize: 12, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 18, marginTop: 2 },

  pillBadge:     { backgroundColor: ORANGE + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pillBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: ORANGE },

  priorityRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  priorityCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  priorityIcon:  { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  priorityTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  strikethrough: { color: MUTED, textDecorationLine: 'line-through' },
  priorityCat:   { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  dueDot:        { width: 4, height: 4, borderRadius: 2 },
  dueText:       { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  openBtn:       { padding: 6 },

  snapRow:    { flexDirection: 'row', gap: 8 },
  snapCard:   { flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 14, gap: 4 },
  snapCount:  { fontSize: 22, fontFamily: 'Inter_700Bold' },
  snapLabel:  { fontSize: 9, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },

  prodRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  prodProduct: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  prodMfg:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  prodTrack:   { height: 3, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  prodFill:    { height: 3, borderRadius: 2 },
  prodETA:     { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  stageBadge:  { backgroundColor: PURPLE + '20', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  stageText:   { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: PURPLE },

  invRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13 },
  invAlert:   { width: 32, height: 32, borderRadius: 9, backgroundColor: ORANGE + '15', alignItems: 'center', justifyContent: 'center' },
  invProduct: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  invVariant: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  invQty:     { fontSize: 11, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  restockBtn: { backgroundColor: ORANGE + '20', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  restockText:{ fontSize: 10, fontFamily: 'Inter_600SemiBold', color: ORANGE },

  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCard: { width: '22.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 14, gap: 8 },
  actionIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  actionLabel:{ fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },

  actRow:   { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  unreadDot:{ position: 'absolute', left: 6, top: 13, width: 6, height: 6, borderRadius: 3, backgroundColor: GREEN },
  actIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  actDesc:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  actTime:  { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
});
