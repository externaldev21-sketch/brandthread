/**
 * Sales Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, PURPLE_LIGHT,
  SUCCESS, SUCCESS_DIM, RED, RED_DIM, ORANGE, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getSalesAnalytics, getFilterState, exportAnalytics } from '@/services/analyticsService';
import { SalesAnalytics, AnalyticsMetric, AnalyticsPoint, AnalyticsFilterState } from '@/services/analyticsTypes';

function MiniBar({ points, color }: { points: AnalyticsPoint[]; color: string }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const max = Math.max(...points.map(p => p.value), 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 32, gap: 2 }}>
      {points.slice(-14).map((p, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (p.value / max) * 32), backgroundColor: color, opacity: 0.7 }} />
      ))}
    </View>
  );
}

function StatRow({ m, isDeduction = false }: { m: AnalyticsMetric; isDeduction?: boolean }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const upColor = isDeduction ? (m.trend === 'up' ? RED : SUCCESS) : (m.trend === 'up' ? SUCCESS : RED);
  return (
    <View style={s.statRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.statLabel}>{m.label}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.statValue, isDeduction && { color: RED }]}>{isDeduction ? `−${m.formatted}` : m.formatted}</Text>
        {typeof m.changePct === 'number' ? (
          <Text style={[s.statChange, { color: upColor }]}>
            {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}% vs prev
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function AnalyticsSalesScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<SalesAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChart, setActiveChart] = useState<'sales' | 'orders' | 'units' | 'aov' | 'refunds'>('sales');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      setData(await getSalesAnalytics(f)); setError(null);
    } catch (err) {
      setData(null); setError(err instanceof Error ? err.message : 'Sales analytics are unavailable.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const chartData = (): AnalyticsPoint[] => {
    if (!data) return [];
    switch (activeChart) {
      case 'sales':   return data.salesChart;
      case 'orders':  return data.ordersChart;
      case 'units':   return data.unitsChart;
      case 'aov':     return data.aovChart;
      case 'refunds': return data.refundsChart;
    }
  };

  if (loading) {
    return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><ActivityIndicator size="large" color={PURPLE} /><Text style={s.loadText}>Loading…</Text></View>;
  }
  if (error) return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><Text style={s.loadText}>{error}</Text><TouchableOpacity onPress={() => load()}><Text style={{ color: PURPLE }}>Retry</Text></TouchableOpacity></View>;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>Sales Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={async () => { Alert.alert('Exporting…'); if (filter) { await exportAnalytics('sales', filter.dateRange); Alert.alert('Export ready'); } }} style={s.iconBtn}>
          <Feather name="share" size={16} color={PURPLE} />
        </TouchableOpacity>
      </View>

      {/* Chart */}
      <View style={s.chartCard}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, flexDirection: 'row', marginBottom: 12 }}>
          {(['sales','orders','units','aov','refunds'] as const).map(k => (
            <TouchableOpacity key={k} onPress={() => setActiveChart(k)} style={[s.chartTab, activeChart === k && s.chartTabActive, activeChart === k && { backgroundColor: PURPLE_DIM, borderColor: PURPLE }]}>
              <Text style={[s.chartTabText, activeChart === k && s.chartTabTextActive, activeChart === k && { color: PURPLE_LIGHT }]}>{k.charAt(0).toUpperCase() + k.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <MiniBar points={chartData()} color={PURPLE} />
        <View style={s.xRow}>
          <Text style={s.xLabel}>Start</Text>
          <Text style={s.xLabel}>Today</Text>
        </View>
      </View>

      {/* P&L summary */}
      <Text style={s.sectionTitle}>Revenue Breakdown</Text>
      <View style={s.card}>
        {data && <>
          <StatRow m={data.grossSales} />
        </>}
      </View>

      {/* Breakdown */}
      <Text style={s.sectionTitle}>By Product</Text>
      <View style={s.card}>
        {data?.breakdown.map((row, i) => (
          <View key={row.key} style={[s.breakRow, i > 0 && s.breakBorder]}>
            <View style={{ flex: 1 }}>
              <Text style={s.breakLabel} numberOfLines={1}>{row.label}</Text>
              <Text style={s.breakSub}>{row.orders} orders · {row.units} units</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.breakRevenue}>${row.revenue.toLocaleString()}</Text>
              <Text style={s.breakShare}>{row.sharePct.toFixed(1)}% of total</Text>
            </View>
          </View>
        ))}
        {data?.breakdown.length === 0 && <Text style={[s.statLabel, { padding: 16 }]}>No product breakdown is available for this period.</Text>}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT } = colors;
  return StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: BG },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadText: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  iconBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  statRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  statLabel:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  statValue:{ fontSize: 15, fontFamily: FONT.semibold, color: FG },
  statChange:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  breakRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  breakBorder:{ borderTopWidth: 1, borderTopColor: BORDER },
  breakLabel:{ fontSize: 13, fontFamily: FONT.semibold, color: FG },
  breakSub: { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  breakRevenue:{ fontSize: 14, fontFamily: FONT.bold, color: FG },
  breakShare:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  chartCard:{ backgroundColor: CARD, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 20 },
  chartTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: CARD_ELEVATED },
  chartTabActive:{ borderWidth: 1 },
  chartTabText:{ fontSize: 11, fontFamily: FONT.medium, color: MUTED },
  chartTabTextActive:{},
  xRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  xLabel:   { fontSize: 10, fontFamily: FONT.regular, color: SUBTLE },
  });
};
