/**
 * Analytics Overview — Brandthread Seller App
 * Premium analytics hub. All data from analyticsService (stable, no random).
 */
import React, { useState, useEffect, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Platform, useWindowDimensions, ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, FONT, FS,
} from '@/lib/theme';
import {
  getOverview, getFilterState, saveFilterState,
  dismissInsight, completeInsight, exportAnalytics,
} from '@/services/analyticsService';
import {
  AnalyticsOverview, AnalyticsFilterState, AnalyticsMetric,
  AnalyticsInsight, AnalyticsPoint, DATE_RANGE_OPTIONS, COMPARISON_OPTIONS,
  ANALYTICS_SECTIONS, DateRangeKey,
} from '@/services/analyticsTypes';

type ChartMetric = 'revenue' | 'orders' | 'profit' | 'visitors' | 'conversion';

const CHART_METRICS: { key: ChartMetric; label: string }[] = [
  { key: 'revenue',    label: 'Revenue'    },
  { key: 'orders',     label: 'Orders'     },
  { key: 'profit',     label: 'Profit'     },
  { key: 'visitors',   label: 'Visitors'   },
  { key: 'conversion', label: 'Conversion' },
];

const DATE_PILLS: DateRangeKey[] = ['7d', '30d', '90d', 'this_month', 'this_year'];

const SECTION_ROUTES: Record<string, string> = {
  sales:      '/analytics-sales',
  products:   '/analytics-products',
  customers:  '/analytics-customers',
  content:    '/analytics-content',
  store:      '/analytics-store',
  marketing:  '/analytics-marketing',
  inventory:  '/analytics-inventory',
  production: '/analytics-production',
  profit:     '/analytics-profit',
};

function insightIcon(type: AnalyticsInsight['type']): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'opportunity':    return 'zap';
    case 'warning':        return 'alert-triangle';
    case 'action_needed':  return 'alert-circle';
    default:               return 'info';
  }
}
function insightColor(type: AnalyticsInsight['type']): string {
  switch (type) {
    case 'opportunity':    return GOLD;
    case 'warning':        return ORANGE;
    case 'action_needed':  return RED;
    default:               return BLUE;
  }
}
function insightBg(type: AnalyticsInsight['type']): string {
  switch (type) {
    case 'opportunity':    return 'rgba(245,158,11,0.12)';
    case 'warning':        return ORANGE_DIM;
    case 'action_needed':  return RED_DIM;
    default:               return BLUE_DIM;
  }
}

function Sparkline({ points, color = PURPLE }: { points: AnalyticsPoint[]; color?: string }) {
  const safePoints = Array.isArray(points) ? points : [];
  if (!safePoints.length) return null;
  const max = Math.max(...safePoints.map(p => p.value), 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 18, gap: 1.5 }}>
      {safePoints.slice(-10).map((p, i) => (
        <View
          key={i}
          style={{
            flex: 1, borderRadius: 2,
            height: Math.max(3, (p.value / max) * 18),
            backgroundColor: color,
            opacity: 0.55,
          }}
        />
      ))}
    </View>
  );
}

