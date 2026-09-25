/**
 * Analytics — Brandthread Seller App
 * Precise, trustworthy, quick-to-scan seller analytics.
 * Data contract: grossRevenue/storeVisitors from getOverview; daily bars from
 * getSalesAnalytics. No fabricated data, no fabricated trends.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, Platform, ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Rect, Line, Text as SvgText } from 'react-native-svg';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  SCREEN_BG, CARD_GLASS, BORDER, FG, MUTED, SUBTLE, SUCCESS, RED,
  FONT, FS, SURFACE, GRID_MAX_WIDTH,
} from '@/lib/theme';
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

function niceYMax(maxCents: number): number {
  if (maxCents <= 0) return 500;  // default $5.00 so grid renders
  const dollar = maxCents / 100;
  const mag = Math.pow(10, Math.floor(Math.log10(dollar)));
  const nice = Math.ceil(dollar / mag) * mag;
  return nice * 100;
}

function gridLevels(maxCents: number, steps = 4): number[] {
  const top = niceYMax(maxCents);
  return Array.from({ length: steps + 1 }, (_, i) => Math.round((top / steps) * i));
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

// ─── Revenue Bar Chart ────────────────────────────────────────────────────────

function RevenueBarChart({
  bars,
  colors,
  available,
}: {
  bars: DailyBar[];
  colors: ReturnType<typeof useColors>;
  available: boolean;
}) {
  // Measured from the card's own content width (not the screen) so the chart
  // fits correctly inside a centered/narrowed container on iPad.
  const [cardWidth, setCardWidth] = useState(0);
  const chartWidth = cardWidth > 0 ? cardWidth : 300;
  const chartHeight = 140;
  const labelHeight = 20;
  const gridHeight = chartHeight - labelHeight;
  const allZero = bars.every(b => b.cents === 0);

  const maxCents = allZero ? 0 : Math.max(...bars.map(b => b.cents));
  const levels = allZero ? [0] : gridLevels(maxCents);
  const topCents = levels[levels.length - 1];
  const yLabelW = 46;
  const plotW = chartWidth - yLabelW;
  const n = bars.length;
  const barGap = n > 0 ? 2 : 0;
  const barW = n > 0 ? Math.max(4, (plotW - barGap * (n - 1)) / n) : 0;

  const barX = (i: number) => yLabelW + i * (barW + barGap);
  const barY = (cents: number) => {
    if (topCents <= 0) return gridHeight;
    const frac = cents / topCents;
    return gridHeight - Math.max(0, Math.min(1, frac)) * (gridHeight - 4);
  };

  return (
    <View onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}>
      <Svg width={chartWidth} height={chartHeight}>
        {/* Y-axis grid lines + labels */}
        {levels.map((cents, i) => {
          const y = levels.length === 1
            ? gridHeight
            : gridHeight - (i / (levels.length - 1)) * (gridHeight - 4);
          const dollars = cents / 100;
          const label = dollars >= 1000 ? `$${(dollars / 1000).toFixed(1)}k` : `$${dollars.toFixed(0)}`;
          return (
            <React.Fragment key={i}>
              <Line
                x1={yLabelW} y1={y} x2={chartWidth} y2={y}
                stroke={BORDER} strokeWidth={1}
              />
              <SvgText
                x={yLabelW - 4} y={y + 4}
                textAnchor="end"
                fontSize={FS.xs}
                fontFamily={FONT.regular}
                fill={SUBTLE}
              >
                {label}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Bars */}
        {!allZero && bars.map((bar, i) => {
          if (bar.cents <= 0) return null;
          const x = barX(i);
          const y = barY(bar.cents);
          const h = gridHeight - y;
          return (
            <Rect
              key={bar.date}
              x={x} y={y}
              width={barW} height={Math.max(2, h)}
              rx={3} ry={3}
              fill={colors.primary}
              opacity={0.88}
            />
          );
        })}

        {/* Date labels — show first, mid, last */}
        {bars.length > 0 && (() => {
          const indices = bars.length <= 7
            ? bars.map((_, i) => i)
            : [0, Math.floor((bars.length - 1) / 2), bars.length - 1];
          return indices.map(i => (
            <SvgText
              key={`lbl-${i}`}
              x={barX(i) + barW / 2}
              y={chartHeight - 2}
              textAnchor="middle"
              fontSize={FS.xs}
              fontFamily={FONT.regular}
              fill={SUBTLE}
            >
              {bars[i].label}
            </SvgText>
          ));
        })()}
      </Svg>

      {(allZero || !available) && (
        <View style={styles.chartEmptyOverlay}>
          <Text style={styles.chartEmptyText}>
            {available ? 'No revenue data yet' : 'Range data unavailable'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Summary stat ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  changePct,
  featured = false,
  colors,
}: {
  label: string;
  value: string;
  changePct?: number;
  featured?: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const hasTrend = Number.isFinite(changePct);
  const trendUp = (changePct ?? 0) >= 0;
  return (
    <View style={[styles.statCard, featured && styles.statCardFeatured]}>
      <View style={styles.statLabelRow}>
        <Text style={styles.statLabel}>{label}</Text>
        {hasTrend && (
          <View style={styles.trendRow}>
            <Feather
              name={trendUp ? 'arrow-up-right' : 'arrow-down-right'}
              size={10}
              color={trendUp ? SUCCESS : RED}
            />
            <Text style={[styles.trendText, { color: trendUp ? SUCCESS : RED }]}>
              {Math.abs(changePct ?? 0).toFixed(1)}%
            </Text>
          </View>
        )}
      </View>
      <Text
        style={[styles.statValue, { color: featured ? colors.primary : FG }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.65}
      >
        {value}
      </Text>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function AnalyticsScreen() {
  const colors = useColors();
  const api = useApi();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

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
      <View style={[styles.loadWrap, { paddingTop: topPad + 48 }]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadText}>Loading analytics</Text>
      </View>
    );
  }

  // ── Display values ─────────────────────────────────────────────────────────
  const displayRevenue = formatCents(summary.revenueCents);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topPad + 12 }]}
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
        <Text style={styles.pageTitle}>Analytics</Text>
        <Text style={styles.rangeLabel}>Last 7 days</Text>

        {/* ── Summary stats ──────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatCard label="Visits" value={summary.visits.toLocaleString()} changePct={summary.visitsChangePct} colors={colors} />
          <StatCard label="Revenue" value={displayRevenue} changePct={summary.revenueChangePct} featured colors={colors} />
        </View>

        {/* ── Daily revenue bar chart ────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Daily Revenue</Text>
          <View style={{ marginTop: 12 }}>
            <RevenueBarChart bars={bars} colors={colors} available />
          </View>
        </View>

        <View style={{ height: 120 }} />
        </ResponsiveContainer>
      </ScrollView>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll:       { flex: 1, backgroundColor: SCREEN_BG },
  content:      {},
  loadWrap:     { flex: 1, backgroundColor: SCREEN_BG, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadText:     { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },

  pageTitle:    { fontSize: 28, fontFamily: FONT.bold, color: FG, marginBottom: 4 },
  rangeLabel:   { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, marginBottom: 16 },

  // Segmented
  segmented:    { flexDirection: 'row', backgroundColor: SURFACE, borderRadius: 12, borderWidth: 1, borderColor: BORDER, padding: 3, marginBottom: 14 },
  segItem:      { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segText:      { fontSize: 13, fontFamily: FONT.semibold, color: MUTED },

  // Date boxes
  dateRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 10 },
  dateBox:      { flex: 1, backgroundColor: CARD_GLASS, borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingVertical: 10, paddingHorizontal: 12 },
  dateBoxLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE, marginBottom: 2 },
  dateBoxValue: { fontSize: 14, fontFamily: FONT.semibold, color: FG },
  dateSep:      { color: MUTED, fontFamily: FONT.medium, fontSize: FS.md },
  rangeNotice:  { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: -4, marginBottom: 14 },

  // Stats
  statsRow:     { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statCard:     { flex: 1, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center' },
  statCardFeatured: { backgroundColor: CARD_GLASS, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  statLabelRow: { minHeight: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  statLabel:    { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  trendRow:     { flexDirection: 'row', alignItems: 'center', gap: 1 },
  trendText:    { fontSize: FS.xs, fontFamily: FONT.semibold },
  statValue:    { fontSize: 18, fontFamily: FONT.bold, color: FG },

  // Card
  card:         { backgroundColor: CARD_GLASS, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 14 },
  cardTitle:    { fontSize: 14, fontFamily: FONT.semibold, color: FG },

  // Chart empty state
  chartEmptyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 20, alignItems: 'center', justifyContent: 'center' },
  chartEmptyText: { fontSize: 13, fontFamily: FONT.regular, color: SUBTLE },

  // Source card
  noDataText:   { fontSize: 13, fontFamily: FONT.regular, color: SUBTLE, marginTop: 12 },
  sourceRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sourceLabel:  { fontSize: 13, fontFamily: FONT.regular, color: MUTED, flex: 1, marginRight: 8 },
  sourceCount:  { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  sourceBarBg:  { flexDirection: 'row', height: 4, borderRadius: 2, backgroundColor: BORDER, overflow: 'hidden' },
  sourceBarFill:{ opacity: 0.72, borderRadius: 2 },
});
