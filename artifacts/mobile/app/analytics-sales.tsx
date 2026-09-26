/**
 * Sales Analytics — Brandthread Seller App
 *
 * Mobbin reference: Shopify "Sales Report" chart + Stripe Dashboard "Home"
 * KPI/chart hierarchy (https://mobbin.com/screens/e927b412-dbe2-4a78-a81a-85b24fdb22f2,
 * https://mobbin.com/screens/f972bbd5-699d-42c3-942e-1cf9f3d25eda) informed the
 * chart-series pill row above the chart and the revenue-breakdown list below it.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP } from '@/lib/theme';
import { getSalesAnalytics, getFilterState } from '@/services/analyticsService';
import { SalesAnalytics, AnalyticsPoint, AnalyticsFilterState } from '@/services/analyticsTypes';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, StatRow,
} from '@/components/analytics/AnalyticsKit';

const CHART_TAB_LABELS: Record<'sales' | 'orders' | 'units' | 'aov' | 'refunds', string> = {
  sales: 'Sales',
  orders: 'Orders',
  units: 'Units',
  aov: 'Avg order',
  refunds: 'Refunds',
};

export default function AnalyticsSalesScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = insets.top;

  const [data,       setData]       = useState<SalesAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChart, setActiveChart] = useState<'sales' | 'orders' | 'units' | 'aov' | 'refunds'>('sales');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getSalesAnalytics(f);
      if (requestUser.current !== requestedUser) return;
      setData(next);
      setLoadError(false);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
      setLoadError(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

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
    return <AnalyticsSkeleton topPad={topPad} kpiCount={0} listRows={3} />;
  }
  if (loadError && !data) {
    return (
      <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}>
        <ErrorState message="Couldn't load sales analytics." onRetry={() => load()} />
      </View>
    );
  }
  const points = chartData();
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader title="Sales Analytics" subtitle={filter?.dateRange.label ?? '30 days'} />

      {/* Chart */}
      <Card padded>
        <PillTabs
          options={(['sales', 'orders', 'units', 'aov', 'refunds'] as const).map(k => ({ key: k, label: CHART_TAB_LABELS[k] }))}
          value={activeChart}
          onChange={setActiveChart}
        />
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 32, gap: 2 }}>
          {points.slice(-14).map((p, i) => {
            const max = Math.max(...points.map(pt => pt.value), 1);
            return (
              <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (p.value / max) * 32), backgroundColor: colors.primary, opacity: 0.7 }} />
            );
          })}
        </View>
        <View style={s.xRow}>
          <Text style={s.xLabel}>Start</Text>
          <Text style={s.xLabel}>Today</Text>
        </View>
      </Card>

      {/* P&L summary */}
      <SectionTitle>Revenue Breakdown</SectionTitle>
      <Card>
        {data && <StatRow label={data.grossSales.label} value={data.grossSales.formatted} changePct={data.grossSales.changePct} />}
      </Card>

      {/* Breakdown */}
      <SectionTitle>By Product</SectionTitle>
      <Card>
        {data?.breakdown.map((row, i) => (
          <View key={row.key}>
            {i > 0 && <CardDivider />}
            <View style={s.breakRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.breakLabel} numberOfLines={1}>{row.label}</Text>
                <Text style={s.breakSub}>{row.orders} orders · {row.units} units</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.breakRevenue}>${row.revenue.toLocaleString()}</Text>
                <Text style={s.breakShare}>{row.sharePct.toFixed(1)}% of total</Text>
              </View>
            </View>
          </View>
        ))}
        {data?.breakdown.length === 0 && <Text style={[s.emptyText, { padding: 16 }]}>No product breakdown is available for this period.</Text>}
      </Card>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  loadWrap: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: SP.md },
  emptyText:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.subtle },
  breakRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 1 },
  breakLabel:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  breakSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  breakRevenue:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  breakShare:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  xRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  xLabel:   { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle },
});
