import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import { describeDashboardDelta } from '@/lib/sellerDashboardStats';
import type { TrafficSource } from '@/lib/sellerHomeAnalytics';

/**
 * Traffic sources — redesigned per Dev's direction (Mobbin references:
 * YouTube Studio's "How viewers find you" per-source bars, eBay's headline
 * number + delta, Stripe/Linear-style single segmented breakdown bar).
 * Reskinned black/white/silver: one segmented bar (each source a different
 * white opacity, not a hue) instead of the reference apps' colored bars.
 *
 * Real per-source breakdown, fed by the `store_visits` table (see migration
 * 108) — every buyer visit to this seller's store or a product page is
 * recorded with where it was navigated from, aggregated by
 * GET /api/analytics/home into `trafficSources` for the same date range the
 * rest of this dashboard already uses.
 *
 * No per-source sparkline: the API has no per-source historical buckets
 * (only a single count + share for the selected range), and fabricating one
 * would break this app's "never invent a number" rule. Each legend row's own
 * proportional mini-bar stands in for it — a real, at-a-glance visual
 * without inventing a trend that was never measured.
 *
 * The headline number never animates via count-up: that pattern (see
 * lib/useCountUp.ts) can show a stale/zero number next to an
 * already-correct delta if requestAnimationFrame stalls (the bug fixed in
 * #499's hero-metric). Only the bar's fill width animates in on mount —
 * purely decorative, so it can never disagree with the number beside it.
 */
const SOURCE_META: Record<TrafficSource, { label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  feed:     { label: 'Discover feed', icon: 'compass' },
  search:   { label: 'Search', icon: 'search' },
  profile:  { label: 'Your profile', icon: 'user' },
  external: { label: 'External links', icon: 'external-link' },
};
const SOURCE_ORDER: TrafficSource[] = ['feed', 'search', 'profile', 'external'];
/** Decreasing white opacity per segment — "silver tones", not hues. */
const SEGMENT_OPACITY: Record<TrafficSource, number> = { feed: 1, search: 0.7, profile: 0.45, external: 0.25 };

type SourceRow = { key: TrafficSource; label: string; icon: React.ComponentProps<typeof Feather>['name']; count: number; sharePercent: number };

function AnimatedSegment({ flexShare, opacity, isFirst, isLast, textColor }: { flexShare: number; opacity: number; isFirst: boolean; isLast: boolean; textColor: string }) {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(flexShare, { duration: 650, easing: Easing.out(Easing.cubic) });
  }, [flexShare, width]);
  const style = useAnimatedStyle(() => ({ flex: width.value }));
  if (flexShare <= 0) return null;
  return (
    <Animated.View
      style={[
        style,
        {
          backgroundColor: textColor,
          opacity,
          borderTopLeftRadius: isFirst ? RADIUS.pill : 0,
          borderBottomLeftRadius: isFirst ? RADIUS.pill : 0,
          borderTopRightRadius: isLast ? RADIUS.pill : 0,
          borderBottomRightRadius: isLast ? RADIUS.pill : 0,
        },
      ]}
    />
  );
}

