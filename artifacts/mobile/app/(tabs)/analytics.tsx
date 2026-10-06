/**
 * Analytics — Brandthread Seller App
 * Precise, trustworthy, quick-to-scan seller analytics.
 * Data contract: everything on this screen (Visits, Revenue, their deltas and
 * the revenue chart) comes from ONE call to GET /api/analytics/home for the
 * selected range — the same endpoint and the same Today / Week / Month /
 * Year / All pills as the Dashboard, so the two never disagree. No
 * fabricated data, no fabricated trends.
 *
 * Mobbin reference: Stripe Dashboard "Home" KPI + chart layout
 * (https://mobbin.com/screens/f972bbd5-699d-42c3-942e-1cf9f3d25eda) informed
 * the stat-row-above-chart hierarchy and the muted axis labels; Shopify
 * Analytics for the Reports rows below the chart.
 */
import React, { useState, useCallback, useRef } from 'react';
import { View, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '@clerk/expo';
import { GRID_MAX_WIDTH, SP } from '@/lib/theme';
import { ResponsiveContainer } from '@/components/layout';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { useScrollReset } from '@/hooks/useScrollReset';
import { formatCents } from '@/lib/money';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { buildPreviewSellerAnalytics } from '@/lib/previewSellerChartData';
import { bucketLabel } from '@/lib/sellerHomeChartLabels';
import { AnalyticsBarChart, AnalyticsSkeleton, Card, SectionTitle, StatTile } from '@/components/analytics/AnalyticsKit';
import { AnalyticsReportsList } from '@/components/analytics/AnalyticsReportsList';
import { SegmentedPills, useReportBottomInset } from '@/components/analytics/InsightFrame';
import { previousPeriodLabel } from '@/components/analytics/InsightCharts';
import { DEFAULT_INSIGHT_RANGE, INSIGHT_RANGES, type InsightRange } from '@/services/sellerInsightsService';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { SELLER_ANALYTICS_SPOTLIGHT } from '@/lib/firstRunTips/content';
import { useMeasuredTarget } from '@/hooks/useMeasuredTarget';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryData {
  visits: number;
  revenueCents: number;
  visitsChangePct?: number;
  revenueChangePct?: number;
}

interface RevenueBar {
  label: string;
  cents: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Real period-over-period change; undefined when there is nothing to compare against. */
function changePct(current: number, previous: number, hasPrevious: boolean): number | undefined {
  if (!hasPrevious || previous <= 0) return undefined;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function formatChartDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${(dollars / 1000).toFixed(1)}k` : `$${dollars.toFixed(0)}`;
}

const CHART_TITLE: Record<InsightRange, string> = {
  today: 'Revenue by hour', week: 'Revenue by day', month: 'Revenue by day', year: 'Revenue by month', all: 'Revenue',
};

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const colors = useColors();
  const api = useApi();
  const { userId } = useAuth();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const scrollResetRef = useScrollReset<ScrollView>();
  const bottomInset = useReportBottomInset();

  const [range, setRange]           = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]       = useState<SummaryData>({ visits: 0, revenueCents: 0 });
  const [bars, setBars]             = useState<RevenueBar[]>([]);

  const loadGenerationRef = useRef(0);
  const { ref: revenueTileRef, rect: revenueTileRect, onLayout: revenueTileOnLayout } = useMeasuredTarget();

  const load = useCallback(async (isRefresh = false) => {
    const generation = ++loadGenerationRef.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // Signed-out web preview never calls the API: fresh = real zeros,
      // &demo=1 = the Dashboard's own deterministic sample curve.
      const preview = isSellerDevPreview();
      if (!preview && !userId) {
        setSummary({ visits: 0, revenueCents: 0 });
        setBars([]);
      } else {
        const home = preview
          ? buildPreviewSellerAnalytics(range, isPreviewDemoMode() ? 'demo' : 'fresh')
          : await api.analytics.home(range);
        if (loadGenerationRef.current !== generation) return;
        const hasPrevious = range !== 'all';
        setBars(home.buckets.map(b => ({ label: bucketLabel(b.bucket, range), cents: b.totalCents })));
        setSummary({
          visits: home.visitorCount,
          revenueCents: home.totalCents,
          visitsChangePct: changePct(home.visitorCount, home.previous.visitorCount, hasPrevious),
          revenueChangePct: changePct(home.totalCents, home.previous.totalCents, hasPrevious),
        });
      }
    } catch {
      // silent read failure: keep whatever state was last set
    }

    if (loadGenerationRef.current === generation) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, userId, range]);

  React.useEffect(() => {
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading && bars.length === 0) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Analytics" />
        <AnalyticsSkeleton kpiCount={2} listRows={0} />
      </View>
    );
  }

  // ── Display values ─────────────────────────────────────────────────────────
  const displayRevenue = formatCents(summary.revenueCents);
  const chartPoints = bars.map(b => ({ label: b.label, value: b.cents }));
  const hasDelta = summary.visitsChangePct !== undefined || summary.revenueChangePct !== undefined;
  const comparedTo = hasDelta ? previousPeriodLabel(range) : null;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Analytics" />
      <ScrollView
        ref={scrollResetRef}
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: bottomInset }]}
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
          {/* ── Range (same pills as the Dashboard) ───────────────────────── */}
          <SegmentedPills options={INSIGHT_RANGES} value={range} onChange={setRange} testID="analytics-range-pills" />

          {/* ── Summary stats ──────────────────────────────────────────────── */}
          <View style={s.statsRow}>
            <StatTile label="Visits" value={summary.visits.toLocaleString()} changePct={summary.visitsChangePct} />
            <View ref={revenueTileRef} onLayout={revenueTileOnLayout} collapsable={false} style={{ flex: 1 }}>
              <StatTile label="Revenue" value={displayRevenue} changePct={summary.revenueChangePct} featured />
            </View>
          </View>

          {/* ── Revenue chart for the selected range ──────────────────────── */}
          <Card padded>
            <SectionTitle note={comparedTo ? `Change ${comparedTo}` : undefined}>{CHART_TITLE[range]}</SectionTitle>
            <AnalyticsBarChart points={chartPoints} color={colors.primary} formatValue={formatChartDollars} emptyLabel="No revenue in this period" />
          </Card>

          {/* ── Reports (appended) ─────────────────────────────────────────── */}
          <AnalyticsReportsList />
        </ResponsiveContainer>
      </ScrollView>
      <FirstRunTip
        id="seller-analytics"
        variant="spotlight"
        contentReady={!loading}
        spotlight={{ target: revenueTileRect, ...SELLER_ANALYTICS_SPOTLIGHT }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:  { flex: 1, backgroundColor: 'transparent' },
  content: { paddingTop: SP.md },

  statsRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
});
