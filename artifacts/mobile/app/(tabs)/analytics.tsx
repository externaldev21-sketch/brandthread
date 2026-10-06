/**
 * Analytics — Brandthread Seller App
 * Precise, trustworthy, quick-to-scan seller analytics.
 * Data contract: visits, revenue and the revenue chart all come from the
 * same GET /api/analytics/home snapshot the Dashboard uses, for the range
 * picked in the Dashboard's own Today/Week/Month/Year/All pill row (opens
 * on Today). No fabricated data, no fabricated trends.
 *
 * Mobbin reference: Stripe Dashboard "Home" KPI + chart layout
 * (https://mobbin.com/screens/f972bbd5-699d-42c3-942e-1cf9f3d25eda) informed
 * the stat-row-above-chart hierarchy and the muted axis labels.
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
import { bucketLabel } from '@/lib/sellerHomeChartLabels';
import { AnalyticsBarChart, AnalyticsSkeleton, Card, SectionTitle, StatTile } from '@/components/analytics/AnalyticsKit';
import { SellerDashboardRangePills, type SellerDashboardRange } from '@/components/SellerDashboardRangePills';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme } from '@/contexts/AppThemeContext';
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

function formatChartDollars(cents: number): string {
  const dollars = cents / 100;
  return dollars >= 1000 ? `$${(dollars / 1000).toFixed(1)}k` : `$${dollars.toFixed(0)}`;
}

/** Chart height: the full band when there is revenue to plot, a shorter
 *  one for the empty state (Dev: "shrink empty height (~120px)") so a
 *  zero chart doesn't leave a tall blank card. */
const CHART_HEIGHT = 140;
const EMPTY_CHART_HEIGHT = 120;

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const api = useApi();
  const { userId } = useAuth();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const scrollResetRef = useScrollReset<ScrollView>();
  // Content ends above the floating tab bar (shared app-wide rule).
  const tabBarClearance = useTabBarClearance(2);

  // The Dashboard's own range control, opening on Today.
  const [range, setRange] = useState<SellerDashboardRange>('today');
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]       = useState<SummaryData>({ visits: 0, revenueCents: 0 });
  const [bars, setBars]             = useState<RevenueBar[]>([]);

  const loadGenerationRef = useRef(0);
  const { ref: revenueTileRef, rect: revenueTileRect, onLayout: revenueTileOnLayout } = useMeasuredTarget();

  const load = useCallback(async (isRefresh = false) => {
    const generation = ++loadGenerationRef.current;
    if (!userId) {
      setSummary({ visits: 0, revenueCents: 0 });
      setBars([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);

    try {
      const home = await api.analytics.home(range);
      if (loadGenerationRef.current !== generation) return;
      setBars((home?.buckets ?? []).map((b: { bucket: string; totalCents: number }) => ({
        label: bucketLabel(b.bucket, range),
        cents: b.totalCents ?? 0,
      })));
      setSummary({
        visits: home?.visitorCount ?? 0,
        revenueCents: home?.totalCents ?? 0,
      });
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
  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Analytics" divider={false} />
        <AnalyticsSkeleton kpiCount={2} listRows={0} />
      </View>
    );
  }

  // ── Display values ─────────────────────────────────────────────────────────
  const displayRevenue = formatCents(summary.revenueCents);
  const chartPoints = bars.map(b => ({ label: b.label, value: b.cents }));
  const chartEmpty = chartPoints.every(p => p.value === 0);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Analytics" divider={false} />
      <ScrollView
        ref={scrollResetRef}
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: tabBarClearance }]}
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
          <SellerDashboardRangePills range={range} onRangeChange={setRange} theme={theme} style={s.rangePills} />

          {/* ── Summary stats — two equal columns ──────────────────────────── */}
          <View style={s.statsRow} testID="analytics-stats-row">
            <View style={s.statCell}>
              <StatTile label="Visits" value={summary.visits.toLocaleString()} changePct={summary.visitsChangePct} />
            </View>
            {/* The Revenue tile sits in a measured wrapper (first-run spotlight
                target) — the wrapper, not the tile, is the row's flex child,
                so it carries the flex: 1 that makes both columns equal. */}
            <View ref={revenueTileRef} onLayout={revenueTileOnLayout} collapsable={false} style={s.statCell}>
              <StatTile label="Revenue" value={displayRevenue} changePct={summary.revenueChangePct} featured />
            </View>
          </View>

          {/* ── Revenue chart — follows the selected range ─────────────────── */}
          <Card padded>
            <SectionTitle>Revenue</SectionTitle>
            <AnalyticsBarChart
              points={chartPoints}
              color={colors.primary}
              formatValue={formatChartDollars}
              emptyLabel="No revenue data yet"
              height={chartEmpty ? EMPTY_CHART_HEIGHT : CHART_HEIGHT}
            />
          </Card>
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
  content: { paddingTop: 0 },
  // Directly under the (divider-less) header, same as Content Analytics.
  rangePills: { marginTop: 0, marginBottom: SP.sm },

  statsRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
  statCell: { flex: 1, minWidth: 0 },
});
