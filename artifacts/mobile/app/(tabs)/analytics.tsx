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
import { ResponsiveContainer, useBreakpoint } from '@/components/layout';
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

type Segment = '7d' | '14d' | 'custom';

interface SummaryData {
  visits: number;
  revenueCents: number;
  leads: number; // always 0 — no endpoint
  visitsChangePct?: number;
  revenueChangePct?: number;
  leadsChangePct?: number;
}

interface DailyBar {
  date: string;   // ISO date yyyy-mm-dd
  label: string;  // short date label e.g. "Jul 4"
  cents: number;
}

interface TrafficSource {
  label: string;
  count: number;
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

// ─── Traffic Source Card ──────────────────────────────────────────────────────

function SourceCard({ sources, colors }: { sources: TrafficSource[]; colors: ReturnType<typeof useColors> }) {
  const hasData = sources.length > 0 && sources.some(s => s.count > 0);
  const maxCount = hasData ? Math.max(...sources.map(s => s.count)) : 1;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Where are my customers from?</Text>
      {!hasData ? (
        <Text style={styles.noDataText}>No data yet</Text>
      ) : (
        <View style={{ gap: 10, marginTop: 12 }}>
          {sources.map((src, i) => {
            const pct = maxCount > 0 ? src.count / maxCount : 0;
            return (
              <View key={i}>
                <View style={styles.sourceRow}>
                  <Text style={styles.sourceLabel} numberOfLines={1}>{src.label}</Text>
                  <Text style={styles.sourceCount}>{src.count.toLocaleString()}</Text>
                </View>
                <View style={styles.sourceBarBg}>
                  <View style={[styles.sourceBarFill, { flex: pct, backgroundColor: colors.primary }]} />
                  <View style={{ flex: 1 - pct }} />
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Segmented Control ────────────────────────────────────────────────────────

function Segmented({
  value, onChange, colors,
}: { value: Segment; onChange: (s: Segment) => void; colors: ReturnType<typeof useColors> }) {
  const SEGS: { key: Segment; label: string }[] = [
    { key: '7d', label: '7 Days' },
    { key: '14d', label: '14 Days' },
    { key: 'custom', label: 'Custom' },
  ];
  return (
    <View style={styles.segmented}>
      {SEGS.map(seg => {
        const active = value === seg.key;
        return (
          <TouchableOpacity
            key={seg.key}
            style={[styles.segItem, active && { backgroundColor: colors.primary }]}
            onPress={() => { Haptics.selectionAsync(); onChange(seg.key); }}
          >
            <Text style={[styles.segText, active && { color: colors.primaryForeground }]}>
              {seg.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Date box ─────────────────────────────────────────────────────────────────

function DateBox({ label, value, onPress, editable }: { label: string; value: string; onPress: () => void; editable: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={!editable} style={styles.dateBox}>
      <Text style={styles.dateBoxLabel}>{label}</Text>
      <Text style={styles.dateBoxValue}>{value}</Text>
    </TouchableOpacity>
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
  const { isTablet } = useBreakpoint();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [segment, setSegment]   = useState<Segment>('7d');
  const [customStart, setCustomStart] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [customEnd, setCustomEnd] = useState<string>(
    () => new Date().toISOString().slice(0, 10),
  );

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary]       = useState<SummaryData>({ visits: 0, revenueCents: 0, leads: 0 });
  const [bars, setBars]             = useState<DailyBar[]>([]);
  const [sources, setSources]       = useState<TrafficSource[]>([]);

  const filterRef = useRef<AnalyticsFilterState | null>(null);
  const loadGenerationRef = useRef(0);

  // Compute the day-list for the active segment
  const activeDays = useCallback((): string[] => {
    if (segment === '7d') return lastNDays(7);
    if (segment === '14d') return lastNDays(14);
    // custom: derive from selected dates
    const start = new Date(customStart + 'T00:00:00Z');
    const end   = new Date(customEnd   + 'T00:00:00Z');
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return lastNDays(7);
    const days: string[] = [];
    const cur = new Date(start);
    while (cur <= end && days.length < 90) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
  }, [segment, customStart, customEnd]);

  const load = useCallback(async (isRefresh = false) => {
    const generation = ++loadGenerationRef.current;
    if (!userId) {
      setSummary({ visits: 0, revenueCents: 0, leads: 0 });
      setBars([]);
      setSources([]);
      setLoading(false);
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // Build a filter matching the active segment
      if (!filterRef.current) {
        filterRef.current = await getFilterState();
      }
      const drKey = segment === '14d' ? '30d' : segment === 'custom' ? 'custom' : '7d';
      const days = activeDays();
      const drOption = segment === 'custom'
        ? {
            key: 'custom' as const,
            label: 'Custom',
            startDate: days[0] ?? customStart,
            endDate: days[days.length - 1] ?? customEnd,
          }
        : DATE_RANGE_OPTIONS.find(d => d.key === drKey) ?? DATE_RANGE_OPTIONS[2];
      const filter: AnalyticsFilterState = {
        ...(filterRef.current ?? { comparison: COMPARISON_OPTIONS[0], groupBy: 'daily' }),
        dateRange: drOption,
      };
      filterRef.current = filter;
      await saveFilterState(filter);

      // Seven-day visits and revenue are range-scoped by the home endpoint.
      // Wider/custom visits are unavailable, so they remain honest zero values.
      const [home, sales] = await Promise.allSettled([
        segment === '7d' ? api.analytics.home('week') : Promise.resolve(null),
        segment === '7d' ? getSalesAnalytics(filter) : Promise.resolve(null),
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
        leads: 0,
      });

      // Traffic sources: not available from existing API — no fabrication
      setSources([]);
    } catch {
      // silent read failure: keep whatever state was last set
    }

    if (loadGenerationRef.current === generation) {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, userId, segment, customStart, customEnd, activeDays]);

  // Load on mount
  const mountedRef = useRef(false);
  if (!mountedRef.current) {
    mountedRef.current = true;
  }

  // Load when segment or custom dates change — use a stable trigger pattern
  const loadTrigger = `${segment}:${customStart}:${customEnd}:${userId ?? ''}`;
  const prevTriggerRef = useRef('');
  if (prevTriggerRef.current !== loadTrigger) {
    prevTriggerRef.current = loadTrigger;
    // Schedule the load; safe to call during render via setTimeout(0) in RN
    // but we use useEffect-equivalent by gating on a ref
  }

  // useEffect replacement via callback on first render and changes
  React.useEffect(() => {
    load();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Custom date prompt (native Alert) ─────────────────────────────────────
  const promptDate = (which: 'start' | 'end') => {
    const current = which === 'start' ? customStart : customEnd;
    Alert.prompt(
      which === 'start' ? 'Start date' : 'End date',
      'Enter date as YYYY-MM-DD',
      (text) => {
        if (!text) return;
        const clean = text.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
          Alert.alert('Invalid date', 'Please use YYYY-MM-DD format.');
          return;
        }
        if (which === 'start') setCustomStart(clean);
        else setCustomEnd(clean);
      },
      'plain-text',
      current,
    );
  };

  // On Android/web, Alert.prompt is unavailable — use a simple Alert
  const handleDateBox = (which: 'start' | 'end') => {
    Haptics.selectionAsync();
    if (Platform.OS === 'ios') {
      promptDate(which);
    } else {
      // Fallback: show current value and ask user to update via Alert options
      const current = which === 'start' ? customStart : customEnd;
      Alert.alert(
        which === 'start' ? 'Start Date' : 'End Date',
        `Current: ${current}\n\nTo change, tap a date below.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Use today',
            onPress: () => {
              const today = new Date().toISOString().slice(0, 10);
              if (which === 'start') setCustomStart(today);
              else setCustomEnd(today);
            },
          },
          {
            text: `Use ${which === 'start' ? '7 days ago' : 'yesterday'}`,
            onPress: () => {
              const d = new Date();
              d.setDate(d.getDate() - (which === 'start' ? 6 : 1));
              const val = d.toISOString().slice(0, 10);
              if (which === 'start') setCustomStart(val);
              else setCustomEnd(val);
            },
          },
        ],
      );
    }
  };

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
  const rangeAvailable = segment === '7d';
  const displayedDays = activeDays();
  const displayStart = displayedDays[0] ?? customStart;
  const displayEnd = displayedDays[displayedDays.length - 1] ?? customEnd;

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
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <Text style={styles.pageTitle}>Analytics</Text>

        {/* ── Segment control ────────────────────────────────────────────── */}
        <Segmented value={segment} onChange={setSegment} colors={colors} />

        {/* ── Active date range ───────────────────────────────────────────── */}
        <View style={styles.dateRow}>
          <DateBox
            label="Start"
            value={shortDate(displayStart)}
            editable={segment === 'custom'}
            onPress={() => handleDateBox('start')}
          />
          <Text style={styles.dateSep}>—</Text>
          <DateBox
            label="End"
            value={shortDate(displayEnd)}
            editable={segment === 'custom'}
            onPress={() => handleDateBox('end')}
          />
        </View>
        {!rangeAvailable && (
          <Text style={styles.rangeNotice}>Detailed analytics for this range aren&apos;t available yet.</Text>
        )}

        {/* ── Summary stats ──────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <StatCard label="Visits" value={rangeAvailable ? summary.visits.toLocaleString() : '—'} changePct={summary.visitsChangePct} colors={colors} />
          <StatCard label="Revenue" value={rangeAvailable ? displayRevenue : '—'} changePct={summary.revenueChangePct} featured colors={colors} />
          <StatCard label="Leads" value={summary.leads.toLocaleString()} changePct={summary.leadsChangePct} colors={colors} />
        </View>

        {/* ── Daily revenue bar chart ────────────────────────────────────── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Daily Revenue</Text>
          <View style={{ marginTop: 12 }}>
            <RevenueBarChart bars={bars} colors={colors} available={rangeAvailable} />
          </View>
        </View>

        {/* ── Traffic sources ────────────────────────────────────────────── */}
        <SourceCard sources={sources} colors={colors} />

        <View style={{ height: 120 }} />
      </ScrollView>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll:       { flex: 1, backgroundColor: SCREEN_BG },
  content:      { paddingHorizontal: 16 },
  loadWrap:     { flex: 1, backgroundColor: SCREEN_BG, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadText:     { color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm },

  pageTitle:    { fontSize: 28, fontFamily: FONT.bold, color: FG, marginBottom: 16 },

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
