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
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
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
  { key: 'visitors',   label: 'Visitors'   },
];

const DATE_PILLS: DateRangeKey[] = ['today', '7d', '30d', '90d'];

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

function Sparkline({ points, color }: { points: AnalyticsPoint[]; color?: string }) {
  const colors = useColors();
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
            backgroundColor: color ?? colors.primary,
            opacity: 0.55,
          }}
        />
      ))}
    </View>
  );
}

function MetricCard({ m, width }: { m: AnalyticsMetric; width: number }) {
  return (
    <View style={[styles.metricCard, { width }]}>
      <Text style={styles.metricLabel} numberOfLines={1}>{m.label}</Text>
      <Text style={styles.metricValue}>{m.formatted}</Text>
    </View>
  );
}

function TrendLineChart({ points, color, width }: { points: AnalyticsPoint[]; color: string; width: number }) {
  const height = 132;
  const chartWidth = Math.max(240, width);
  const values = points.map(point => point.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth,
    y: 12 + (1 - (point.value - min) / range) * (height - 28),
  }));
  const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = coords.length ? `${path} L ${chartWidth} ${height} L 0 ${height} Z` : '';

  return (
    <View style={styles.lineChartWrap}>
      <Svg width={chartWidth} height={height}>
        <Defs>
          <SvgGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.32" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </SvgGradient>
        </Defs>
        {area ? <Path d={area} fill="url(#trendFill)" /> : null}
        {path ? <Path d={path} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /> : null}
        {coords.length ? <Circle cx={coords[coords.length - 1].x} cy={coords[coords.length - 1].y} r={4.5} fill={color} stroke={CARD} strokeWidth={2} /> : null}
      </Svg>
    </View>
  );
}

