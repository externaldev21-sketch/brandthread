import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import type { TrafficSource } from '@/lib/sellerHomeAnalytics';

/**
 * Real per-source breakdown, fed by the `store_visits` table (see migration
 * 108) — every buyer visit to this seller's store or a product page is
 * recorded with where it was navigated from (Discover feed card, a search
 * result, the seller's own profile, or a cold/external open), aggregated by
 * GET /api/analytics/home into `trafficSources` for the same date range the
 * rest of this dashboard already uses. A brand-new store with no visits yet
 * shows a real 0 for every source — never a dash, never a lock row.
 */
const SOURCE_META: Record<TrafficSource, { label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = {
  feed:     { label: 'Discover feed', icon: 'compass' },
  search:   { label: 'Search', icon: 'search' },
  profile:  { label: 'Your profile', icon: 'user' },
  external: { label: 'External links', icon: 'external-link' },
};
const SOURCE_ORDER: TrafficSource[] = ['feed', 'search', 'profile', 'external'];

export function SellerDashboardTrafficSources({
  totalVisits,
  trafficSources,
  theme,
}: {
  /** Real store-visit count for the selected period (same figure the hero/tiles use). Never fabricated. */
  totalVisits: number;
  /** Real per-source counts + share of total for the same period. */
  trafficSources: Array<{ source: TrafficSource; count: number; sharePercent: number }>;
  theme: AppThemePreset;
}) {
  const bySource = new Map(trafficSources.map((row) => [row.source, row]));

  return (
    <View testID="seller-dashboard-traffic-sources">
      <Text style={[styles.sectionHeader, { color: theme.muted }]}>Traffic sources</Text>
      {totalVisits > 0 ? (
        // One line, one size — the count and its label read as a single
        // sentence (e.g. "1,240 store visits this period"), not a big
        // number stat next to small grey caption text.
        <Text style={styles.totalLine} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          <Text style={[styles.totalLineValue, { color: theme.text }]}>{formatCompactCount(totalVisits)}</Text>
          <Text style={[styles.totalLineLabel, { color: theme.muted }]}> </Text>
          <Text style={[styles.totalLineLabel, { color: theme.muted }]}>store visits this period</Text>
        </Text>
      ) : (
        // Zero/fresh state: a plain empty-state line, matching the rest of
        // this dashboard's zero states (e.g. the hero chart's "No sales
        // yet") — never a big bold "0" that reads like a rendering glitch.
        <Text style={[styles.totalLineLabel, { color: theme.muted }]}>No store visits yet</Text>
      )}
      <View style={[styles.breakdownCard, { borderColor: theme.borderSubtle }]}>
        {SOURCE_ORDER.map((key, index) => {
          const meta = SOURCE_META[key];
          const row = bySource.get(key);
          const count = row?.count ?? 0;
          const sharePercent = row?.sharePercent ?? 0;
          return (
            <View
              key={key}
              style={[styles.sourceRow, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
            >
              <View style={[styles.iconWrap, { backgroundColor: theme.cardElevated }]}>
                <Feather name={meta.icon} size={14} color={theme.subtle} />
              </View>
              <Text style={[styles.sourceLabel, { color: theme.muted }]} numberOfLines={1}>{meta.label}</Text>
              <Text style={[styles.sourceValue, { color: theme.text }]} numberOfLines={1}>
                {formatCompactCount(count)}
              </Text>
              <Text style={[styles.sourceShare, { color: theme.subtle }]} numberOfLines={1}>
                {`${sharePercent}%`}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: SP.sm,
  },
  totalLine: {
    marginBottom: SP.sm,
  },
  totalLineValue: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    fontVariant: ['tabular-nums'],
  },
  totalLineLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  breakdownCard: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    minHeight: 44,
    paddingHorizontal: SP.md,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceLabel: {
    flex: 1,
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  sourceValue: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    fontVariant: ['tabular-nums'],
  },
  sourceShare: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    minWidth: 36,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
