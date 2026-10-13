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
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticLight } from '@/lib/haptics';
import { DASHBOARD_ACTION_ROWS } from '@/components/SellerDashboardActionNeeded';
import { SellerDashboardSectionTitle } from '@/components/SellerDashboardSectionTitle';
import { hasTodo } from '@/lib/sellerDashboardHome';
import type { DashboardActionCounts } from '@/lib/sellerDashboardStats';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

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
  /** Ship now: opens SHIP_NOW_ROUTE. The button fires the one light haptic, so this must not add another. */
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
          {/* Same solid button as the dashboard's Withdraw (accent fill,
              plain onAccent text) — not PrimaryButton, whose label carries
              a soft text shadow. */}
          <PressableScale
            onPress={() => { hapticLight(); onShipNow(); }}
            style={[styles.shipButton, { backgroundColor: theme.accent }]}
            accessibilityRole="button"
            accessibilityLabel="Ship now"
            testID="seller-dashboard-ship-now"
          >
            <Text style={[styles.shipButtonText, { color: theme.onAccent }]} numberOfLines={1}>Ship now</Text>
          </PressableScale>
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
  shipButton: { minHeight: 44, minWidth: 120, paddingHorizontal: SP.md, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  shipButtonText: { fontFamily: FONT.bold, fontSize: FS.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  rowTitle: { flex: 1, minWidth: 0, fontFamily: FONT.medium, fontSize: 15 },
});