export default function AnalyticsScreen() {
  const colors = useColors();
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
  const [error,          setError]          = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false, filterOverride?: AnalyticsFilterState) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const f = filterOverride ?? filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const ov = await getOverview(f);
      setOverview(ov);
      setError(null);
      setInsights((Array.isArray(ov.insights) ? ov.insights : []).filter(i => !i.dismissed).slice(0, 3));
    } catch (err) {
      setOverview(null);
      setInsights([]);
      setError(err instanceof Error ? err.message : 'Analytics are unavailable.');
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
    load(false, newFilter);
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
      case 'profit':     return safe(overview.profitEstimate?.sparkline);
      case 'conversion': return safe(overview.conversionRate?.sparkline);
      default:           return safe(overview.revenueChart);
    }
  };

  const chartMetricValue = (): string => {
    if (!overview) return '—';
    switch (chartMetric) {
      case 'revenue':    return overview.grossRevenue.formatted;
      case 'orders':     return overview.orders.formatted;
      case 'visitors':   return overview.storeVisitors.formatted;
      case 'profit':     return overview.profitEstimate?.formatted ?? '—';
      case 'conversion': return overview.conversionRate?.formatted ?? '—';
    }
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
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadText}>Loading analytics…</Text>
      </View>
    );
  }
  if (error) {
    return <View style={[styles.loadWrap, { paddingTop: topPad + 48 }]}><Feather name="alert-circle" size={32} color={MUTED} /><Text style={styles.loadText}>{error}</Text><TouchableOpacity onPress={() => load()}><Text style={{ color: colors.primary, fontFamily: FONT.semibold }}>Retry</Text></TouchableOpacity></View>;
  }

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />
      }
    >
      {/* ── Header ── */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.pageTitle}>Analytics</Text>
          <Text style={styles.updatedText}>Updated recently · All time</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleExport} style={styles.iconBtn}>
            <Feather name="share" size={18} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => load(true)} style={styles.iconBtn}>
            <Feather name="refresh-cw" size={16} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={[styles.updatedText, { marginBottom: 16 }]}>
        Date-range comparison is unavailable until the API can return period-scoped totals.
      </Text>

      {/* ── Performance range ── */}
      <View style={styles.rangePills}>
        {DATE_PILLS.map(key => {
          const option = DATE_RANGE_OPTIONS.find(item => item.key === key);
          const selected = filter?.dateRange.key === key;
          return (
            <TouchableOpacity
              key={key}
              style={[styles.rangePill, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              onPress={() => setDateRange(key)}
            >
              <Text style={[styles.rangePillText, selected && { color: colors.primaryForeground }]}>
                {key === '7d' ? '7 days' : key === '30d' ? '30 days' : key === '90d' ? '90 days' : (option?.label ?? 'Today')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.performanceTiles}>
        {overview ? [overview.grossRevenue, overview.orders, overview.storeVisitors, overview.conversionRate].map(metric => (
          <View key={metric.key} style={styles.performanceTile}>
            <Text style={styles.performanceTileLabel}>{metric.label}</Text>
            <Text style={styles.performanceTileValue}>{metric.formatted}</Text>
            <View style={styles.performanceTileMeta}>
              <Feather name={metric.trend === 'down' ? 'trending-down' : metric.trend === 'up' ? 'trending-up' : 'minus'} size={12} color={metric.trend === 'down' ? RED : SUCCESS} />
              <Text style={[styles.performanceTileChange, { color: metric.trend === 'down' ? RED : SUCCESS }]}>
                {metric.changePct === undefined ? 'Current period' : `${Math.abs(metric.changePct).toFixed(1)}%`}
              </Text>
            </View>
          </View>
        )) : null}
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
              style={[styles.sectionPill, isOverview && { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
                <Feather name={s.icon} size={12} color={isOverview ? colors.primaryForeground : MUTED} />
                <Text style={[styles.sectionPillText, isOverview && { color: colors.primaryForeground }]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Revenue chart ── */}
      {chartPoints().length > 0 ? <View style={styles.chartCard}>
        {/* metric selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 6, flexDirection: 'row' }}>
          {CHART_METRICS.map(cm => (
            <TouchableOpacity
              key={cm.key}
              onPress={() => { setChartMetric(cm.key); setTappedBar(null); }}
              style={[styles.chartTab, chartMetric === cm.key && { backgroundColor: colors.accent, borderWidth: 1, borderColor: colors.primary }]}
            >
              <Text style={[styles.chartTabText, chartMetric === cm.key && { color: colors.accentForeground }]}>{cm.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          {(['daily','weekly','monthly'] as const).map(g => (
            <TouchableOpacity key={g} onPress={() => setGroupBy(g)} style={[styles.groupTab, groupBy === g && { backgroundColor: colors.accent }]}>
              <Text style={[styles.groupTabText, groupBy === g && { color: colors.accentForeground }]}>{g[0].toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* big number */}
        <View style={styles.chartAmountRow}>
          <Text style={styles.chartAmount}>{chartMetricValue()}</Text>
        </View>

        {/* line trend */}
        <TrendLineChart points={chartPoints()} color={colors.primary} width={screenWidth - 66} />

        {/* tooltip */}
        {tappedPoint && (
          <View style={styles.tooltip}>
            <Text style={styles.tooltipDate}>{tappedPoint.date}</Text>
            <Text style={styles.tooltipValue}>
              {chartMetric === 'revenue' || chartMetric === 'profit'
                ? formatCents(tappedPoint.value)
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
      </View> : null}

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
            <TouchableOpacity><Text style={[styles.viewAll, { color: colors.primary }]}>View all</Text></TouchableOpacity>
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
                      <Text style={[styles.insightBtnText, { color: colors.primary }]}>Take action</Text>
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
  scroll:        { flex: 1, backgroundColor: SCREEN_BG },
  content:       { paddingHorizontal: 16 },
  loadWrap:      { flex: 1, backgroundColor: SCREEN_BG, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadText:      { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },

  headerRow:     { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  pageTitle:     { fontSize: 28, fontFamily: FONT.bold, color: FG },
  updatedText:   { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  iconBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  pill:          { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  pillText:      { fontSize: 13, fontFamily: FONT.medium, color: MUTED },
  pillSm:        { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  pillSmText:    { fontSize: 11, fontFamily: FONT.medium, color: MUTED },

  sectionPill:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  sectionPillText:   { fontSize: 12, fontFamily: FONT.medium, color: MUTED },
  rangePills: { flexDirection: 'row', gap: 7, marginBottom: 14 },
  rangePill: { flex: 1, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE, borderWidth: 1, borderColor: BORDER },
  rangePillText: { fontSize: 11, fontFamily: FONT.semibold, color: MUTED },
  performanceTiles: { flexDirection: 'row', gap: 10, paddingRight: 16, marginBottom: 18 },
  performanceTile: { width: 142, backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER },
  performanceTileLabel: { color: MUTED, fontFamily: FONT.regular, fontSize: 11, marginBottom: 6 },
  performanceTileValue: { color: FG, fontFamily: FONT.bold, fontSize: 21 },
  performanceTileMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  performanceTileChange: { fontFamily: FONT.medium, fontSize: 10 },

  chartCard:     { backgroundColor: CARD, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 24 },
  chartTab:      { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: SURFACE },
  chartTabText:  { fontSize: 11, fontFamily: FONT.medium, color: MUTED },
  groupTab:      { width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: SURFACE },
  groupTabText:  { fontSize: 10, fontFamily: FONT.semibold, color: MUTED },

  chartAmountRow:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  chartAmount:   { fontSize: 32, fontFamily: FONT.bold, color: FG },
  changeBadge:   { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  changeBadgeText:{ fontSize: 12, fontFamily: FONT.semibold },

  barsRow:       { flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2, marginBottom: 4 },
  barWrap:       { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 90 },
  bar:           { width: '100%', borderRadius: 3 },
  lineChartWrap: { height: 132, marginHorizontal: -2, marginBottom: 4, overflow: 'hidden' },
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
  viewAll:       { fontSize: 13, fontFamily: FONT.medium },
  insightCard:   { flexDirection: 'row', gap: 12, backgroundColor: CARD_ELEVATED, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, borderLeftWidth: 3, marginBottom: 10 },
  insightIconWrap:{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  insightTitle:  { fontSize: 14, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  insightWhat:   { fontSize: 12, fontFamily: FONT.regular, color: MUTED, marginBottom: 4 },
  insightAction: { fontSize: 12, fontFamily: FONT.medium, color: SUBTLE, marginBottom: 10 },
  insightActions:{ flexDirection: 'row', gap: 12 },
  insightBtn:    { paddingVertical: 4 },
  insightBtnText:{ fontSize: 13, fontFamily: FONT.semibold },
  insightDismiss:{ paddingVertical: 4 },
  insightDismissText:{ fontSize: 13, fontFamily: FONT.medium, color: SUBTLE },
});
