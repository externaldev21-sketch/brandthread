import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';

/**
 * Where a real per-source breakdown (Discover / Search / Profile / External
 * link) would go once the backend tracks a visit's origin — it currently
 * only records that a visit happened (`storefront_visits`: sellerId,
 * visitorId, visitDate — no source/referrer column), never where it came
 * from. So this card shows the one real number that exists (total store
 * visits, the same `visitorCount` the hero/tiles already use) and lists the
 * source categories as an honestly-locked placeholder — never a fabricated
 * split of that total.
 */
const SOURCE_CATEGORIES: Array<{ key: string; label: string; icon: React.ComponentProps<typeof Feather>['name'] }> = [
  { key: 'discover', label: 'Discover feed', icon: 'compass' },
  { key: 'search', label: 'Search', icon: 'search' },
  { key: 'profile', label: 'Your profile', icon: 'user' },
  { key: 'external', label: 'External links', icon: 'external-link' },
];

export function SellerDashboardTrafficSources({
  totalVisits,
  theme,
}: {
  /** Real store-visit count for the selected period (same figure the hero/tiles use). Never fabricated. */
  totalVisits: number;
  theme: AppThemePreset;
}) {
  return (
    <View testID="seller-dashboard-traffic-sources">
      <Text style={[styles.sectionHeader, { color: theme.muted }]}>Traffic sources</Text>
      <View style={styles.totalRow}>
        <Text style={[styles.totalValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {formatCompactCount(totalVisits)}
        </Text>
        <Text style={[styles.totalLabel, { color: theme.muted }]}>store visits this period</Text>
      </View>
      <View style={[styles.breakdownCard, { borderColor: theme.borderSubtle }]}>
        <View style={styles.breakdownHeader}>
          <Feather name="lock" size={12} color={theme.subtle} />
          <Text style={[styles.breakdownHeaderText, { color: theme.subtle }]}>
            Source breakdown isn't tracked yet
          </Text>
        </View>
        {SOURCE_CATEGORIES.map((category, index) => (
          <View
            key={category.key}
            style={[styles.sourceRow, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.iconWrap, { backgroundColor: theme.cardElevated }]}>
              <Feather name={category.icon} size={14} color={theme.subtle} />
            </View>
            <Text style={[styles.sourceLabel, { color: theme.muted }]} numberOfLines={1}>{category.label}</Text>
            <Text style={[styles.sourceValue, { color: theme.subtle }]}>{'—'}</Text>
          </View>
        ))}
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
  totalRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SP.xs,
    marginBottom: SP.sm,
  },
  totalValue: {
    fontFamily: FONT.bold,
    fontSize: FS.xl,
    letterSpacing: -0.4,
    fontVariant: ['tabular-nums'],
  },
  totalLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
  },
  breakdownCard: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: 6,
  },
  breakdownHeaderText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
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
  },
});