export function SellerDashboardTrafficSources({
  totalVisits,
  previousVisits,
  periodLabel,
  trafficSources,
  theme,
  onSeeAll,
  onOpenSource,
  onShareStore,
}: {
  /** Real store-visit count for the selected period (same figure the hero/tiles use). Never fabricated. */
  totalVisits: number;
  /** Store-visit count for the immediately preceding period of the same length. */
  previousVisits: number;
  /** e.g. "last week" — same period label the hero delta line uses. */
  periodLabel: string | null;
  /** Real per-source counts + share of total for the same period. */
  trafficSources: Array<{ source: TrafficSource; count: number; sharePercent: number }> | null | undefined;
  theme: AppThemePreset;
  onSeeAll: () => void;
  onOpenSource: (source: TrafficSource) => void;
  onShareStore: () => void;
}) {
  // Defensive: an older/partial analytics payload missing this field must
  // never crash the whole dashboard into the error boundary — fall back to
  // the same real "0 for every source" zero state a brand-new store shows.
  const hasSources = !!trafficSources && trafficSources.length > 0;
  const bySource = new Map((trafficSources ?? []).map((row) => [row.source, row]));
  // The headline and every row percentage are always derived from the same
  // number — the sum of the row counts — rather than trusting totalVisits to
  // already agree with it. Two independently-computed figures (a headline
  // visitor count and four per-source counts) can drift apart upstream even
  // when neither is wrong on its own; deriving one from the other here is
  // what guarantees they can never visibly disagree.
  const rowCounts = SOURCE_ORDER.map((key) => bySource.get(key)?.count ?? 0);
  const displayTotal = hasSources ? rowCounts.reduce((sum, c) => sum + c, 0) : totalVisits;
  const rows: SourceRow[] = SOURCE_ORDER.map((key, i) => {
    const meta = SOURCE_META[key];
    const count = rowCounts[i];
    const sharePercent = displayTotal > 0 ? Math.round((count / displayTotal) * 1000) / 10 : 0;
    return { key, label: meta.label, icon: meta.icon, count, sharePercent };
  });
  const top = rows.reduce<SourceRow | null>((best, row) => (row.count > 0 && (!best || row.count > best.count) ? row : best), null);
  const deltaLine = displayTotal > 0 && periodLabel
    ? describeDashboardDelta(displayTotal, previousVisits, formatCompactCount, periodLabel)
    : null;

  return (
    <View testID="seller-dashboard-traffic-sources">
      <View style={styles.headerRow}>
        <Text style={[styles.sectionHeader, { color: theme.muted }]}>Traffic sources</Text>
        <TouchableOpacity onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all traffic analytics" hitSlop={8}>
          <Text style={[styles.seeAll, { color: theme.subtle }]}>See all</Text>
        </TouchableOpacity>
      </View>

      {displayTotal === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyBarTrack, { borderColor: theme.borderSubtle }]} />
          <Text style={[styles.emptyText, { color: theme.muted }]}>
            No visits yet
          </Text>
          <PressableScale
            onPress={onShareStore}
            style={[styles.shareBtn, { borderColor: theme.text }]}
            accessibilityRole="button"
            accessibilityLabel="Share your store"
          >
            <Feather name="share" size={14} color={theme.text} />
            <Text style={[styles.shareBtnText, { color: theme.text }]}>Share store</Text>
          </PressableScale>
        </View>
      ) : (
        <>
          <Text style={styles.totalLine} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            <Text style={[styles.totalLineValue, { color: theme.text }]}>{formatCompactCount(displayTotal)}</Text>
            <Text style={[styles.totalLineLabel, { color: theme.muted }]}> store visits this period</Text>
          </Text>
          {deltaLine && (
            <Text style={[styles.deltaLine, { color: deltaLine.direction === 'flat' ? theme.muted : theme.text }]}>
              {deltaLine.direction === 'up' ? '↑ ' : deltaLine.direction === 'down' ? '↓ ' : ''}
              {deltaLine.label}
            </Text>
          )}

          <View style={[styles.segmentedBar, { backgroundColor: theme.cardElevated }]}>
            {rows.map((row, index) => (
              <AnimatedSegment
                key={row.key}
                flexShare={row.sharePercent}
                opacity={SEGMENT_OPACITY[row.key]}
                isFirst={index === 0}
                isLast={index === rows.length - 1}
                textColor={theme.text}
              />
            ))}
          </View>

          {top && (
            <Text style={[styles.topCaption, { color: theme.subtle }]} numberOfLines={1}>
              Most visits from {top.label}
            </Text>
          )}

          <View style={[styles.legendCard, { borderColor: theme.borderSubtle }]}>
            {rows.map((row, index) => {
              const isTop = top?.key === row.key;
              return (
                <PressableScale
                  key={row.key}
                  onPress={() => onOpenSource(row.key)}
                  style={[
                    styles.legendRow,
                    index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth },
                    isTop && { backgroundColor: theme.cardElevated },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.label}: ${row.count} visits, ${row.sharePercent}%`}
                >
                  <View style={[styles.iconWrap, { backgroundColor: theme.cardElevated }]}>
                    <Feather name={row.icon} size={14} color={theme.text} />
                  </View>
                  <View style={styles.legendCopy}>
                    <Text style={[styles.sourceLabel, { color: theme.text, fontFamily: isTop ? FONT.semibold : FONT.medium }]} numberOfLines={1}>
                      {row.label}
                    </Text>
                    <View style={[styles.miniBarTrack, { backgroundColor: theme.borderSubtle }]}>
                      <View style={[styles.miniBarFill, { width: `${Math.min(100, row.sharePercent)}%`, backgroundColor: theme.text }]} />
                    </View>
                  </View>
                  <View style={styles.legendNumbers}>
                    <Text style={[styles.sourceValue, { color: theme.text }]} numberOfLines={1}>
                      {formatCompactCount(row.count)}
                    </Text>
                    <Text style={[styles.sourceShare, { color: theme.muted }]} numberOfLines={1}>
                      {`${row.sharePercent}%`}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  sectionHeader: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  seeAll: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  totalLine: { marginBottom: 2 },
  totalLineValue: {
    fontFamily: FONT.bold,
    fontSize: FS.xxl,
    fontVariant: ['tabular-nums'],
  },
  totalLineLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  deltaLine: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    marginBottom: SP.md,
  },
  segmentedBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
    marginBottom: SP.xs,
  },
  topCaption: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    marginBottom: SP.md,
  },
  legendCard: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    minHeight: 56,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendCopy: { flex: 1, gap: 6 },
  sourceLabel: {
    fontSize: FS.sm,
  },
  miniBarTrack: {
    height: 3,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  miniBarFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
  },
  legendNumbers: { alignItems: 'flex-end', gap: 2 },
  sourceValue: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    fontVariant: ['tabular-nums'],
  },
  sourceShare: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    fontVariant: ['tabular-nums'],
  },
  emptyState: { alignItems: 'center', paddingVertical: SP.lg, gap: SP.md },
  emptyBarTrack: {
    width: '100%',
    height: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  emptyText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    textAlign: 'center',
    maxWidth: 280,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: SP.lg,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
  },
  shareBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
});
