/**
 * Dashboard "To do" — Shopify Home's task block. Rendered at the top of the
 * Dashboard ONLY when something needs the seller (see hasTodo); hidden
 * entirely otherwise. Orders to ship lead as a big number with a Ship now
 * button; the other real counts (low stock, messages, returns) follow as
 * plain rows reusing SellerDashboardActionNeeded's copy and routes.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale, PrimaryButton } from '@/components/BrandthreadUI';
import { DASHBOARD_ACTION_ROWS } from '@/components/SellerDashboardActionNeeded';
import { SellerDashboardSectionTitle } from '@/components/SellerDashboardSectionTitle';
import { hasTodo } from '@/lib/sellerDashboardHome';
import type { DashboardActionCounts } from '@/lib/sellerDashboardStats';
import { FONT, SP } from '@/lib/theme';

/** Orders tab, pre-filtered to Unfulfilled (orders.tsx reads ?filter= on focus). */
export const SHIP_NOW_ROUTE = '/(tabs)/orders?filter=unfulfilled';

export function SellerDashboardTodo({
  counts,
  theme,
  onNavigate,
  onShipNow,
}: {
  counts: DashboardActionCounts | null;
  theme: AppThemePreset;
  /** Row taps (the caller fires the one light haptic). */
  onNavigate: (route: string) => void;
  /** Ship now — PrimaryButton already fires its own haptic, so this must not add another. Opens SHIP_NOW_ROUTE. */
  onShipNow: () => void;
}) {
  if (!counts || !hasTodo(counts)) return null;
  const rows = DASHBOARD_ACTION_ROWS.filter((row) => row.key !== 'toShip' && counts[row.key] > 0);

  return (
    <View testID="seller-dashboard-todo">
      <SellerDashboardSectionTitle title="To do" theme={theme} />
      {counts.toShip > 0 && (
        <View style={styles.shipRow} testID="seller-dashboard-todo-ship">
          <View style={styles.shipCopy}>
            <Text style={[styles.shipCount, { color: theme.text }]} numberOfLines={1}>{counts.toShip}</Text>
            <Text style={[styles.shipLabel, { color: theme.muted }]} numberOfLines={1}>
              {counts.toShip === 1 ? 'Order to ship' : 'Orders to ship'}
            </Text>
          </View>
          <PrimaryButton label="Ship now" small onPress={onShipNow} testID="seller-dashboard-ship-now" style={styles.shipButton} />
        </View>
      )}
      {rows.map((row, index) => {
        const count = counts[row.key];
        const divider = index > 0 || counts.toShip > 0;
        return (
          <PressableScale
            key={row.key}
            onPress={() => onNavigate(row.route)}
            style={[styles.row, divider && { borderTopColor: theme.borderSubtle, borderTopWidth: StyleSheet.hairlineWidth }]}
            accessibilityRole="button"
            accessibilityLabel={row.title(count)}
          >
            <Feather name={row.icon} size={18} color={theme.text} />
            <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>{row.title(count)}</Text>
            <Feather name="chevron-right" size={18} color={theme.subtle} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shipRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingBottom: SP.md },
  shipCopy: { flex: 1, minWidth: 0 },
  shipCount: { fontFamily: FONT.bold, fontSize: 34, lineHeight: 40, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  shipLabel: { fontFamily: FONT.medium, fontSize: 15, lineHeight: 20 },
  shipButton: { minWidth: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  rowTitle: { flex: 1, minWidth: 0, fontFamily: FONT.medium, fontSize: 15 },
});
