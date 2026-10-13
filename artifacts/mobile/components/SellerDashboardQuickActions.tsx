/**
 * Dashboard quick actions — four equal icon buttons (icon above a short
 * label), monochrome. Each routes to an existing screen.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
import { withOrigin } from '@/lib/navigation/flowOrigin';
import { FONT, SP } from '@/lib/theme';

export interface DashboardQuickAction {
  id: 'new-product' | 'new-post' | 'go-live' | 'share-store';
  label: string;
  icon: React.ComponentProps<typeof Feather>['name'];
  route: string;
}

export const DASHBOARD_QUICK_ACTIONS: readonly DashboardQuickAction[] = [
  { id: 'new-product', label: 'New product', icon: 'plus', route: withOrigin('/add-product', 'dashboard') },
  { id: 'new-post', label: 'New post', icon: 'edit-3', route: '/create-post' },
  { id: 'go-live', label: 'Go live', icon: 'radio', route: '/seller-go-live' },
  { id: 'share-store', label: 'Share store', icon: 'share', route: '/share-store' },
];

export function SellerDashboardQuickActions({
  theme,
  onNavigate,
  showGoLive = true,
}: {
  theme: AppThemePreset;
  onNavigate: (route: string) => void;
  /** False hides Go live (e.g. when live streaming isn't available). */
  showGoLive?: boolean;
}) {
  const actions = DASHBOARD_QUICK_ACTIONS.filter((a) => showGoLive || a.id !== 'go-live');
  return (
    <View style={styles.row} testID="seller-dashboard-quick-actions">
      {actions.map((action) => (
        <PressableScale
          key={action.id}
          onPress={() => onNavigate(action.route)}
          style={styles.item}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          testID={`seller-dashboard-quick-${action.id}`}
        >
          <View style={[styles.iconCircle, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <Feather name={action.icon} size={20} color={theme.text} />
          </View>
          <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>{action.label}</Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SP.sm },
  item: { flex: 1, minWidth: 0, alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs },
  iconCircle: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONT.medium, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