function MetricCard({ m, width }: { m: AnalyticsMetric; width: number }) {
  const isGoodDown = m.key === 'refundRate' || m.key === 'refunds';
  const realUp = isGoodDown ? m.trend === 'down' : m.trend === 'up';
  const changeColor = m.trend === 'flat' ? MUTED : realUp ? SUCCESS : RED;
  const arrowIcon: keyof typeof Feather.glyphMap = m.trend === 'flat' ? 'minus' : m.trend === 'up' ? 'trending-up' : 'trending-down';

  return (
    <View style={[styles.metricCard, { width }]}>
      <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
      <Text style={styles.metricValue}>{m.formatted}</Text>
      <View style={styles.metricChangeRow}>
        <Feather name={arrowIcon} size={10} color={changeColor} />
        <Text style={[styles.metricChangePct, { color: changeColor }]}>
          {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
        </Text>
        <Text style={styles.metricVs} numberOfLines={1}>vs prev</Text>
      </View>
      <View style={{ marginTop: 6 }}>
        <Sparkline points={m.sparkline} color={realUp ? SUCCESS : RED} />
      </View>
    </View>
  );
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const cardW  = (screenWidth - 48) / 2;

  const [overview,       setOverview]       = useState<AnalyticsOverview | null>(null);
  const [filter,         setFilter]         = useState<AnalyticsFilterState | null>(null);
  const [loading,        setLoading]        = useState(true);
  const [refreshing,     setRefreshing]     = useState(false);
  const [chartMetric,    setChartMetric]    = useState<ChartMetric>('revenue');
  const [groupBy,        setGroupBy]        = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [tappedBar,      setTappedBar]      = useState<number | null>(null);
  const [insights,       setInsights]       = useState<AnalyticsInsight[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const ov = await getOverview(f);
      setOverview(ov);
      setInsights((Array.isArray(ov.insights) ? ov.insights : []).filter(i => !i.dismissed).slice(0, 3));
    } catch {
      setOverview(null);
      setInsights([]);
    }
    setLoading(false);
    setRefreshing(false);
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setDateRange = async (key: DateRangeKey) => {
    Haptics.selectionAsync();
    const dr = DATE_RANGE_OPTIONS.find(d => d.key === key)!;
    const newFilter: AnalyticsFilterState = { ...filter!, dateRange: dr };
    setFilter(newFilter);
    await saveFilterState(newFilter);
    load();
  };

  const handleDismiss = async (id: string) => {
    await dismissInsight(id);
    setInsights(prev => prev.filter(i => i.id !== id));
  };

  const handleExport = async () => {
    if (!filter) return;
    Alert.alert('Exporting…', 'Generating CSV for overview.');
    try {
      await exportAnalytics('overview', filter.dateRange);
      Alert.alert('Export ready', 'Your overview CSV has been generated.');
    } catch {
      Alert.alert('Export failed', 'Please try again.');
    }
  };

  const chartPoints = (): AnalyticsPoint[] => {
    if (!overview) return [];
    const safe = (arr: unknown): AnalyticsPoint[] => Array.isArray(arr) ? arr : [];
    switch (chartMetric) {
      case 'revenue':    return safe(overview.revenueChart);
      case 'orders':     return safe(overview.ordersChart);
      case 'visitors':   return safe(overview.visitorsChart);
      case 'profit':     return safe(overview.grossRevenue?.sparkline);
      case 'conversion': return safe(overview.conversionRate?.sparkline);
      default:           return safe(overview.revenueChart);
    }
  };

  const chartMax = Math.max(...chartPoints().map(p => p.value), 1);

  const chartMetricValue = (): string => {
    if (!overview) return '—';
    switch (chartMetric) {
      case 'revenue':    return overview.grossRevenue.formatted;
      case 'orders':     return overview.orders.formatted;
      case 'visitors':   return overview.storeVisitors.formatted;
      case 'profit':     return overview.profitEstimate.formatted;
      case 'conversion': return overview.conversionRate.formatted;
    }
  };

  const chartMetricChange = (): { pct: string; up: boolean } => {
    if (!overview) return { pct: '—', up: true };
    let m = overview.grossRevenue;
    switch (chartMetric) {
      case 'orders':     m = overview.orders; break;
      case 'visitors':   m = overview.storeVisitors; break;
      case 'profit':     m = overview.profitEstimate; break;
      case 'conversion': m = overview.conversionRate; break;
    }
    return { pct: `${m.changePct > 0 ? '+' : ''}${m.changePct.toFixed(1)}%`, up: m.trend === 'up' };
  };

  const tappedPoint = tappedBar !== null ? chartPoints()[tappedBar] : null;

  const OVERVIEW_METRICS: (keyof AnalyticsOverview)[] = [
    'grossRevenue','netRevenue','profitEstimate','orders','unitsSold',
    'storeVisitors','conversionRate','avgOrderValue','returningCustomerRate',
    'refundRate','productClicks','contentAttributedRev','marketingAttributedRev','pendingPayouts',
  ];

  if (loading) {
    return (
      <View style={[styles.loadWrap, { paddingTop: topPad + 48 }]}>
        <ActivityIndicator size="large" color={PURPLE} />
        <Text style={styles.loadText}>Loading analytics…</Text>
      </View>
    );
  }

  const chg = chartMetricChange();

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />
      }
    >
      {/* ── Header ── */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.pageTitle}>Analytics</Text>
          <Text style={styles.updatedText}>Updated recently · {filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleExport} style={styles.iconBtn}>
            <Feather name="share" size={18} color={PURPLE} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
            <Feather name="refresh-cw" size={16} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Date range pills ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingRight: 16, gap: 8, flexDirection: 'row' }}>
        {DATE_PILLS.map(key => {
          const opt = DATE_RANGE_OPTIONS.find(d => d.key === key)!;
          const active = filter?.dateRange.key === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setDateRange(key)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Comparison pills ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ paddingRight: 16, gap: 8, flexDirection: 'row' }}>
        {COMPARISON_OPTIONS.map(opt => {
          const active = filter?.comparison.key === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              onPress={() => {
                Haptics.selectionAsync();
                const newFilter: AnalyticsFilterState = { ...filter!, comparison: opt };
                setFilter(newFilter);
                saveFilterState(newFilter);
              }}
              style={[styles.pillSm, active && styles.pillActive]}
            >
              <Text style={[styles.pillSmText, active && styles.pillTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Section nav ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ paddingRight: 16, gap: 8, flexDirection: 'row' }}>
        {ANALYTICS_SECTIONS.map(s => {
          const isOverview = s.key === 'overview';
          return (
            <TouchableOpacity
              key={s.key}
              onPress={() => {
                if (!isOverview) {
                  Haptics.selectionAsync();
                  router.push(SECTION_ROUTES[s.key] as never);
                }
              }}
              style={[styles.sectionPill, isOverview && styles.sectionPillActive]}
            >
              <Feather name={s.icon} size={12} color={isOverview ? '#FFF' : MUTED} />
              <Text style={[styles.sectionPillText, isOverview && styles.sectionPillTextActive]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Revenue chart ── */}
      <View style={styles.chartCard}>
        {/* metric selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
          {CHART_METRICS.map(cm => (
            <TouchableOpacity
              key={cm.key}
              onPress={() => { setChartMetric(cm.key); setTappedBar(null); }}
              style={[styles.chartTab, chartMetric === cm.key && styles.chartTabActive]}
            >
              <Text style={[styles.chartTabText, chartMetric === cm.key && styles.chartTabTextActive]}>{cm.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          {(['daily','weekly','monthly'] as const).map(g => (
            <TouchableOpacity key={g} onPress={() => setGroupBy(g)} style={[styles.groupTab, groupBy === g && styles.groupTabActive]}>
              <Text style={[styles.groupTabText, groupBy === g && styles.groupTabTextActive]}>{g[0].toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* big number */}
        <View style={styles.chartAmountRow}>
          <Text style={styles.chartAmount}>{chartMetricValue()}</Text>
          <View style={[styles.changeBadge, { backgroundColor: chg.up ? SUCCESS_DIM : RED_DIM }]}>
            <Feather name={chg.up ? 'trending-up' : 'trending-down'} size={11} color={chg.up ? SUCCESS : RED} />
            <Text style={[styles.changeBadgeText, { color: chg.up ? SUCCESS : RED }]}>{chg.pct}</Text>
          </View>
        </View>

        {/* bars */}
        <View style={styles.barsRow}>
          {chartPoints().map((p, i) => {
            const h = Math.max(4, (p.value / chartMax) * 90);
            const tapped = tappedBar === i;
            return (
              <TouchableOpacity
                key={i}
                activeOpacity={0.7}
                onPress={() => { setTappedBar(tapped ? null : i); }}
                style={styles.barWrap}
              >
                <View style={[styles.bar, { height: h, backgroundColor: tapped ? PURPLE : PURPLE_DIM }]} />
              </TouchableOpacity>
            );
          })}
        </View>

        {/* tooltip */}
        {tappedPoint && (
          <View style={styles.tooltip}>
            <Text style={styles.tooltipDate}>{tappedPoint.date}</Text>
            <Text style={styles.tooltipValue}>
              {chartMetric === 'revenue' || chartMetric === 'profit'
                ? `$${tappedPoint.value.toLocaleString()}`
                : chartMetric === 'conversion'
                  ? `${tappedPoint.value}%`
                  : tappedPoint.value.toLocaleString()}
            </Text>
          </View>
        )}

        <View style={styles.xAxisRow}>
          <Text style={styles.xLabel}>30 days ago</Text>
          <Text style={styles.xLabel}>Today</Text>
        </View>
      </View>

      {/* ── Metric cards ── */}
      <Text style={styles.sectionTitle}>Overview Metrics</Text>
      <View style={styles.metricsGrid}>
        {OVERVIEW_METRICS.map(key => {
          const m = overview?.[key] as AnalyticsMetric | undefined;
          if (!m || typeof m !== 'object' || !('value' in m)) return null;
          return <MetricCard key={key} m={m} width={cardW} />;
        })}
      </View>

      {/* ── Insights ── */}
      {insights.length > 0 && (
        <>
          <View style={styles.insightHeader}>
            <Text style={styles.sectionTitle}>Brandthread Insights</Text>
            <TouchableOpacity><Text style={styles.viewAll}>View all</Text></TouchableOpacity>
          </View>
          {insights.map(insight => (
            <View key={insight.id} style={[styles.insightCard, { borderLeftColor: insightColor(insight.type) }]}>
              <View style={[styles.insightIconWrap, { backgroundColor: insightBg(insight.type) }]}>
                <Feather name={insightIcon(insight.type)} size={16} color={insightColor(insight.type)} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.insightTitle}>{insight.title}</Text>
                <Text style={styles.insightWhat} numberOfLines={2}>{insight.what}</Text>
                <Text style={styles.insightAction} numberOfLines={1}>{insight.action}</Text>
                <View style={styles.insightActions}>
                  {insight.route && (
                    <TouchableOpacity
                      onPress={() => { Haptics.selectionAsync(); router.push(insight.route! as never); }}
                      style={styles.insightBtn}
                    >
                      <Text style={styles.insightBtnText}>Take action</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => handleDismiss(insight.id)} style={styles.insightDismiss}>
                    <Text style={styles.insightDismissText}>Dismiss</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
    <AIBrainFAB context={{ screen: 'analytics' as const }} bottomOffset={72} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll:        { flex: 1, backgroundColor: BG },
  content:       { paddingHorizontal: 16 },
  loadWrap:      { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadText:      { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },

  headerRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  pageTitle:     { fontSize: 28, fontFamily: FONT.bold, color: FG },
  updatedText:   { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  pill:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  pillActive:    { backgroundColor: PURPLE, borderColor: PURPLE },
  pillText:      { fontSize: 13, fontFamily: FONT.medium, color: MUTED },
  pillTextActive:{ color: '#FFF' },
  pillSm:        { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  pillSmText:    { fontSize: 11, fontFamily: FONT.medium, color: MUTED },

  sectionPill:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  sectionPillActive: { backgroundColor: PURPLE, borderColor: PURPLE },
  sectionPillText:   { fontSize: 12, fontFamily: FONT.medium, color: MUTED },
  sectionPillTextActive: { color: '#FFF' },

  chartCard:     { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 24 },
  chartTab:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: SURFACE },
  chartTabActive:{ backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE },
  chartTabText:  { fontSize: 11, fontFamily: FONT.medium, color: MUTED },
  chartTabTextActive: { color: PURPLE_LIGHT },
  groupTab:      { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE },
  groupTabActive:{ backgroundColor: PURPLE_DIM },
  groupTabText:  { fontSize: 10, fontFamily: FONT.semibold, color: MUTED },
  groupTabTextActive: { color: PURPLE_LIGHT },

  chartAmountRow:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  chartAmount:   { fontSize: 32, fontFamily: FONT.bold, color: FG },
  changeBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  changeBadgeText:{ fontSize: 12, fontFamily: FONT.semibold },

  barsRow:       { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2, marginBottom: 4 },
  barWrap:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 90 },
  bar:           { width: '100%', borderRadius: 3 },
  tooltip:       { backgroundColor: CARD_ELEVATED, borderRadius: 8, padding: 8, marginBottom: 8, alignSelf: 'center', borderWidth: 1, borderColor: BORDER_ACTIVE },
  tooltipDate:   { fontSize: 10, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },
  tooltipValue:  { fontSize: 15, fontFamily: FONT.bold, color: FG, textAlign: 'center' },
  xAxisRow:      { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  xLabel:        { fontSize: 10, fontFamily: FONT.regular, color: SUBTLE },

  sectionTitle:  { fontSize: 16, fontFamily: FONT.semibold, color: FG, marginBottom: 12 },
  metricsGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  metricCard:    { backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER },
  metricLabel:   { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginBottom: 4 },
  metricValue:   { fontSize: 22, fontFamily: FONT.bold, color: FG, marginBottom: 4 },
  metricChangeRow:{ flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricChangePct:{ fontSize: 11, fontFamily: FONT.semibold },
  metricVs:      { fontSize: 10, fontFamily: FONT.regular, color: SUBTLE, flex: 1 },

  insightHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  viewAll:       { fontSize: 13, fontFamily: FONT.medium, color: PURPLE },
  insightCard:   { flexDirection: 'row', gap: 12, backgroundColor: CARD_ELEVATED, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 3, marginBottom: 10 },
  insightIconWrap:{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  insightTitle:  { fontSize: 14, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  insightWhat:   { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginBottom: 4 },
  insightAction: { fontSize: 12, fontFamily: FONT.medium, color: SUBTLE, marginBottom: 10 },
  insightActions:{ flexDirection: 'row', gap: 12 },
  insightBtn:    { paddingVertical: 4 },
  insightBtnText:{ fontSize: 13, fontFamily: FONT.semibold, color: PURPLE },
  insightDismiss:{ paddingVertical: 4 },
  insightDismissText:{ fontSize: 13, fontFamily: FONT.medium, color: SUBTLE },
});
