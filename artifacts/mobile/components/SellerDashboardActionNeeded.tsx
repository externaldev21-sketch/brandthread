import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { hasNoActionNeeded, type DashboardActionCounts } from '@/lib/sellerDashboardStats';

interface ActionRowConfig {
  key: keyof DashboardActionCounts;
  icon: React.ComponentProps<typeof Feather>['name'];
  title: (count: number) => string;
  subtitle: string;
  route: string;
}

const ROWS: ActionRowConfig[] = [
  { key: 'toShip', icon: 'package', title: (n) => `${n} ${n === 1 ? 'order' : 'orders'} to ship`, subtitle: 'Paid orders awaiting shipment', route: '/(tabs)/orders' },
  { key: 'toAnswer', icon: 'message-circle', title: (n) => `${n} ${n === 1 ? 'message' : 'messages'} to answer`, subtitle: 'Buyers and manufacturers waiting on you', route: '/seller-inbox' },
  { key: 'lowStock', icon: 'trending-down', title: (n) => `${n} ${n === 1 ? 'item' : 'items'} low on stock`, subtitle: 'Restock before you sell out', route: '/inventory' },
  { key: 'returns', icon: 'corner-up-left', title: (n) => `${n} ${n === 1 ? 'return' : 'returns'} to review`, subtitle: 'Buyer-initiated returns awaiting a decision', route: '/(tabs)/orders' },
];

export function SellerDashboardActionNeeded({
  counts,
  theme,
  onNavigate,
}: {
  counts: DashboardActionCounts;
  theme: AppThemePreset;
  onNavigate: (route: string) => void;
}) {
  const rows = ROWS.filter((row) => counts[row.key] > 0);
  const allCaughtUp = hasNoActionNeeded(counts);

  return (
    <View testID="seller-dashboard-action-needed">
      <Text style={[styles.sectionHeader, { color: theme.muted }]}>Needs attention</Text>
      {allCaughtUp ? (
        <View style={styles.caughtUpRow} testID="seller-dashboard-all-caught-up">
          <Feather name="check-circle" size={16} color={theme.success} />
          <Text style={[styles.caughtUpText, { color: theme.muted }]}>You’re all caught up</Text>
        </View>
      ) : (
        <View>
          {rows.map((row, index) => {
            const count = counts[row.key];
            return (
              <PressableScale
                key={row.key}
                onPress={() => onNavigate(row.route)}
                style={[styles.row, index > 0 && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
                accessibilityRole="button"
                accessibilityLabel={row.title(count)}
              >
                <View style={[styles.iconWrap, { backgroundColor: theme.cardElevated }]}>
                  <Feather name={row.icon} size={16} color={theme.text} />
                </View>
                <View style={styles.copy}>
                  <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{row.title(count)}</Text>
                  <Text style={[styles.subtitle, { color: theme.muted }]} numberOfLines={1}>{row.subtitle}</Text>
                </View>
                <Feather name="chevron-right" size={18} color={theme.subtle} />
              </PressableScale>
            );
          })}
        </View>
      )}
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
  caughtUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    minHeight: 44,
  },
  caughtUpText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    minHeight: 60,
    paddingVertical: SP.sm,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
  },
  subtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    marginTop: 2,
  },
});
