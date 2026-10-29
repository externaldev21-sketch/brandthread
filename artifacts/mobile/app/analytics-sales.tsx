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
import { FONT, FS, SP } from '@/lib/theme';
import { getSalesAnalytics, getFilterState } from '@/services/analyticsService';
import { SellerDashboardRangePills } from '@/components/SellerDashboardRangePills';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { InsightRange } from '@/services/sellerInsightsService';
import { isSellerDevPreview } from '@/lib/devPreview';
import { SalesAnalytics, AnalyticsPoint, AnalyticsFilterState, DateRangeKey } from '@/services/analyticsTypes';
import { formatCents } from '@/lib/money';
import { plural } from '@/lib/plural';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, StatRow,
} from '@/components/analytics/AnalyticsKit';

const CHART_TAB_LABELS: Record<'sales' | 'orders' | 'units' | 'aov' | 'refunds', string> = {
  sales: 'Sales',
  orders: 'Orders',
  units: 'Units',
  aov: 'Avg order',
  refunds: 'Refunds',
};

// The Dashboard's Today / Week / Month / Year / All pills, as calendar
// periods on GET /api/analytics/revenue (so both screens agree).
const RANGE_TO_DATE_KEY: Record<InsightRange, { key: DateRangeKey; label: string }> = {
  today: { key: 'today', label: 'Today' },
  week:  { key: 'this_week', label: 'This week' },
  month: { key: 'this_month', label: 'This month' },
  year:  { key: 'this_year', label: 'This year' },
  all:   { key: 'all', label: 'All time' },
};

/** "2026-10-20" (the seller's local day) → "Oct 20", without a UTC shift. */
function dayLabel(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function withRange(filter: AnalyticsFilterState, range: InsightRange): AnalyticsFilterState {
  const { key, label } = RANGE_TO_DATE_KEY[range];
  return { ...filter, dateRange: { key, label, startDate: '', endDate: '' } };
}

export default function AnalyticsSalesScreen() {
  const { theme } = useAppTheme();
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const { isLoaded: authLoaded, userId } = useAuth();

  const [data,       setData]       = useState<SalesAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChart, setActiveChart] = useState<'sales' | 'orders' | 'units' | 'aov' | 'refunds'>('sales');
  const [range, setRange] = useState<InsightRange>('month');
  const requestUser = useRef<string | null>(null);
  // Range taps can overlap; only the latest request may write state.
  const requestSeq = useRef(0);

  const load = useCallback(async (isRefresh = false) => {
    // The signed-out web preview has no Clerk user; the service serves its fixtures.
    const preview = isSellerDevPreview();
    if (!preview && (!authLoaded || !userId)) return;
    const requestedUser = userId ?? 'preview';
    requestUser.current = requestedUser;
    const seq = ++requestSeq.current;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getSalesAnalytics(withRange(f, range));
      if (requestUser.current !== requestedUser || requestSeq.current !== seq) return;
      setData(next);
      setLoadError(false);
    } catch (err) {
      if (requestUser.current !== requestedUser || requestSeq.current !== seq) return;
      setLoadError(true);
    } finally { if (requestSeq.current === seq) { setLoading(false); setRefreshing(false); } }
  }, [filter, authLoaded, userId, range]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (isSellerDevPreview() || (authLoaded && userId)) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  // A new range reloads in place (the previous numbers stay until it lands).
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return; }
    void load(true);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const points = chartData().slice(-14);
  const pointLabel = (p?: AnalyticsPoint) => (p?.date ? dayLabel(p.date) : '');
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Sales Analytics" />
      {loading ? (
        <AnalyticsSkeleton kpiCount={0} listRows={3} />
      ) : loadError && !data ? (
        <View style={s.loadWrap}>
          <ErrorState message="Couldn't load sales analytics." onRetry={() => load()} />
        </View>
      ) : (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <SellerDashboardRangePills range={range} onRangeChange={setRange} theme={theme} />
      {/* Chart */}
      <Card padded>
        <PillTabs
          options={(['sales', 'orders', 'units', 'aov', 'refunds'] as const).map(k => ({ key: k, label: CHART_TAB_LABELS[k] }))}
          value={activeChart}
          onChange={setActiveChart}
        />
        {points.length === 0 ? (
          <Text style={s.emptyText}>No {CHART_TAB_LABELS[activeChart].toLowerCase()} data for this period.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 32, gap: 2 }}>
              {points.map((p, i) => {
                const max = Math.max(...points.map(pt => pt.value), 1);
                return (
                  <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (p.value / max) * 32), backgroundColor: colors.primary, opacity: 0.7 }} />
                );
              })}
            </View>
            <View style={s.xRow}>
              <Text style={s.xLabel}>{pointLabel(points[0])}</Text>
              {points.length > 1 && <Text style={s.xLabel}>{pointLabel(points[points.length - 1])}</Text>}
            </View>
          </>
        )}
      </Card>

      {/* P&L summary */}
      <SectionTitle>Revenue breakdown</SectionTitle>
      <Card>
        {data && <StatRow label={data.grossSales.label} value={data.grossSales.formatted} changePct={data.grossSales.changePct} />}
        {data?.orders && (
          <>
            <CardDivider />
            <StatRow label={data.orders.label} value={data.orders.formatted} />
            <CardDivider />
            <StatRow
              label="Avg order value"
              value={data.orders.value > 0 ? formatCents(Math.round(data.grossSales.value / data.orders.value)) : '—'}
            />
          </>
        )}
      </Card>

      {/* Breakdown */}
      <SectionTitle>By product</SectionTitle>
      <Card>
        {data?.breakdown.map((row, i) => (
          <View key={row.key}>
            {i > 0 && <CardDivider />}
            <View style={s.breakRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.breakLabel} numberOfLines={1}>{row.label}</Text>
                <Text style={s.breakSub}>{plural(row.orders, 'order')} · {plural(row.units, 'unit')}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.breakRevenue}>{formatCents(row.revenue)}</Text>
                <Text style={s.breakShare}>{row.sharePct.toFixed(1)}% of total</Text>
              </View>
            </View>
          </View>
        ))}
        {data?.breakdown.length === 0 && <Text style={[s.emptyText, { padding: SP.md }]}>No product breakdown is available for this period.</Text>}
      </Card>

      {/* The stack scene already ends above the floating seller tab bar. */}
      <View style={{ height: SP.lg }} />
    </ScrollView>
      )}
    </View>
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
