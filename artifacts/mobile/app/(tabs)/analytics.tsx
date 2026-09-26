/**
 * Analytics — Brandthread Seller App
 * Precise, trustworthy, quick-to-scan seller analytics.
 * Data contract: grossRevenue/storeVisitors from getOverview; daily bars from
 * getSalesAnalytics. No fabricated data, no fabricated trends.
 *
 * Mobbin reference: Stripe Dashboard "Home" KPI + chart layout
 * (https://mobbin.com/screens/f972bbd5-699d-42c3-942e-1cf9f3d25eda) informed
 * the stat-row-above-chart hierarchy and the muted axis labels.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, Platform } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GRID_MAX_WIDTH, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ResponsiveContainer } from '@/components/layout';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import {
  getSalesAnalytics, getFilterState, saveFilterState,
} from '@/services/analyticsService';
import {
  AnalyticsFilterState, AnalyticsPoint, DATE_RANGE_OPTIONS, COMPARISON_OPTIONS,
} from '@/services/analyticsTypes';
import { AnalyticsBarChart, AnalyticsSkeleton, Card, SectionTitle, StatTile } from '@/components/analytics/AnalyticsKit';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryData {
  visits: number;
  revenueCents: number;
  visitsChangePct?: number;
  revenueChangePct?: number;
}

interface DailyBar {
  date: string;   // ISO date yyyy-mm-dd
  label: string;  // short date label e.g. "Jul 4"
  cents: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function shortDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return iso.slice(5, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Returns ISO date strings for the last n days ending today (inclusive). */
function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/** Align API daily points to a fixed date range, filling 0 for missing days. */
function alignBars(points: AnalyticsPoint[], days: string[]): DailyBar[] {
  const byDate: Record<string, number> = {};
  for (const p of points) {
    const key = typeof p.date === 'string' ? p.date.slice(0, 10) : '';
    if (key) byDate[key] = (byDate[key] ?? 0) + p.value;
  }
  return days.map(iso => ({
    date: iso,
    label: shortDate(iso),
    cents: byDate[iso] ?? 0,
  }));
}

function formatChartDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${(dollars / 1000).toFixed(1)}k` : `$${dollars.toFixed(0)}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const colors = useColors();
  const api = useApi();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const s = React.useMemo(() => createStyles(colors), [colors]);

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]       = useState<SummaryData>({ visits: 0, revenueCents: 0 });
  const [bars, setBars]             = useState<DailyBar[]>([]);

  const filterRef = useRef<AnalyticsFilterState | null>(null);
  const loadGenerationRef = useRef(0);

  // Only the 7-day range has real backing data today — see the header note.
  const activeDays = useCallback((): string[] => lastNDays(7), []);

  const load = useCallback(async (isRefresh = false) => {
    const generation = ++loadGenerationRef.current;
    if (!userId) {
      setSummary({ visits: 0, revenueCents: 0 });
      setBars([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      if (!filterRef.current) {
        filterRef.current = await getFilterState();
      }
      const days = activeDays();
      const drOption = DATE_RANGE_OPTIONS.find(d => d.key === '7d') ?? DATE_RANGE_OPTIONS[2];
      const filter: AnalyticsFilterState = {
        ...(filterRef.current ?? { comparison: COMPARISON_OPTIONS[0], groupBy: 'daily' }),
        dateRange: drOption,
      };
      filterRef.current = filter;
      await saveFilterState(filter);

      const [home, sales] = await Promise.allSettled([
        api.analytics.home('week'),
        getSalesAnalytics(filter),
      ]);

      if (loadGenerationRef.current !== generation) return;
      const homeData = home.status === 'fulfilled' ? home.value : null;
      const sl = sales.status === 'fulfilled' ? sales.value : null;
      const rawPoints: AnalyticsPoint[] = sl?.salesChart ?? [];
      const alignedBars = alignBars(rawPoints, days);
      setBars(alignedBars);
      setSummary({
        visits: homeData?.visitorCount ?? 0,
        revenueCents: homeData?.totalCents ?? sl?.grossSales?.value ?? 0,
      });
    } catch {
      // silent read failure: keep whatever state was last set
    }

    if (loadGenerationRef.current === generation) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, userId, activeDays]);

  React.useEffect(() => {
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <AnalyticsSkeleton topPad={topPad} kpiCount={2} listRows={0} />
      </View>
    );
  }

  // ── Display values ─────────────────────────────────────────────────────────
  const displayRevenue = formatCents(summary.revenueCents);
  const chartPoints = bars.map(b => ({ label: b.label, value: b.cents }));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load(true)}
            tintColor={colors.primary}
          />
        }
      >
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
          {/* ── Header ─────────────────────────────────────────────────────── */}
          <Text style={s.pageTitle}>Analytics</Text>
          <Text style={s.rangeLabel}>Last 7 days</Text>

          {/* ── Summary stats ──────────────────────────────────────────────── */}
          <View style={s.statsRow}>
            <StatTile label="Visits" value={summary.visits.toLocaleString()} changePct={summary.visitsChangePct} />
            <StatTile label="Revenue" value={displayRevenue} changePct={summary.revenueChangePct} featured />
          </View>

          {/* ── Daily revenue bar chart ────────────────────────────────────── */}
          <Card padded>
            <SectionTitle>Daily Revenue</SectionTitle>
            <AnalyticsBarChart points={chartPoints} color={colors.primary} formatValue={formatChartDollars} emptyLabel="No revenue data yet" />
          </Card>

          <View style={{ height: 120 }} />
        </ResponsiveContainer>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:  { flex: 1, backgroundColor: 'transparent' },
  content: {},

  pageTitle:  { fontSize: 28, fontFamily: FONT.bold, color: colors.foreground, marginBottom: 4 },
  rangeLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: colors.mutedForeground, marginBottom: SP.md },

  statsRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
});
